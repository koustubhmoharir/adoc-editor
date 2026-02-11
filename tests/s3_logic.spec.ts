
import { test, expect } from '@playwright/test';
import { scanAndCalculateStatus, DirNodeLike, FileStatus, SyncContentAction } from '../src/store/S3SyncLogic';
import { MockFileSystemDirectoryHandle, MockFileSystemFileHandle } from './helpers/mock_fs_handles';
import { S3Client, ListObjectVersionsCommand, HeadObjectCommand } from '@aws-sdk/client-s3';

import { createHash } from 'crypto';

// Helper to calculate SHA256 matches S3SyncLogic
function computeHash(content: string) {
    return createHash('sha256').update(content).digest('hex');
}

// Mock S3 Client
class MockS3Client extends S3Client {
    public versions: any[] = [];
    public metadata: Record<string, any> = {};

    constructor() {
        super({ region: 'us-east-1' });
    }

    send(command: any): Promise<any> {
        if (command instanceof ListObjectVersionsCommand) {
            return Promise.resolve({
                Versions: this.versions.map(v => ({
                    Key: v.Key,
                    VersionId: v.VersionId,
                    IsLatest: v.IsLatest,
                    LastModified: v.LastModified ? new Date(v.LastModified) : new Date(),
                    ETag: v.ETag,
                    Size: v.Size
                })),
                NextKeyMarker: undefined,
                NextVersionIdMarker: undefined
            });
        }
        if (command instanceof HeadObjectCommand) {
            const key = command.input.Key!;
            const meta = this.metadata[key] || {};
            return Promise.resolve({
                Metadata: meta,
                ChecksumSHA256: meta.sha256,
                ContentLength: 100 // dummy
            });
        }
        return Promise.reject(new Error(`Unknown command: ${command.constructor.name}`));
    }
}

// Helper to convert MockFS to SyncNodeLike
async function toSyncNodeLike(handle: MockFileSystemDirectoryHandle): Promise<DirNodeLike> {
    const children: DirNodeLike['children'] = [];
    for await (const entry of handle.values()) {
        if (entry.kind === 'file') {
            children.push({
                name: entry.name,
                kind: 'file',
                handle: entry
            });
        } else if (entry.kind === 'directory') {
            children.push(await toSyncNodeLike(entry as unknown as MockFileSystemDirectoryHandle));
        }
    }
    return {
        name: handle.name,
        kind: 'directory',
        handle: handle,
        children: children
    };
}

// Enable trace logging
if (typeof globalThis !== 'undefined') {
    (globalThis as any).__TEST_ENABLE_TRACE_LOGGING = true;
}

