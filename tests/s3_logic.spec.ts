
import { test, expect } from '@playwright/test';
import { scanAndCalculateStatus, FileNodeLike, DirNodeLike, FileStatus, SyncAction } from '../src/store/S3SyncLogic';
import { MockFileSystemDirectoryHandle, MockFileSystemFileHandle } from './helpers/mock_fs_handles';
import { S3Client, ListObjectVersionsCommand, HeadObjectCommand } from '@aws-sdk/client-s3';

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

    test('New Local File', async () => {
        rootHandle.addFile('new_file.txt', 'content');
        rootNode = await toSyncNodeLike(rootHandle);

        const status = await scanAndCalculateStatus(rootNode, s3Client, settings);

        expect(status).toHaveLength(1);
        const item = status[0];
        expect(item.local?.key).toBe('test-prefix/new_file.txt');
        expect(item.localStatus).toBe(FileStatus.New);
        expect(item.recommendedContentAction).toBe(SyncAction.CopyLocalToRemote);
    });

    test('New Remote File', async () => {
        s3Client.versions.push({
            Key: 'test-prefix/remote_file.txt',
            VersionId: 'v1',
            IsLatest: true
        });
        s3Client.metadata['test-prefix/remote_file.txt'] = {
            uuid: 'uuid-remote',
            syncversion: '1',
            sha256: 'hash-remote'
        };

        rootNode = await toSyncNodeLike(rootHandle);
        const status = await scanAndCalculateStatus(rootNode, s3Client, settings);

        expect(status).toHaveLength(1);
        const item = status[0];
        expect(item.remote?.key).toBe('test-prefix/remote_file.txt');
        expect(item.remoteStatus).toBe(FileStatus.New);
        expect(item.recommendedContentAction).toBe(SyncAction.CopyRemoteToLocal);
    });

    test('Unchanged File (Matches Base)', async () => {
        // Setup Base State
        const s3Dir = await rootHandle.getDirectoryHandle('.s3') as unknown as MockFileSystemDirectoryHandle;
        const baseDir = s3Dir.getEntry('m') as MockFileSystemDirectoryHandle;

        // Setup a record in base state
        // Base records are stored in .index.json files in subdirectories
        // readRecords iterates recursively.
        // We can just create a file named "file.txt" in baseDir representing the record? 
        // No, readRecords uses .index.json in directories.
        // Or if baseMetaDir has direct children as files?
        // readRecords:
        // try { index = ... .index.json ... }
        // try { ... scan subdirs ... }
        // It reads .index.json in the current dir.

        // We need to write .index.json in baseDir
        const baseRecord = {
            uuid: 'uuid-1',
            key: 'test-prefix/file.txt',
            version: 'v1',
            syncVersion: 1,
            deviceName: 'dev',
            sha256: 'hash-1',
            contentLength: 4, // "test"
            lastModifiedLocal: new Date().toISOString(),
            compressionMethod: ''
        };
        baseDir.addFile('.index.json', JSON.stringify({
            'file.txt': baseRecord
        }));

        // Setup Local File
        rootHandle.addFile('file.txt', 'test'); // Sha256 of 'test'?

        // Setup Remote File
        s3Client.versions.push({
            Key: 'test-prefix/file.txt',
            VersionId: 'v1',
            IsLatest: true
        });
        // We need remote metadata if we didn't cache it?
        // fetchRemoteRecords logic: if matches base (key & version), it reuses base info.
        // So we don't strictly need metadata if version matches.

        rootNode = await toSyncNodeLike(rootHandle);

        // We expect sha256 to be computed for local file.
        // But wait, computeSha256 uses @aws-crypto/sha256-browser.
        // We might need to ensure the hash matches 'hash-1'.
        // sha256 of 'test': 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08
        // Let's use the real hash in baseRecord so match works.
        baseRecord.sha256 = '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08';
        baseRecord.lastModifiedLocal = new Date().toISOString();
        // Update base record in handle
        const writable = await (baseDir.getEntry('.index.json') as MockFileSystemFileHandle).createWritable();
        await writable.write(JSON.stringify({ 'file.txt': baseRecord }));

        const status = await scanAndCalculateStatus(rootNode, s3Client, settings);

        expect(status).toHaveLength(1);
        const item = status[0];
        expect(item.localStatus).toBe(FileStatus.Unchanged);
        expect(item.remoteStatus).toBe(FileStatus.Unchanged);
        expect(item.recommendedContentAction).toBe(SyncAction.None);
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
            sha256: 'hash-original',
            contentLength: 4,
            lastModifiedLocal: new Date().toISOString(),
            compressionMethod: ''
        };
        baseDir.addFile('.index.json', JSON.stringify({ 'file.txt': baseRecord }));

        // Local Changed
        rootHandle.addFile('file.txt', 'local-change');

        // Remote Changed
        s3Client.versions.push({
            Key: 'test-prefix/file.txt',
            VersionId: 'v2', // Newer version
            IsLatest: true
        });
        s3Client.metadata['test-prefix/file.txt'] = {
            uuid: 'uuid-1',
            syncversion: '2', // Higher sync version
            sha256: 'hash-remote'
        };

        rootNode = await toSyncNodeLike(rootHandle);
        const status = await scanAndCalculateStatus(rootNode, s3Client, settings);

        expect(status).toHaveLength(1);
        const item = status[0];
        expect(item.localStatus).toBe(FileStatus.Changed);
        expect(item.remoteStatus).toBe(FileStatus.Changed);
        expect(item.isContentConflict).toBe(true);
        expect(item.recommendedContentAction).toBe(SyncAction.None);
    });

    test('Both New (Conflict)', async () => {
        rootHandle.addFile('file.txt', 'local-content');

        s3Client.versions.push({
            Key: 'test-prefix/file.txt',
            VersionId: 'v1',
            IsLatest: true
        });
        s3Client.metadata['test-prefix/file.txt'] = {
            uuid: 'uuid-new',
            syncversion: '1',
            sha256: 'hash-remote'
        };

        rootNode = await toSyncNodeLike(rootHandle);
        const status = await scanAndCalculateStatus(rootNode, s3Client, settings);

        expect(status).toHaveLength(1);
        const item = status[0];
        expect(item.localStatus).toBe(FileStatus.New);
        expect(item.remoteStatus).toBe(FileStatus.New);
        expect(item.isContentConflict).toBe(true);
        expect(item.recommendedContentAction).toBe(SyncAction.None);
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
            sha256: 'hash-original',
            contentLength: 4,
            lastModifiedLocal: new Date().toISOString(),
            compressionMethod: ''
        };
        baseDir.addFile('.index.json', JSON.stringify({ 'file.txt': baseRecord }));

        // Local: File does not exist

        // Remote: Unchanged
        s3Client.versions.push({
            Key: 'test-prefix/file.txt',
            VersionId: 'v1',
            IsLatest: true
        });
        // fetchRemoteRecords should reuse base logic if version matches

        rootNode = await toSyncNodeLike(rootHandle);
        const status = await scanAndCalculateStatus(rootNode, s3Client, settings);

        expect(status).toHaveLength(1);
        const item = status[0];
        expect(item.localStatus).toBe(FileStatus.Deleted);
        expect(item.remoteStatus).toBe(FileStatus.Unchanged);
        expect(item.recommendedContentAction).toBe(SyncAction.DeleteRemote);
        expect(item.isWarning).toBe(true);
    });

    test('Remote Deleted (Local Unchanged)', async () => {
        // Setup Base
        const s3Dir = await rootHandle.getDirectoryHandle('.s3') as unknown as MockFileSystemDirectoryHandle;
        const baseDir = s3Dir.getEntry('m') as MockFileSystemDirectoryHandle;
        const baseRecord = {
            uuid: 'uuid-1',
            key: 'test-prefix/file.txt',
            version: 'v1',
            syncVersion: 1,
            deviceName: 'dev',
            sha256: 'hash-original',
            contentLength: 4,
            lastModifiedLocal: new Date().toISOString(),
            compressionMethod: ''
        };
        baseDir.addFile('.index.json', JSON.stringify({ 'file.txt': baseRecord }));

        // Local: Unchanged
        rootHandle.addFile('file.txt', 'test'); // hash maps to hash-original in test logic??
        // Wait, computeSha256 is real. We need to ensure local file has 'hash-original' content.
        // Or assume baseRecord has the hash of "test".
        // sha256 of "test" (from prev test): 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08
        baseRecord.sha256 = '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08';
        // Need to update base on disk again
        const writable2 = await (baseDir.getEntry('.index.json') as MockFileSystemFileHandle).createWritable();
        await writable2.write(JSON.stringify({ 'file.txt': baseRecord }));

        // Remote: Deleted (no record pushed to s3Client)

        rootNode = await toSyncNodeLike(rootHandle);
        const status = await scanAndCalculateStatus(rootNode, s3Client, settings);

        expect(status).toHaveLength(1);
        const item = status[0];
        expect(item.localStatus).toBe(FileStatus.Unchanged);
        expect(item.remoteStatus).toBe(FileStatus.Deleted);
        expect(item.recommendedContentAction).toBe(SyncAction.DeleteLocal);
        expect(item.isWarning).toBe(true);
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
            sha256: 'hash-original',
            contentLength: 4,
            lastModifiedLocal: new Date().toISOString(),
            compressionMethod: ''
        };
        baseDir.addFile('.index.json', JSON.stringify({ 'file.txt': baseRecord }));

        // Local: Modified
        rootHandle.addFile('file.txt', 'modified-content');

        // Remote: Deleted

        rootNode = await toSyncNodeLike(rootHandle);
        const status = await scanAndCalculateStatus(rootNode, s3Client, settings);

        expect(status).toHaveLength(1);
        const item = status[0];
        expect(item.localStatus).toBe(FileStatus.Changed);
        expect(item.remoteStatus).toBe(FileStatus.Deleted);
        expect(item.isContentConflict).toBe(true);
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
            sha256: 'hash-original',
            contentLength: 4,
            lastModifiedLocal: new Date().toISOString(),
            compressionMethod: ''
        };
        baseDir.addFile('.index.json', JSON.stringify({ 'file.txt': baseRecord }));

        // Local: Deleted (no file added)

        // Remote: Modified
        s3Client.versions.push({
            Key: 'test-prefix/file.txt',
            VersionId: 'v2',
            IsLatest: true
        });
        s3Client.metadata['test-prefix/file.txt'] = {
            uuid: 'uuid-1',
            syncversion: '2',
            sha256: 'hash-new'
        };

        rootNode = await toSyncNodeLike(rootHandle);
        const status = await scanAndCalculateStatus(rootNode, s3Client, settings);

        expect(status).toHaveLength(1);
        const item = status[0];
        expect(item.localStatus).toBe(FileStatus.Deleted);
        expect(item.remoteStatus).toBe(FileStatus.Changed);
        expect(item.isContentConflict).toBe(true);
    });

    test('Local Move', async () => {
        // Setup Base
        const s3Dir = await rootHandle.getDirectoryHandle('.s3') as unknown as MockFileSystemDirectoryHandle;
        const baseDir = s3Dir.getEntry('m') as MockFileSystemDirectoryHandle;
        const baseRecord = {
            uuid: 'uuid-1',
            key: 'test-prefix/old.txt',
            version: 'v1',
            syncVersion: 1,
            deviceName: 'dev',
            sha256: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
            contentLength: 4,
            lastModifiedLocal: new Date().toISOString(),
            compressionMethod: ''
        };
        baseDir.addFile('.index.json', JSON.stringify({ 'old.txt': baseRecord }));

        // Local: Moved to new.txt
        rootHandle.addFile('new.txt', 'test');
        // Need to set UUID for new.txt
        s3Dir.addFile('uuids.json', JSON.stringify({ 'new.txt': 'uuid-1' }));

        // Remote: Unchanged (at old path)
        s3Client.versions.push({
            Key: 'test-prefix/old.txt',
            VersionId: 'v1',
            IsLatest: true
        });

        rootNode = await toSyncNodeLike(rootHandle);
        const status = await scanAndCalculateStatus(rootNode, s3Client, settings);

        expect(status).toHaveLength(1);
        const item = status[0];
        expect(item.localStatus).toBe(FileStatus.Unchanged);
        expect(item.localMoved).toBe(true);
        expect(item.remoteStatus).toBe(FileStatus.Unchanged);
        expect(item.recommendedPathAction).toBe(SyncAction.CopyLocalToRemote);
    });

    test('Remote Move', async () => {
        // Setup Base
        const s3Dir = await rootHandle.getDirectoryHandle('.s3') as unknown as MockFileSystemDirectoryHandle;
        const baseDir = s3Dir.getEntry('m') as MockFileSystemDirectoryHandle;
        const baseRecord = {
            uuid: 'uuid-1',
            key: 'test-prefix/old.txt',
            version: 'v1',
            syncVersion: 1,
            deviceName: 'dev',
            sha256: 'hash-original',
            contentLength: 4,
            lastModifiedLocal: new Date().toISOString(),
            compressionMethod: ''
        };
        baseDir.addFile('.index.json', JSON.stringify({ 'old.txt': baseRecord }));

        // Local: Unchanged (at old path)
        rootHandle.addFile('old.txt', 'test');
        baseRecord.sha256 = '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08';
        baseDir.addFile('.index.json', JSON.stringify({ 'old.txt': baseRecord }));

        // Remote: Moved to new.txt
        s3Client.versions.push({
            Key: 'test-prefix/new.txt',
            VersionId: 'v1',
            IsLatest: true
        });
        s3Client.metadata['test-prefix/new.txt'] = {
            uuid: 'uuid-1',
            syncversion: '2',
            sha256: 'hash-original'
        };

        rootNode = await toSyncNodeLike(rootHandle);
        const status = await scanAndCalculateStatus(rootNode, s3Client, settings);

        expect(status).toHaveLength(1);
        const item = status[0];
        expect(item.remoteMoved).toBe(true);
        expect(item.recommendedPathAction).toBe(SyncAction.CopyRemoteToLocal);
    });
    test('Fast Check (Hash Match)', async () => {
        // Setup Base: old.txt with hash-1
        const s3Dir = await rootHandle.getDirectoryHandle('.s3') as unknown as MockFileSystemDirectoryHandle;
        const baseDir = s3Dir.getEntry('m') as MockFileSystemDirectoryHandle;
        const baseRecord = {
            uuid: 'uuid-1',
            key: 'test-prefix/old.txt',
            version: 'v1',
            syncVersion: 1,
            deviceName: 'dev',
            sha256: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08', // hash of "test"
            contentLength: 4,
            lastModifiedLocal: new Date().toISOString(),
            compressionMethod: ''
        };
        baseDir.addFile('.index.json', JSON.stringify({ 'old.txt': baseRecord }));

        // Local: new.txt with "test", NO UUID (so uuid matching fails, path matching fails)
        rootHandle.addFile('new.txt', 'test');
        // Do NOT create uuids.json

        // Remote: Deleted (to simplify, or just Unchanged old.txt)
        // If remote is unchanged old.txt, it matches base.
        // And local new.txt matches base by hash.
        // So base maps to both? No.
        // matchRecords matches base with remote first.
        // Step 1: UUID match? Base has uuid-1. Remote?
        // Let's make remote also deleted to avoid complexity matchBaseWithRemote logic.
        // Actually matchBaseWithRemote runs first.
        // If remote is deleted, base->remote is null.
        // Then matchBaseWithLocal runs.
        // Step 1 (UUID): Base=uuid-1. Local=new.txt (no uuid). No match.
        // Step 2 (Path): Base=old.txt. Local=new.txt. No match.
        // Step 3 (Hash): Base=hash-1. Local=hash-1. Match!

        // So we get: base=old.txt, local=new.txt, remote=null.

        rootNode = await toSyncNodeLike(rootHandle);
        const status = await scanAndCalculateStatus(rootNode, s3Client, settings);

        expect(status).toHaveLength(1);
        const item = status[0];
        // Local logic: base.key != local.key -> localMoved = true.
        // if (local.sha256) -> True (computed during Step 3).
        // changed = base.sha != local.sha -> False.
        // localStatus = Unchanged.
        expect(item.localMoved).toBe(true);
        expect(item.localStatus).toBe(FileStatus.Unchanged);
        expect(item.remoteStatus).toBe(FileStatus.Deleted);
    });

    test('Local Changed (Remote Unchanged)', async () => {
        // Setup Base
        const s3Dir = await rootHandle.getDirectoryHandle('.s3') as unknown as MockFileSystemDirectoryHandle;
        const baseDir = s3Dir.getEntry('m') as MockFileSystemDirectoryHandle;
        const baseRecord = {
            uuid: 'uuid-1',
            key: 'test-prefix/file.txt',
            version: 'v1',
            syncVersion: 1,
            deviceName: 'dev',
            sha256: 'hash-original',
            contentLength: 4, // 'test'
            lastModifiedLocal: new Date().toISOString(),
            compressionMethod: ''
        };
        baseDir.addFile('.index.json', JSON.stringify({ 'file.txt': baseRecord }));

        // Local: Changed
        rootHandle.addFile('file.txt', 'changed-content');
        // Must ensure SHA changes or mod time changes.
        // 'changed-content' length > 4.

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
        expect(item.remoteStatus).toBe(FileStatus.Unchanged);
        expect(item.recommendedContentAction).toBe(SyncAction.CopyLocalToRemote);
    });

    test('Both Moved (Path Conflict)', async () => {
        // Setup Base
        const s3Dir = await rootHandle.getDirectoryHandle('.s3') as unknown as MockFileSystemDirectoryHandle;
        const baseDir = s3Dir.getEntry('m') as MockFileSystemDirectoryHandle;
        const baseRecord = {
            uuid: 'uuid-1',
            key: 'test-prefix/old.txt',
            version: 'v1',
            syncVersion: 1,
            deviceName: 'dev',
            sha256: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08', // 'test'
            contentLength: 4,
            lastModifiedLocal: new Date().toISOString(),
            compressionMethod: ''
        };
        baseDir.addFile('.index.json', JSON.stringify({ 'old.txt': baseRecord }));

        // Local: Moved to local.txt
        rootHandle.addFile('local.txt', 'test');
        s3Dir.addFile('uuids.json', JSON.stringify({ 'local.txt': 'uuid-1' }));

        // Remote: Moved to remote.txt
        s3Client.versions.push({
            Key: 'test-prefix/remote.txt',
            VersionId: 'v1', // same version, just moved?
            IsLatest: true
        });
        s3Client.metadata['test-prefix/remote.txt'] = {
            uuid: 'uuid-1',
            syncversion: '1',
            sha256: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08'
        };

        rootNode = await toSyncNodeLike(rootHandle);
        const status = await scanAndCalculateStatus(rootNode, s3Client, settings);

        expect(status).toHaveLength(1);
        const item = status[0];
        expect(item.localMoved).toBe(true);
        expect(item.remoteMoved).toBe(true);
        expect(item.isPathConflict).toBe(true);
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
        expect(status[0].recommendedContentAction).toBe(SyncAction.None);
    });

    test('Remote Reverted', async () => {
        // Setup Base
        const s3Dir = await rootHandle.getDirectoryHandle('.s3') as unknown as MockFileSystemDirectoryHandle;
        const baseDir = s3Dir.getEntry('m') as MockFileSystemDirectoryHandle;
        const baseRecord = {
            uuid: 'uuid-1',
            key: 'test-prefix/file.txt',
            version: 'v2', // Base is v2
            syncVersion: 2, // Base syncVer 2
            deviceName: 'dev',
            sha256: 'hash-v2',
            contentLength: 4,
            lastModifiedLocal: new Date().toISOString(),
            compressionMethod: ''
        };
        baseDir.addFile('.index.json', JSON.stringify({ 'file.txt': baseRecord }));

        // Local: Unchanged (v2)
        rootHandle.addFile('file.txt', 'test');
        baseRecord.sha256 = '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08';
        baseDir.addFile('.index.json', JSON.stringify({ 'file.txt': baseRecord }));

        // Remote: Reverted to v1
        s3Client.versions.push({
            Key: 'test-prefix/file.txt',
            VersionId: 'v1',
            IsLatest: true
        });
        s3Client.metadata['test-prefix/file.txt'] = {
            uuid: 'uuid-1',
            syncversion: '1', // Remote syncVer 1 (< 2)
            sha256: 'hash-v1'
        };

        rootNode = await toSyncNodeLike(rootHandle);
        const status = await scanAndCalculateStatus(rootNode, s3Client, settings);

        expect(status).toHaveLength(1);
        expect(status[0].remoteStatus).toBe(FileStatus.Reverted);
        expect(status[0].isWarning).toBe(true);
        expect(status[0].recommendedContentAction).toBe(SyncAction.CopyRemoteToLocal);
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
});