test.describe('S3 Sync Logic', () => {
    let rootHandle: MockFileSystemDirectoryHandle;
    let rootNode: DirNodeLike;
    let s3Client: MockS3Client;
    const settings = {
        bucket: 'test-bucket',
        prefix: 'test-prefix/',
        region: 'us-east-1',
        identity_pool_id: 'id',
        authority: 'auth',
        client_id: 'client',
        path_prefix: 'test-prefix/',
        device_name: 'test-device'
    };

    test.beforeEach(async () => {
        rootHandle = new MockFileSystemDirectoryHandle('root');
        s3Client = new MockS3Client();
        // Setup empty .s3 directory structure
        const s3Dir = rootHandle.addDirectory('.s3');
        s3Dir.addDirectory('m');
        s3Dir.addDirectory('mc');
    });

    test('Empty local and remote should return empty status', async () => {
        rootNode = await toSyncNodeLike(rootHandle);
        const status = await scanAndCalculateStatus(rootNode, s3Client, settings);
        expect(status).toEqual([]);
    });

    test('New Local File (No Base)', async () => {
        rootHandle.addFile('new.txt', 'test content');

        rootNode = await toSyncNodeLike(rootHandle);
        const status = await scanAndCalculateStatus(rootNode, s3Client, settings);

        expect(status).toHaveLength(1);
        const item = status[0];
        expect(item.localStatus).toBe(FileStatus.New);
        expect(item.recommendedContentAction).toBe(SyncContentAction.CopyLocalToRemote);
    });

    test('New Remote File (No Base)', async () => {
        const content = 'remote content';
        const hash = computeHash(content);
        s3Client.versions.push({
            Key: 'test-prefix/remote.txt',
            VersionId: 'v1',
            IsLatest: true,
            LastModified: new Date(),
            Size: content.length,
            ETag: 'itag'
        });
        s3Client.metadata['test-prefix/remote.txt'] = {
            uuid: 'uuid-remote',
            syncversion: '1',
            sha256: hash,
            devicename: 'other-device'
        };

        rootNode = await toSyncNodeLike(rootHandle);
        const status = await scanAndCalculateStatus(rootNode, s3Client, settings);

        expect(status).toHaveLength(1);
        const item = status[0];
        expect(item.remoteStatus).toBe(FileStatus.New);
        expect(item.recommendedContentAction).toBe(SyncContentAction.CopyRemoteToLocal);
    });

    test('Unchanged File (Matches Base)', async () => {
        // Setup Base
        const s3Dir = await rootHandle.getDirectoryHandle('.s3') as unknown as MockFileSystemDirectoryHandle;
        const baseDir = s3Dir.getEntry('m') as MockFileSystemDirectoryHandle;
        const content = 'test';
        const hash = computeHash(content);

        const baseRecord = {
            uuid: 'uuid-1',
            key: 'test-prefix/file.txt',
            version: 'v1',
            syncVersion: 1,
            deviceName: 'dev',
            sha256: hash,
            contentLength: content.length,
            lastModifiedLocal: new Date().toISOString(),
            compressionMethod: ''
        };
        baseDir.addFile('.index.json', JSON.stringify({ 'file.txt': baseRecord }));

        // Local
        rootHandle.addFile('file.txt', content);
        const s3MetaDir = rootHandle.getEntry('.s3') as MockFileSystemDirectoryHandle;
        s3MetaDir.addFile('uuids.json', JSON.stringify({ 'file.txt': 'uuid-1' }));


        // Remote
        s3Client.versions.push({
            Key: 'test-prefix/file.txt',
            VersionId: 'v1',
            IsLatest: true
        });
        // Optimization: if key & version match base, we reuse base logic, so we don't need S3 metadata here if fetchRemoteRecords optimizes it.
        // But let's verify optimization works (no head request made if version matches).
        // Since mock 'HeadObject' returns dummy if metadata missing, and our code handles missing metadata, it should be fine.

        rootNode = await toSyncNodeLike(rootHandle);
        const status = await scanAndCalculateStatus(rootNode, s3Client, settings);

        expect(status).toHaveLength(1);
        expect(status[0].localStatus).toBe(FileStatus.Unchanged);
        expect(status[0].remoteStatus).toBe(FileStatus.Unchanged);
        expect(status[0].recommendedContentAction).toBe(SyncContentAction.None);
    });

    test('Conflict (Both Changed)', async () => {
        // Setup Base
        const s3Dir = await rootHandle.getDirectoryHandle('.s3') as unknown as MockFileSystemDirectoryHandle;
        const baseDir = s3Dir.getEntry('m') as MockFileSystemDirectoryHandle;
        const baseRecord = {
            uuid: 'uuid-1',
            key: 'test-prefix/file.txt',
            version: 'v1',
            syncVersion: 1,
            deviceName: 'dev',
            sha256: 'old-hash',
            contentLength: 10,
            lastModifiedLocal: new Date().toISOString(),
            compressionMethod: ''
        };
        baseDir.addFile('.index.json', JSON.stringify({ 'file.txt': baseRecord }));

        // Local: Changed
        rootHandle.addFile('file.txt', 'local change');
        const s3MetaDir = rootHandle.getEntry('.s3') as MockFileSystemDirectoryHandle;
        s3MetaDir.addFile('uuids.json', JSON.stringify({ 'file.txt': 'uuid-1' }));

        // Remote: Changed
        s3Client.versions.push({
            Key: 'test-prefix/file.txt',
            VersionId: 'v2',
            IsLatest: true
        });
        s3Client.metadata['test-prefix/file.txt'] = {
            uuid: 'uuid-1',
            syncversion: '2',
            sha256: 'remote-hash'
        };

        rootNode = await toSyncNodeLike(rootHandle);
        const status = await scanAndCalculateStatus(rootNode, s3Client, settings);

        expect(status).toHaveLength(1);
        expect(status[0].isContentConflict).toBe(true);
    });

    test('Both New (Conflict)', async () => {
        // Local: New
        rootHandle.addFile('file.txt', 'local new');

        // Remote: New
        s3Client.versions.push({
            Key: 'test-prefix/file.txt', // Same path
            VersionId: 'v1',
            IsLatest: true
        });
        s3Client.metadata['test-prefix/file.txt'] = {
            uuid: 'uuid-remote',
            syncversion: '1',
            sha256: 'remote-hash'
        };

        rootNode = await toSyncNodeLike(rootHandle);
        const status = await scanAndCalculateStatus(rootNode, s3Client, settings);

        expect(status).toHaveLength(1);
        expect(status[0].isContentConflict).toBe(true);
    });

    test('Local Deleted (Remote Unchanged)', async () => {
        // Setup Base
        const s3Dir = await rootHandle.getDirectoryHandle('.s3') as unknown as MockFileSystemDirectoryHandle;
        const baseDir = s3Dir.getEntry('m') as MockFileSystemDirectoryHandle;
        const baseRecord = {
            uuid: 'uuid-1',
            key: 'test-prefix/file.txt',
            version: 'v1',
            syncVersion: 1,
            deviceName: 'dev',
            sha256: 'hash',
            contentLength: 4,
            lastModifiedLocal: new Date().toISOString(),
            compressionMethod: ''
        };
        baseDir.addFile('.index.json', JSON.stringify({ 'file.txt': baseRecord }));

        // Local: Deleted (file missing)

        // Remote: Unchanged
        s3Client.versions.push({
            Key: 'test-prefix/file.txt',
            VersionId: 'v1',
            IsLatest: true
        });

        rootNode = await toSyncNodeLike(rootHandle);
        const status = await scanAndCalculateStatus(rootNode, s3Client, settings);

        expect(status).toHaveLength(1);
        expect(status[0].localStatus).toBe(FileStatus.Deleted);
        expect(status[0].remoteStatus).toBe(FileStatus.Unchanged);
        expect(status[0].recommendedContentAction).toBe(SyncContentAction.DeleteRemote);
        expect(status[0].isWarning).toBe(true);
    });

    test('Remote Deleted (Local Unchanged)', async () => {
        // Setup Base
        const s3Dir = await rootHandle.getDirectoryHandle('.s3') as unknown as MockFileSystemDirectoryHandle;
        const baseDir = s3Dir.getEntry('m') as MockFileSystemDirectoryHandle;
        const content = 'test';
        const hash = computeHash(content);
        const baseRecord = {
            uuid: 'uuid-1',
            key: 'test-prefix/file.txt',
            version: 'v1',
            syncVersion: 1,
            deviceName: 'dev',
            sha256: hash,
            contentLength: content.length,
            lastModifiedLocal: new Date().toISOString(),
            compressionMethod: ''
        };
        baseDir.addFile('.index.json', JSON.stringify({ 'file.txt': baseRecord }));

        // Local: Unchanged
        rootHandle.addFile('file.txt', content);
        const s3MetaDir = rootHandle.getEntry('.s3') as MockFileSystemDirectoryHandle;
        s3MetaDir.addFile('uuids.json', JSON.stringify({ 'file.txt': 'uuid-1' }));


        // Remote: Deleted (no version in list)

        rootNode = await toSyncNodeLike(rootHandle);
        const status = await scanAndCalculateStatus(rootNode, s3Client, settings);

        expect(status).toHaveLength(1);
        expect(status[0].remoteStatus).toBe(FileStatus.Deleted);
        expect(status[0].localStatus).toBe(FileStatus.Unchanged);
        expect(status[0].recommendedContentAction).toBe(SyncContentAction.DeleteLocal);
        expect(status[0].isWarning).toBe(true);
    });

    test('Local Modified vs Remote Deleted (Conflict)', async () => {
        // Setup Base
        const s3Dir = await rootHandle.getDirectoryHandle('.s3') as unknown as MockFileSystemDirectoryHandle;
        const baseDir = s3Dir.getEntry('m') as MockFileSystemDirectoryHandle;
        const baseRecord = {
            uuid: 'uuid-1',
            key: 'test-prefix/file.txt',
            version: 'v1',
            syncVersion: 1,
            deviceName: 'dev',
            sha256: 'hash',
            contentLength: 4,
            lastModifiedLocal: new Date().toISOString(),
            compressionMethod: ''
        };
        baseDir.addFile('.index.json', JSON.stringify({ 'file.txt': baseRecord }));

        // Local: Modified
        rootHandle.addFile('file.txt', 'modified'); // Changed content/size

        // Remote: Deleted

        rootNode = await toSyncNodeLike(rootHandle);
        const status = await scanAndCalculateStatus(rootNode, s3Client, settings);

        expect(status).toHaveLength(1);
        expect(status[0].isContentConflict).toBe(true);
    });

    test('Remote Modified vs Local Deleted (Conflict)', async () => {
        // Setup Base
        const s3Dir = await rootHandle.getDirectoryHandle('.s3') as unknown as MockFileSystemDirectoryHandle;
        const baseDir = s3Dir.getEntry('m') as MockFileSystemDirectoryHandle;
        const baseRecord = {
            uuid: 'uuid-1',
            key: 'test-prefix/file.txt',
            version: 'v1',
            syncVersion: 1,
            deviceName: 'dev',
            sha256: 'hash',
            contentLength: 4,
            lastModifiedLocal: new Date().toISOString(),
            compressionMethod: ''
        };
        baseDir.addFile('.index.json', JSON.stringify({ 'file.txt': baseRecord }));

        // Local: Deleted

        // Remote: Modified (v2)
        s3Client.versions.push({
            Key: 'test-prefix/file.txt',
            VersionId: 'v2',
            IsLatest: true
        });
        s3Client.metadata['test-prefix/file.txt'] = {
            uuid: 'uuid-1',
            syncversion: '2',
            sha256: 'new-hash'
        };

        rootNode = await toSyncNodeLike(rootHandle);
        const status = await scanAndCalculateStatus(rootNode, s3Client, settings);

        expect(status).toHaveLength(1);
        expect(status[0].isContentConflict).toBe(true);
    });

    test('Local Move', async () => {
        // Setup Base
        const s3Dir = await rootHandle.getDirectoryHandle('.s3') as unknown as MockFileSystemDirectoryHandle;
        const baseDir = s3Dir.getEntry('m') as MockFileSystemDirectoryHandle;
        const content = 'test';
        const hash = computeHash(content);
        const baseRecord = {
            uuid: 'uuid-1',
            key: 'test-prefix/old.txt',
            version: 'v1',
            syncVersion: 1,
            deviceName: 'dev',
            sha256: hash,
            contentLength: content.length,
            lastModifiedLocal: new Date().toISOString(),
            compressionMethod: ''
        };
        baseDir.addFile('.index.json', JSON.stringify({ 'old.txt': baseRecord }));

        // Local: Moved to new.txt (and same content 'test')
        rootHandle.addFile('new.txt', content);
        const s3MetaDir = rootHandle.getEntry('.s3') as MockFileSystemDirectoryHandle;
        // The mock scan logic reads uuids.json. If new.txt has correct UUID, it detects move via UUID.
        s3MetaDir.addFile('uuids.json', JSON.stringify({ 'new.txt': 'uuid-1' }));

        // Remote: Unchanged (old.txt exists)
        s3Client.versions.push({
            Key: 'test-prefix/old.txt',
            VersionId: 'v1',
            IsLatest: true
        });

        rootNode = await toSyncNodeLike(rootHandle);
        const status = await scanAndCalculateStatus(rootNode, s3Client, settings);

        expect(status).toHaveLength(1);
        const item = status[0];
        expect(item.localMoved).toBe(true);
        expect(item.recommendedPathAction).toBe(SyncContentAction.CopyLocalToRemote);
    });

    test('Remote Move', async () => {
        // Setup Base
        const s3Dir = await rootHandle.getDirectoryHandle('.s3') as unknown as MockFileSystemDirectoryHandle;
        const baseDir = s3Dir.getEntry('m') as MockFileSystemDirectoryHandle;
        const content = 'test';
        const hash = computeHash(content);
        const baseRecord = {
            uuid: 'uuid-1',
            key: 'test-prefix/old.txt',
            version: 'v1',
            syncVersion: 1,
            deviceName: 'dev',
            sha256: hash,
            contentLength: content.length,
            lastModifiedLocal: new Date().toISOString(),
            compressionMethod: ''
        };
        baseDir.addFile('.index.json', JSON.stringify({ 'old.txt': baseRecord }));

        // Local: Unchanged (old.txt)
        rootHandle.addFile('old.txt', content);
        const s3MetaDir = rootHandle.getEntry('.s3') as MockFileSystemDirectoryHandle;
        s3MetaDir.addFile('uuids.json', JSON.stringify({ 'old.txt': 'uuid-1' }));

        // Remote: Moved to new.txt
        s3Client.versions.push({
            Key: 'test-prefix/new.txt',
            VersionId: 'v1', // same version
            IsLatest: true
        });
        s3Client.metadata['test-prefix/new.txt'] = {
            uuid: 'uuid-1',
            syncversion: '1',
            sha256: hash
        };

        rootNode = await toSyncNodeLike(rootHandle);
        const status = await scanAndCalculateStatus(rootNode, s3Client, settings);

        expect(status).toHaveLength(1);
        const item = status[0];
        expect(item.remoteMoved).toBe(true);
        expect(item.recommendedPathAction).toBe(SyncContentAction.CopyRemoteToLocal);
    });

    test('Fast Check (Hash Match)', async () => {
        // Setup Base
        const s3Dir = await rootHandle.getDirectoryHandle('.s3') as unknown as MockFileSystemDirectoryHandle;
        const baseDir = s3Dir.getEntry('m') as MockFileSystemDirectoryHandle;
        const content = 'test';
        const hash = computeHash(content);
        const baseRecord = {
            uuid: 'uuid-1',
            key: 'test-prefix/old.txt',
            version: 'v1',
            syncVersion: 1,
            deviceName: 'dev',
            sha256: hash,
            contentLength: content.length,
            lastModifiedLocal: new Date().toISOString(),
            compressionMethod: ''
        };
        baseDir.addFile('.index.json', JSON.stringify({ 'old.txt': baseRecord }));

        // Local: new.txt with "test", NO UUID
        rootHandle.addFile('new.txt', content);

        // Remote: Deleted

        rootNode = await toSyncNodeLike(rootHandle);
        const status = await scanAndCalculateStatus(rootNode, s3Client, settings);

        expect(status).toHaveLength(1);
        const item = status[0];
        // Match happens via SHA256 match in matchBaseWithLocal (Step 3)
        // because UUID match fails (no uuid for local) and Path match fails (old vs new).

        expect(item.localMoved).toBe(true);
        expect(item.localStatus).toBe(FileStatus.Unchanged);
    });

    test('Local Changed (Remote Unchanged)', async () => {
        // Setup Base
        const s3Dir = await rootHandle.getDirectoryHandle('.s3') as unknown as MockFileSystemDirectoryHandle;
        const baseDir = s3Dir.getEntry('m') as MockFileSystemDirectoryHandle;
        const content = 'test';
        const hash = computeHash(content);
        const baseRecord = {
            uuid: 'uuid-1',
            key: 'test-prefix/file.txt',
            version: 'v1',
            syncVersion: 1,
            deviceName: 'dev',
            sha256: hash,
            contentLength: content.length,
            lastModifiedLocal: new Date().toISOString(),
            compressionMethod: ''
        };
        baseDir.addFile('.index.json', JSON.stringify({ 'file.txt': baseRecord }));

        // Local: Changed
        rootHandle.addFile('file.txt', 'changed-content');

        // Remote: Unchanged
        s3Client.versions.push({
            Key: 'test-prefix/file.txt',
            VersionId: 'v1',
            IsLatest: true
        });

        rootNode = await toSyncNodeLike(rootHandle);
        const status = await scanAndCalculateStatus(rootNode, s3Client, settings);

        expect(status).toHaveLength(1);
        const item = status[0];
        expect(item.localStatus).toBe(FileStatus.Changed);
        expect(item.recommendedContentAction).toBe(SyncContentAction.CopyLocalToRemote);
    });

    test('Both Moved (Path Conflict)', async () => {
        // Setup Base
        const s3Dir = await rootHandle.getDirectoryHandle('.s3') as unknown as MockFileSystemDirectoryHandle;
        const baseDir = s3Dir.getEntry('m') as MockFileSystemDirectoryHandle;
        const content = 'test';
        const hash = computeHash(content);
        const baseRecord = {
            uuid: 'uuid-1',
            key: 'test-prefix/old.txt',
            version: 'v1',
            syncVersion: 1,
            deviceName: 'dev',
            sha256: hash,
            contentLength: content.length,
            lastModifiedLocal: new Date().toISOString(),
            compressionMethod: ''
        };
        baseDir.addFile('.index.json', JSON.stringify({ 'old.txt': baseRecord }));

        // Local: Moved to local.txt
        rootHandle.addFile('local.txt', content);
        const s3MetaDir = rootHandle.getEntry('.s3') as MockFileSystemDirectoryHandle;
        s3MetaDir.addFile('uuids.json', JSON.stringify({ 'local.txt': 'uuid-1' }));

        // Remote: Moved to remote.txt
        s3Client.versions.push({
            Key: 'test-prefix/remote.txt',
            VersionId: 'v1',
            IsLatest: true
        });
        s3Client.metadata['test-prefix/remote.txt'] = {
            uuid: 'uuid-1',
            syncversion: '1',
            sha256: hash
        };

        rootNode = await toSyncNodeLike(rootHandle);
        const status = await scanAndCalculateStatus(rootNode, s3Client, settings);

        expect(status).toHaveLength(1);
        expect(status[0].isPathConflict).toBe(true);
    });

    test('Both Deleted', async () => {
        // Setup Base
        const s3Dir = await rootHandle.getDirectoryHandle('.s3') as unknown as MockFileSystemDirectoryHandle;
        const baseDir = s3Dir.getEntry('m') as MockFileSystemDirectoryHandle;
        const baseRecord = {
            uuid: 'uuid-1',
            key: 'test-prefix/file.txt',
            version: 'v1',
            syncVersion: 1,
            deviceName: 'dev',
            sha256: 'hash',
            contentLength: 4,
            lastModifiedLocal: new Date().toISOString(),
            compressionMethod: ''
        };
        baseDir.addFile('.index.json', JSON.stringify({ 'file.txt': baseRecord }));

        // Local: Deleted
        // Remote: Deleted

        rootNode = await toSyncNodeLike(rootHandle);
        const status = await scanAndCalculateStatus(rootNode, s3Client, settings);

        expect(status).toHaveLength(1);
        expect(status[0].recommendedContentAction).toBe(SyncContentAction.None);
    });

    test('Remote Reverted', async () => {
        // Setup Base
        const s3Dir = await rootHandle.getDirectoryHandle('.s3') as unknown as MockFileSystemDirectoryHandle;
        const baseDir = s3Dir.getEntry('m') as MockFileSystemDirectoryHandle;
        const baseRecord = {
            uuid: 'uuid-1',
            key: 'test-prefix/file.txt',
            version: 'v2',
            syncVersion: 2,
            deviceName: 'dev',
            sha256: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
            contentLength: 4,
            lastModifiedLocal: new Date().toISOString(),
            compressionMethod: ''
        };
        baseDir.addFile('.index.json', JSON.stringify({ 'file.txt': baseRecord }));

        // Local: Unchanged (v2)
        rootHandle.addFile('file.txt', 'test');
        // Assume local hash matches baseRecord hash-v2. We skip mocking full match for this test as we want to test REmote status.
        // But scanLocalFiles needs to run.

        // Remote: Reverted to v1
        s3Client.versions.push({
            Key: 'test-prefix/file.txt',
            VersionId: 'v1',
            IsLatest: true
        });
        s3Client.metadata['test-prefix/file.txt'] = {
            uuid: 'uuid-1',
            syncversion: '1',
            sha256: 'hash-v1'
        };

        rootNode = await toSyncNodeLike(rootHandle);
        const status = await scanAndCalculateStatus(rootNode, s3Client, settings);

        expect(status).toHaveLength(1);
        expect(status[0].remoteStatus).toBe(FileStatus.Reverted);
        expect(status[0].isWarning).toBe(true);
    });

    test('Remote Unknown (No SyncVer)', async () => {
        // Setup Base
        const s3Dir = await rootHandle.getDirectoryHandle('.s3') as unknown as MockFileSystemDirectoryHandle;
        const baseDir = s3Dir.getEntry('m') as MockFileSystemDirectoryHandle;
        const baseRecord = {
            uuid: 'uuid-1',
            key: 'test-prefix/file.txt',
            version: 'v1',
            syncVersion: 1,
            deviceName: 'dev',
            sha256: 'hash-1',
            contentLength: 4,
            lastModifiedLocal: new Date().toISOString(),
            compressionMethod: ''
        };
        baseDir.addFile('.index.json', JSON.stringify({ 'file.txt': baseRecord }));

        // Local: Unchanged
        rootHandle.addFile('file.txt', 'test');
        baseRecord.sha256 = '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08';
        baseDir.addFile('.index.json', JSON.stringify({ 'file.txt': baseRecord }));

        // Remote: No sync metadata
        s3Client.versions.push({
            Key: 'test-prefix/file.txt',
            VersionId: 'v2',
            IsLatest: true
        });
        s3Client.metadata['test-prefix/file.txt'] = {
            uuid: 'uuid-1',
            sha256: 'hash-2'
            // NO syncversion
        };

        rootNode = await toSyncNodeLike(rootHandle);
        const status = await scanAndCalculateStatus(rootNode, s3Client, settings);

        expect(status).toHaveLength(1);
        expect(status[0].remoteStatus).toBe(FileStatus.Unknown);
        expect(status[0].isWarning).toBe(true);
    });

    test('Remote Unknown (Hash Mismatch, Same SyncVer)', async () => {
        // Setup Base
        const s3Dir = await rootHandle.getDirectoryHandle('.s3') as unknown as MockFileSystemDirectoryHandle;
        const baseDir = s3Dir.getEntry('m') as MockFileSystemDirectoryHandle;
        const baseRecord = {
            uuid: 'uuid-1',
            key: 'test-prefix/file.txt',
            version: 'v1',
            syncVersion: 1,
            deviceName: 'dev',
            sha256: 'hash-1',
            contentLength: 4,
            lastModifiedLocal: new Date().toISOString(),
            compressionMethod: ''
        };
        baseDir.addFile('.index.json', JSON.stringify({ 'file.txt': baseRecord }));

        // Local: Unchanged
        rootHandle.addFile('file.txt', 'test');
        baseRecord.sha256 = '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08';
        baseDir.addFile('.index.json', JSON.stringify({ 'file.txt': baseRecord }));

        // Remote: Same SyncVer, Diff Hash
        s3Client.versions.push({
            Key: 'test-prefix/file.txt',
            VersionId: 'v2',
            IsLatest: true
        });
        s3Client.metadata['test-prefix/file.txt'] = {
            uuid: 'uuid-1',
            syncversion: '1',
            sha256: 'hash-2' // Changed hash
        };

        rootNode = await toSyncNodeLike(rootHandle);
        const status = await scanAndCalculateStatus(rootNode, s3Client, settings);

        expect(status).toHaveLength(1);
        expect(status[0].remoteStatus).toBe(FileStatus.Unknown);
        expect(status[0].isWarning).toBe(true);
    });

    test('New Remote File (Nested, No Metadata) triggers getOrCreateDirectory', async () => {
        // Remote: Unsynced file in subfolder (no metadata)
        // This triggers logic in fetchRemoteRecords that writes to cache (getOrCreateDirectory)
        // because we don't have base record or cached record for it.
        s3Client.versions.push({
            Key: 'test-prefix/nested/remote.txt',
            VersionId: 'v1',
            IsLatest: true,
            Size: 100
        });
        // No metadata => HeadObject fallback => no UUID, but sha256 via dummy head response.

        rootNode = await toSyncNodeLike(rootHandle);
        const status = await scanAndCalculateStatus(rootNode, s3Client, settings);

        expect(status).toHaveLength(1);
        // Should be treated as New Remote
        expect(status[0].remoteStatus).toBe(FileStatus.New);
        // Verify we implicitly hit the cache writing logic
    });

    test('Nested Sync Root Ignored', async () => {
        // Local: subfolder which is a sync root
        const nested = rootHandle.addDirectory('nested');
        nested.addFile('file.txt', 'ignored');

        // Mock that this directory has sync config
        // In real app, `hasS3SyncConfig` is on the Model.
        // toSyncNodeLike needs to support this?
        // We can hack the node creation or mock handle.
        // Since scanLocalFiles checks `child.hasS3SyncConfig`, we need `toSyncNodeLike` to set it.
        // But `toSyncNodeLike` logic above doesn't map it.
        // Let's manually construct the tree for this test to be sure.

        const nestedNode: DirNodeLike = {
            name: 'nested',
            kind: 'directory',
            handle: nested,
            children: [{ name: 'file.txt', kind: 'file', handle: nested.getEntry('file.txt') as MockFileSystemFileHandle }],
            hasS3SyncConfig: true
        };

        const customRoot: DirNodeLike = {
            name: 'root',
            kind: 'directory',
            handle: rootHandle,
            children: [nestedNode]
        };

        const status = await scanAndCalculateStatus(customRoot, s3Client, settings);

        expect(status).toHaveLength(0); // Should skip the file inside nested
    });

    test('Ignore File (ignore.toml)', async () => {
        // Local: ignore.toml present
        const ignoreDir = rootHandle.addDirectory('.adoc-editor');
        ignoreDir.addFile('ignore.toml', 'some config');

        // S3 Sync should INCLUDE ignore.toml in the listing

        rootNode = await toSyncNodeLike(rootHandle);
        const status = await scanAndCalculateStatus(rootNode, s3Client, settings);

        expect(status).toHaveLength(1);
        expect(status[0].local?.key).toBe('test-prefix/.adoc-editor/ignore.toml');
    });

    test.describe('Phase 2 Coverage & Logic Verification', () => {

        test('Local Files in Subdirectories', async () => {
            const subdir = await rootHandle.getDirectoryHandle('subdir', { create: true }) as unknown as MockFileSystemDirectoryHandle;
            subdir.addFile('subfile.txt', 'sub-content');

            rootNode = await toSyncNodeLike(rootHandle);
            const status = await scanAndCalculateStatus(rootNode, s3Client, settings);

            expect(status).toHaveLength(1);
            expect(status[0].local?.key).toBe('test-prefix/subdir/subfile.txt');
            expect(status[0].localStatus).toBe(FileStatus.New);
        });

        test('Verify Caching of HEAD requests (Second scan uses cache)', async () => {
            // Remote file with NO metadata in List response (mock default)
            s3Client.versions.push({
                Key: 'test-prefix/remote.txt',
                VersionId: 'v1',
                IsLatest: true
            });
            // HeadObject will be called to fetch metadata 

            // Spy on send
            let callCount = 0;
            const originalSend = s3Client.send.bind(s3Client);
            s3Client.send = (async (command: any) => {
                callCount++;
                return originalSend(command);
            }) as any;

            // First Scan
            rootNode = await toSyncNodeLike(rootHandle);
            await scanAndCalculateStatus(rootNode, s3Client, settings);

            // Expect List + Head = 2 calls
            expect(callCount).toBeGreaterThanOrEqual(2);

            // Second Scan
            // The first scan should have written to .adoc-editor/s3/remote cache
            callCount = 0;
            await scanAndCalculateStatus(rootNode, s3Client, settings);

            // Expect List only = 1 call. Head should be skipped due to cache.
            expect(callCount).toBe(1);
        });

        test('Match Logic Step 2 (Path Match, Missing UUID)', async () => {
            // Base: Has UUID
            const s3Dir = await rootHandle.getDirectoryHandle('.s3') as unknown as MockFileSystemDirectoryHandle;
            const baseDir = s3Dir.getEntry('m') as MockFileSystemDirectoryHandle;
            const baseRecord = {
                uuid: 'uuid-1',
                key: 'test-prefix/file.txt',
                version: 'v1',
                syncVersion: 1,
                deviceName: 'dev',
                sha256: 'hash-1',
                contentLength: 4,
                lastModifiedLocal: new Date().toISOString(),
                compressionMethod: ''
            };
            baseDir.addFile('.index.json', JSON.stringify({ 'file.txt': baseRecord }));

            // Remote: Matches Path, but NO metadata (so no UUID)
            s3Client.versions.push({
                Key: 'test-prefix/file.txt',
                VersionId: 'v2',
                IsLatest: true
            });

            rootNode = await toSyncNodeLike(rootHandle);
            const status = await scanAndCalculateStatus(rootNode, s3Client, settings);

            expect(status).toHaveLength(1);
            expect(status[0].base).toBeDefined();
            expect(status[0].remote).toBeDefined();
            expect(status[0].remote!.key).toBe(baseRecord.key);
            expect(status[0].remote!.uuid).toBe(''); // Confirms missing UUID
        });

        test('Match Logic Step 3 (Hash Match, Missing UUID, Different Path)', async () => {
            // Base: uuid-1, 'common-hash'
            const s3Dir = await rootHandle.getDirectoryHandle('.s3') as unknown as MockFileSystemDirectoryHandle;
            const baseDir = s3Dir.getEntry('m') as MockFileSystemDirectoryHandle;
            const baseRecord = {
                uuid: 'uuid-1',
                key: 'test-prefix/old.txt',
                version: 'v1',
                syncVersion: 1,
                deviceName: 'dev',
                sha256: 'common-hash',
                contentLength: 10,
                lastModifiedLocal: new Date().toISOString(),
                compressionMethod: ''
            };
            baseDir.addFile('.index.json', JSON.stringify({ 'old.txt': baseRecord }));

            // Remote: Path B, NO UUID, Match Hash 'common-hash'
            // We must inject the hash via metadata or rely on mock behavior.
            // Mock S3 Client uses ChecksumSHA256 from HeadObject response if List response doesn't have it?
            // Actually our MockS3Client logic is:
            // if (command instanceof HeadObjectCommand) ... return { ChecksumSHA256: metadata['sha256'] ... }

            s3Client.versions.push({
                Key: 'test-prefix/new.txt',
                VersionId: 'v1',
                IsLatest: true
            });
            s3Client.metadata['test-prefix/new.txt'] = {
                sha256: 'common-hash' // Inject hash via metadata
            };

            rootNode = await toSyncNodeLike(rootHandle);
            const status = await scanAndCalculateStatus(rootNode, s3Client, settings);

            expect(status).toHaveLength(1);
            expect(status[0].remoteMoved).toBe(true);
            expect(status[0].recommendedPathAction).toBe(SyncContentAction.CopyRemoteToLocal);
        });

        test('Local Unchanged + Remote Changed', async () => {
            // Base
            const s3Dir = await rootHandle.getDirectoryHandle('.s3') as unknown as MockFileSystemDirectoryHandle;
            const baseDir = s3Dir.getEntry('m') as MockFileSystemDirectoryHandle;
            const content = 'v1-content';
            const hash1 = computeHash(content);

            const baseRecord = {
                uuid: 'uuid-1',
                key: 'test-prefix/file.txt',
                version: 'v1',
                syncVersion: 1,
                deviceName: 'dev',
                sha256: hash1,
                contentLength: content.length,
                lastModifiedLocal: new Date().toISOString(),
                compressionMethod: ''
            };
            baseDir.addFile('.index.json', JSON.stringify({ 'file.txt': baseRecord }));

            // Local: Matches Base
            rootHandle.addFile('file.txt', content);

            // Remote: Changed (Different Version, Different Hash, SyncVer 2)
            s3Client.versions.push({
                Key: 'test-prefix/file.txt',
                VersionId: 'v2',
                IsLatest: true
            });
            s3Client.metadata['test-prefix/file.txt'] = {
                uuid: 'uuid-1',
                syncversion: '2',
                sha256: 'hash-v2'
            };

            rootNode = await toSyncNodeLike(rootHandle);
            const status = await scanAndCalculateStatus(rootNode, s3Client, settings);

            expect(status).toHaveLength(1);
            expect(status[0].localStatus).toBe(FileStatus.Unchanged);
            expect(status[0].remoteStatus).toBe(FileStatus.Changed);
            expect(status[0].recommendedContentAction).toBe(SyncContentAction.CopyRemoteToLocal);
        });
    });

    test.describe('Phase 3: Coverage Finalization', () => {

        test('Verify readRecords recursion (nested base/remote cache)', async () => {
            // Setup: Create a nested structure in base metadata
            const s3Dir = await rootHandle.getDirectoryHandle('.s3') as unknown as MockFileSystemDirectoryHandle;
            const baseDir = s3Dir.getEntry('m') as MockFileSystemDirectoryHandle;
            const subdir = baseDir.addDirectory('nested');

            const baseRecord = {
                uuid: 'uuid-nested',
                key: 'test-prefix/nested/file.txt',
                version: 'v1',
                syncVersion: 1,
                deviceName: 'dev',
                sha256: 'hash-n',
                contentLength: 10,
                lastModifiedLocal: new Date().toISOString(),
                compressionMethod: ''
            };
            subdir.addFile('.index.json', JSON.stringify({ 'file.txt': baseRecord }));

            // Trigger scan
            rootNode = await toSyncNodeLike(rootHandle);
            const status = await scanAndCalculateStatus(rootNode, s3Client, settings);

            // If recursion works, base record should be loaded
            // Since no remote or local, it should show as Deleted Remote
            expect(status).toHaveLength(1);
            expect(status[0].base?.key).toBe('test-prefix/nested/file.txt');
            expect(status[0].remoteStatus).toBe(FileStatus.Deleted);
        });

        test('Verify writeRemoteRecordsCache merging (Lines 364-367)', async () => {
            // Setup: Pre-populate remote cache with an existing record
            const s3Dir = await rootHandle.getDirectoryHandle('.s3') as unknown as MockFileSystemDirectoryHandle;
            const metaCacheDir = s3Dir.getEntry('mc') as MockFileSystemDirectoryHandle;

            const existingRecord = {
                uuid: 'uuid-1',
                key: 'test-prefix/existing.txt',
                version: 'v1',
                syncVersion: 1,
                deviceName: 'dev',
                sha256: 'hash-1',
                contentLength: 10,
                lastModified: new Date().toISOString()
            };
            metaCacheDir.addFile('.index.json', JSON.stringify({ 'existing.txt': existingRecord }));

            // Remote: existing.txt (Matches cache) AND new.txt (New)
            s3Client.versions.push({
                Key: 'test-prefix/existing.txt',
                VersionId: 'v1',
                IsLatest: true
            });
            s3Client.versions.push({
                Key: 'test-prefix/new.txt',
                VersionId: 'v2',
                IsLatest: true
            });
            // Mock Metadata for new.txt
            s3Client.metadata['test-prefix/new.txt'] = {
                uuid: 'uuid-2',
                syncversion: '1',
                sha256: 'hash-2'
            };

            // Trigger scan
            rootNode = await toSyncNodeLike(rootHandle);
            await scanAndCalculateStatus(rootNode, s3Client, settings);

            // Verify cache file contains BOTH records
            const cacheFile = await metaCacheDir.getFileHandle('.index.json');
            const file = await cacheFile.getFile();
            const content = JSON.parse(await file.text());

            expect(content['existing.txt']).toBeDefined();
            expect(content['new.txt']).toBeDefined();
            expect(content['existing.txt'].uuid).toBe('uuid-1');
            expect(content['new.txt'].uuid).toBe('uuid-2');
        });

        test('Empty S3 Prefix', async () => {
            // Setup: empty prefix settings
            const emptyPrefixSettings = { ...settings, prefix: '' };

            // Remote file at root of bucket
            s3Client.versions.push({
                Key: 'root-file.txt',
                VersionId: 'v1',
                IsLatest: true
            });
            s3Client.metadata['root-file.txt'] = { uuid: 'uuid-root', syncversion: '1' };

            rootNode = await toSyncNodeLike(rootHandle);
            const status = await scanAndCalculateStatus(rootNode, s3Client, emptyPrefixSettings);

            expect(status).toHaveLength(1);
            expect(status[0].remote?.key).toBe('root-file.txt');
        });

        test('Identical Hash but Different UUID', async () => {
            // Base: uuid-1
            const s3Dir = await rootHandle.getDirectoryHandle('.s3') as unknown as MockFileSystemDirectoryHandle;
            const baseDir = s3Dir.getEntry('m') as MockFileSystemDirectoryHandle;
            const baseRecord = {
                uuid: 'uuid-1',
                key: 'test-prefix/file.txt',
                version: 'v1',
                syncVersion: 1,
                deviceName: 'dev',
                sha256: 'common-hash',
                contentLength: 10,
                lastModifiedLocal: new Date().toISOString(),
                compressionMethod: ''
            };
            baseDir.addFile('.index.json', JSON.stringify({ 'file.txt': baseRecord }));

            // Remote: uuid-2, but MATCHING hash
            s3Client.versions.push({
                Key: 'test-prefix/file.txt',
                VersionId: 'v2',
                IsLatest: true
            });
            s3Client.metadata['test-prefix/file.txt'] = {
                uuid: 'uuid-2',
                syncversion: '1',
                sha256: 'common-hash'
            };

            rootNode = await toSyncNodeLike(rootHandle);
            const status = await scanAndCalculateStatus(rootNode, s3Client, settings);

            // Expectation: 
            // They have the same path.
            // Step 1 (UUID Match): No match.
            // Step 2 (Path Match): Path matches. "if !br.uuid || !rr.uuid || br.uuid === rr.uuid". Both have UUIDs, and they differ. So NO match.
            // Step 3 (Hash Match): Hash matches. "if !br.uuid || !rr.uuid || br.uuid === rr.uuid". Both have UUIDs, difference. So NO match.
            // Result: Base -> Deleted Remote (Action: Delete Local?)
            //         Remote -> New Local (Action: Copy Remote to Local?)
            //         Should result in TWO status items (or conflict if mapped to same path?)
            // Actually, if they are separate items:
            // 1. Base (test-prefix/file.txt) -> Remote Deleted. Recommended: Delete Local.
            // 2. Remote (test-prefix/file.txt) -> New Remote. Recommended: Copy Remote To Local.
            // They both operate on the SAME local key. This is a subtle conflict state.

            expect(status).toHaveLength(2);
            // Verify items
            const baseItem = status.find(s => s.base?.uuid === 'uuid-1');
            const remoteItem = status.find(s => s.remote?.uuid === 'uuid-2');

            expect(baseItem).toBeDefined();
            expect(remoteItem).toBeDefined();
            expect(baseItem!.remoteStatus).toBe(FileStatus.Deleted);
            expect(remoteItem!.remoteStatus).toBe(FileStatus.New);
        });


        test.describe('Phase 4: Final Edge Case Coverage', () => {
            test('Missing Metadata (UUID/SyncVersion) in HeadObject response', async () => {
                // Remote file with NO metadata
                s3Client.versions.push({
                    Key: 'test-prefix/no-meta.txt',
                    VersionId: 'v1',
                    IsLatest: true
                });
                // Mock metadata response explicitly EMPTY
                // The Mock S3 client needs to handle this by returning empty map
                // We set it to undefined in the mock map, or empty object
                s3Client.metadata['test-prefix/no-meta.txt'] = {} as any;

                rootNode = await toSyncNodeLike(rootHandle);
                const status = await scanAndCalculateStatus(rootNode, s3Client, settings);

                expect(status).toHaveLength(1);
                expect(status[0].remote?.key).toBe('test-prefix/no-meta.txt');
                expect(status[0].remote?.uuid).toBe('');
                expect(status[0].remote?.syncVersion).toBe(0);
            });

            test.describe('Phase 5: Local Matching Edge Cases', () => {
                test('Local UUID Mismatch (Same Path) - Should NOT match', async () => {
                    // Base Record: path matching local, but has specific UUID
                    const s3Dir = await rootHandle.getDirectoryHandle('.s3') as unknown as MockFileSystemDirectoryHandle;
                    const baseDir = s3Dir.getEntry('m') as MockFileSystemDirectoryHandle;
                    const baseRecord = {
                        uuid: 'uuid-base',
                        key: 'test-prefix/conflict.txt',
                        version: 'v1',
                        syncVersion: 1,
                        deviceName: 'dev',
                        sha256: 'hash-common',
                        contentLength: 10,
                        lastModifiedLocal: new Date().toISOString(),
                        compressionMethod: ''
                    };
                    baseDir.addFile('.index.json', JSON.stringify({ 'conflict.txt': baseRecord }));

                    // Local File: Same path, but we mock the UUID detection to return DIFFERENT UUID
                    // We do this by creating the uuids.json file
                    const s3LocalDir = await rootHandle.getDirectoryHandle('.s3') as unknown as MockFileSystemDirectoryHandle;
                    s3LocalDir.addFile('uuids.json', JSON.stringify({ 'conflict.txt': 'uuid-local' }));

                    rootHandle.addFile('conflict.txt', 'some content');

                    rootNode = await toSyncNodeLike(rootHandle);
                    const status = await scanAndCalculateStatus(rootNode, s3Client, settings);

                    // Expectation:
                    // Step 2 (Path Match) checks: !br.uuid || !lr.uuid || br.uuid === lr.uuid
                    // Here: 'uuid-base' !== 'uuid-local'. So NO MATCH.
                    // Step 3 (Hash Match) checks: Hash matches? 
                    // We need to ensure we don't accidentally match in Step 3 if we want to verify purely "No Match".
                    // But actually, Step 3 ALSO checks UUID! 
                    // "if !br.uuid || !lr.uuid || br.uuid === lr.uuid"
                    // So it should fail Step 3 too, even if content matches (which it might not since I didn't verify content hash here, but even if I did).

                    // Result: Two status items.
                    // 1. Base (conflict.txt) -> Remote Deleted (implied, since no remote). Local Deleted (since no match).
                    //    Actually, Base->Local is the link. If no Local link, then Local is ??
                    //    Wait, "Base -> Local" map. If not matched, Base maps to NULL Local.
                    //    So Base status item: Base + No Local + No Remote -> Remote Deleted, Local Deleted. 
                    //    Wait, "Local Status" logic: "if this.base && !this.local -> LocalStatus = Deleted".

                    // 2. Local (conflict.txt) -> No Base + Local + No Remote -> Local New.

                    expect(status).toHaveLength(2);
                    const baseItem = status.find(s => s.base?.uuid === 'uuid-base');
                    const localItem = status.find(s => s.local?.uuid === 'uuid-local');

                    expect(baseItem).toBeDefined();
                    expect(baseItem!.localStatus).toBe(FileStatus.Deleted);

                    expect(localItem).toBeDefined();
                    expect(localItem!.localStatus).toBe(FileStatus.New);
                });

                test('Local UUID Mismatch (Different Path, Same Hash) - Should NOT match', async () => {
                    // Base Record
                    const s3Dir = await rootHandle.getDirectoryHandle('.s3') as unknown as MockFileSystemDirectoryHandle;
                    const baseDir = s3Dir.getEntry('m') as MockFileSystemDirectoryHandle;

                    const sameContentHash = 'cae1b3faaa5e4ac7c3306bd164b36dcfdff98294b8024c9c949639b4c480bf6b';

                    const baseRecord = {
                        uuid: 'uuid-base',
                        key: 'test-prefix/old.txt',
                        version: 'v1',
                        syncVersion: 1,
                        deviceName: 'dev',
                        sha256: sameContentHash,
                        contentLength: 12, // Needs to match local content length 'same-content' is 12 chars
                        lastModifiedLocal: new Date().toISOString(),
                        compressionMethod: ''
                    };
                    baseDir.addFile('.index.json', JSON.stringify({ 'old.txt': baseRecord }));

                    // Local File: Different path, same content (hash), DIFFERENT UUID
                    const s3LocalDir = await rootHandle.getDirectoryHandle('.s3') as unknown as MockFileSystemDirectoryHandle;
                    s3LocalDir.addFile('uuids.json', JSON.stringify({ 'new.txt': 'uuid-local' }));

                    rootHandle.addFile('new.txt', 'same-content'); // length 12

                    rootNode = await toSyncNodeLike(rootHandle);
                    const status = await scanAndCalculateStatus(rootNode, s3Client, settings);

                    // Expectation:
                    // Step 3: Hash matches (real hash). UUID check: 'uuid-base' !== 'uuid-local'. Should FAIL matching.

                    expect(status).toHaveLength(2);
                    const baseItem = status.find(s => s.base?.key === 'test-prefix/old.txt');
                    const localItem = status.find(s => s.local?.key === 'test-prefix/new.txt');

                    expect(baseItem).toBeDefined();
                    expect(baseItem!.localStatus).toBe(FileStatus.Deleted);

                    expect(localItem).toBeDefined();
                    expect(localItem!.localStatus).toBe(FileStatus.New);
                }); // Properly closing the Phase 5 test
            });

            test.describe('Phase 6: Local Hash Match (Step 3) Full Coverage', () => {
                test('Local Hash Match (Different Path) - Missing Base UUID (Should Match)', async () => {
                    // Base: Hash-X, No UUID
                    const s3Dir = await rootHandle.getDirectoryHandle('.s3') as unknown as MockFileSystemDirectoryHandle;
                    const baseDir = s3Dir.getEntry('m') as MockFileSystemDirectoryHandle;

                    const sharedContentHash = '13dc762db802d34578dd514c74bf67179a3cf00d2dedddf36f8a4d309c901662';

                    const baseRecord = {
                        uuid: '', // Missing UUID
                        key: 'test-prefix/base-no-uuid.txt',
                        version: 'v1',
                        syncVersion: 1,
                        deviceName: 'dev',
                        sha256: sharedContentHash,
                        contentLength: 14, // 'shared-content' is 14 chars
                        lastModifiedLocal: new Date().toISOString(),
                        compressionMethod: ''
                    };
                    baseDir.addFile('.index.json', JSON.stringify({ 'base-no-uuid.txt': baseRecord }));

                    // Local: Hash-X, Has UUID
                    const s3LocalDir = await rootHandle.getDirectoryHandle('.s3') as unknown as MockFileSystemDirectoryHandle;
                    s3LocalDir.addFile('uuids.json', JSON.stringify({ 'local-moved.txt': 'uuid-local' }));
                    rootHandle.addFile('local-moved.txt', 'shared-content');

                    rootNode = await toSyncNodeLike(rootHandle);
                    const status = await scanAndCalculateStatus(rootNode, s3Client, settings);

                    // Step 3 (Hash): Matches.
                    // Condition: !br.uuid (True) || ... -> True.

                    expect(status).toHaveLength(1);
                    expect(status[0].base?.key).toBe('test-prefix/base-no-uuid.txt');
                    expect(status[0].local?.key).toBe('test-prefix/local-moved.txt');
                    expect(status[0].localMoved).toBe(true);
                });

                test('Local Hash Match (Different Path) - Missing Local UUID (Should Match)', async () => {
                    // Base: Hash-X, Has UUID
                    const s3Dir = await rootHandle.getDirectoryHandle('.s3') as unknown as MockFileSystemDirectoryHandle;
                    const baseDir = s3Dir.getEntry('m') as MockFileSystemDirectoryHandle;

                    const sharedContentHash = '13dc762db802d34578dd514c74bf67179a3cf00d2dedddf36f8a4d309c901662';

                    const baseRecord = {
                        uuid: 'uuid-base',
                        key: 'test-prefix/base-has-uuid.txt',
                        version: 'v1',
                        syncVersion: 1,
                        deviceName: 'dev',
                        sha256: sharedContentHash,
                        contentLength: 14,
                        lastModifiedLocal: new Date().toISOString(),
                        compressionMethod: ''
                    };
                    baseDir.addFile('.index.json', JSON.stringify({ 'base-has-uuid.txt': baseRecord }));

                    // Local: Hash-X, No UUID (e.g. fresh file)
                    // No uuids.json entry for this file
                    rootHandle.addFile('local-fresh.txt', 'shared-content');

                    rootNode = await toSyncNodeLike(rootHandle);
                    const status = await scanAndCalculateStatus(rootNode, s3Client, settings);

                    // Match

                    expect(status).toHaveLength(1);
                    expect(status[0].base?.key).toBe('test-prefix/base-has-uuid.txt');
                    expect(status[0].local?.key).toBe('test-prefix/local-fresh.txt');
                    expect(status[0].localMoved).toBe(true);
                });
            });
        });

    });
});



