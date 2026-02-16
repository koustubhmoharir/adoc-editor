
import { test, expect } from '@playwright/test';
import { scanAndCalculateStatus, DirNodeLike, FileStatus, SyncContentAction, SyncPathAction, writeBaseMetadata, updateDirectoryUuidMap, S3Paths } from '../src/store/S3SyncLogic';
import { MockFileSystemDirectoryHandle, MockFileSystemFileHandle } from './helpers/mock_fs_handles';
import { MockS3Client } from './helpers/mock_s3_client';
import { S3SyncSettings } from '../src/file_system/S3SyncSettings';

import { createHash } from 'crypto';
import { createDirectoryAtPath } from '../src/store/FileSystemHelpers';

// Enable trace logging only when DEBUG_TESTS is set
if (process.env.DEBUG_TESTS) {
    (globalThis as any).__TEST_ENABLE_TRACE_LOGGING = true;
}

// Helper to calculate SHA256 matches S3SyncLogic
function computeHash(content: string) {
    const digest = createHash('sha256').update(content).digest();
    return btoa(String.fromCharCode(...digest));
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

// Hard-coded real UUIDs for deterministic tests
const UUID_1 = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const UUID_2 = 'b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e';

const UUID_LOCAL = 'd4e5f6a7-b8c9-4d0e-1f2a-3b4c5d6e7f80';
const UUID_REMOTE = 'e5f6a7b8-c9d0-4e1f-2a3b-4c5d6e7f8091';
const UUID_BASE = 'f6a7b8c9-d0e1-4f2a-3b4c-5d6e7f809102';
const UUID_NESTED = '07b8c9d0-e1f2-4a3b-4c5d-6e7f80910213';
const UUID_ROOT = '18c9d0e1-f2a3-4b4c-5d6e-7f8091021324';

const settings: Readonly<S3SyncSettings> = {
    bucket: 'test-bucket',
    prefix: 'test-prefix/',
    region: 'us-east-1',
    identity_pool_id: 'id',
    authority: 'auth',
    client_id: 'client',
    device_name: 'test-device'
};

test('Empty local and remote should return empty status', async () => {
    const rootHandle = new MockFileSystemDirectoryHandle('root');
    const s3Client = new MockS3Client();

    const rootNode = await toSyncNodeLike(rootHandle);
    const status = await scanAndCalculateStatus(rootNode, s3Client as any, settings);
    expect(status).toEqual([]);
});

test('New Local File (No Base)', async () => {
    const rootHandle = new MockFileSystemDirectoryHandle('root');
    const s3Client = new MockS3Client();

    rootHandle.addFile('new.txt', 'test content');

    const rootNode = await toSyncNodeLike(rootHandle);
    const status = await scanAndCalculateStatus(rootNode, s3Client as any, settings);

    expect(status).toHaveLength(1);
    const item = status[0];
    expect(item.localStatus).toBe(FileStatus.New);
    expect(item.contentAction).toBe(SyncContentAction.CopyLocalToRemote);
});

test('New Remote File (No Base)', async () => {
    const rootHandle = new MockFileSystemDirectoryHandle('root');
    const s3Client = new MockS3Client();

    s3Client.addTextVersion('test-prefix/remote.txt', 'remote content', {
        uuid: UUID_REMOTE,
        syncVersion: 1,
        deviceName: 'other-device',
    });

    const rootNode = await toSyncNodeLike(rootHandle);
    const status = await scanAndCalculateStatus(rootNode, s3Client as any, settings);

    expect(status).toHaveLength(1);
    const item = status[0];
    expect(item.remoteStatus).toBe(FileStatus.New);
    expect(item.contentAction).toBe(SyncContentAction.CopyRemoteToLocal);
});

test('Unchanged File (Matches Base)', async () => {
    const rootHandle = new MockFileSystemDirectoryHandle('root');
    const s3Client = new MockS3Client();

    // Setup Base
    const content = 'test';
    const hash = computeHash(content);

    const baseRecord = {
        uuid: UUID_1,
        key: 'test-prefix/file.txt',
        version: 'v1',
        syncVersion: 1,
        deviceName: 'dev',
        sha256: hash,
        contentLength: content.length,
        lastModifiedLocal: new Date().toISOString(),
        compressionMethod: '',
        etag: 'etag'
    };
    await writeBaseMetadata(rootHandle, settings.prefix, baseRecord);

    // Local
    rootHandle.addFile('file.txt', content);
    await updateDirectoryUuidMap(rootHandle, { 'file.txt': UUID_1 });


    // Remote
    s3Client.addTextVersion('test-prefix/file.txt', content, {
        versionId: 'v1',
    });
    // Optimization: if key & version match base, we reuse base logic, so we don't need S3 metadata here if fetchRemoteRecords optimizes it.
    // But let's verify optimization works (no head request made if version matches).

    const rootNode = await toSyncNodeLike(rootHandle);
    const status = await scanAndCalculateStatus(rootNode, s3Client as any, settings);

    expect(status).toHaveLength(1);
    expect(status[0].localStatus).toBe(FileStatus.Unchanged);
    expect(status[0].remoteStatus).toBe(FileStatus.Unchanged);
    expect(status[0].contentAction).toBe(SyncContentAction.None);
});

test('Conflict (Both Changed)', async () => {
    const rootHandle = new MockFileSystemDirectoryHandle('root');
    const s3Client = new MockS3Client();

    // Setup Base
    const baseRecord = {
        uuid: UUID_1,
        key: 'test-prefix/file.txt',
        version: 'v1',
        syncVersion: 1,
        deviceName: 'dev',
        sha256: computeHash('old-content'),
        contentLength: 10,
        lastModifiedLocal: new Date().toISOString(),
        compressionMethod: '',
        etag: 'etag'
    };
    await writeBaseMetadata(rootHandle, settings.prefix, baseRecord);

    // Local: Changed
    rootHandle.addFile('file.txt', 'local change');
    await updateDirectoryUuidMap(rootHandle, { 'file.txt': UUID_1 });

    // Remote: Changed
    s3Client.addTextVersion('test-prefix/file.txt', 'remote change', {
        uuid: UUID_1,
        syncVersion: 2,
    });

    const rootNode = await toSyncNodeLike(rootHandle);
    const status = await scanAndCalculateStatus(rootNode, s3Client as any, settings);

    expect(status).toHaveLength(1);
    expect(status[0].isContentConflict).toBe(true);
});

test('Both New (Conflict)', async () => {
    const rootHandle = new MockFileSystemDirectoryHandle('root');
    const s3Client = new MockS3Client();

    // Local: New
    rootHandle.addFile('file.txt', 'local new');

    // Remote: New
    s3Client.addTextVersion('test-prefix/file.txt', 'remote new', {
        uuid: UUID_REMOTE,
        syncVersion: 1,
    });

    const rootNode = await toSyncNodeLike(rootHandle);
    const status = await scanAndCalculateStatus(rootNode, s3Client as any, settings);

    expect(status).toHaveLength(1);
    expect(status[0].isContentConflict).toBe(true);
});

test('Local Deleted (Remote Unchanged)', async () => {
    const rootHandle = new MockFileSystemDirectoryHandle('root');
    const s3Client = new MockS3Client();

    // Setup Base
    const baseRecord = {
        uuid: UUID_1,
        key: 'test-prefix/file.txt',
        version: 'v1',
        syncVersion: 1,
        deviceName: 'dev',
        sha256: computeHash('test'),
        contentLength: 4,
        lastModifiedLocal: new Date().toISOString(),
        compressionMethod: '',
        etag: 'etag'
    };
    await writeBaseMetadata(rootHandle, settings.prefix, baseRecord);

    // Local: Deleted (file missing)

    // Remote: Unchanged
    s3Client.addTextVersion('test-prefix/file.txt', 'test', {
        versionId: 'v1',
    });

    const rootNode = await toSyncNodeLike(rootHandle);
    const status = await scanAndCalculateStatus(rootNode, s3Client as any, settings);

    expect(status).toHaveLength(1);
    expect(status[0].localStatus).toBe(FileStatus.Deleted);
    expect(status[0].remoteStatus).toBe(FileStatus.Unchanged);
    expect(status[0].contentAction).toBe(SyncContentAction.DeleteRemote);
    expect(status[0].isWarning).toBe(true);
});

test('Remote Deleted (Local Unchanged)', async () => {
    const rootHandle = new MockFileSystemDirectoryHandle('root');
    const s3Client = new MockS3Client();

    // Setup Base
    const content = 'test';
    const hash = computeHash(content);
    const baseRecord = {
        uuid: UUID_1,
        key: 'test-prefix/file.txt',
        version: 'v1',
        syncVersion: 1,
        deviceName: 'dev',
        sha256: hash,
        contentLength: content.length,
        lastModifiedLocal: new Date().toISOString(),
        compressionMethod: '',
        etag: 'etag'
    };
    await writeBaseMetadata(rootHandle, settings.prefix, baseRecord);

    // Local: Unchanged
    rootHandle.addFile('file.txt', content);
    await updateDirectoryUuidMap(rootHandle, { 'file.txt': UUID_1 });


    // Remote: Deleted (no version in list)

    const rootNode = await toSyncNodeLike(rootHandle);
    const status = await scanAndCalculateStatus(rootNode, s3Client as any, settings);

    expect(status).toHaveLength(1);
    expect(status[0].remoteStatus).toBe(FileStatus.Deleted);
    expect(status[0].localStatus).toBe(FileStatus.Unchanged);
    expect(status[0].contentAction).toBe(SyncContentAction.DeleteLocal);
    expect(status[0].isWarning).toBe(true);
});

test('Local Modified vs Remote Deleted (Conflict)', async () => {
    const rootHandle = new MockFileSystemDirectoryHandle('root');
    const s3Client = new MockS3Client();

    // Setup Base
    const baseRecord = {
        uuid: UUID_1,
        key: 'test-prefix/file.txt',
        version: 'v1',
        syncVersion: 1,
        deviceName: 'dev',
        sha256: computeHash('original'),
        contentLength: 4,
        lastModifiedLocal: new Date().toISOString(),
        compressionMethod: '',
        etag: 'etag'
    };
    await writeBaseMetadata(rootHandle, settings.prefix, baseRecord);

    // Local: Modified
    rootHandle.addFile('file.txt', 'modified'); // Changed content/size

    // Remote: Deleted

    const rootNode = await toSyncNodeLike(rootHandle);
    const status = await scanAndCalculateStatus(rootNode, s3Client as any, settings);

    expect(status).toHaveLength(1);
    expect(status[0].isContentConflict).toBe(true);
});

test('Remote Modified vs Local Deleted (Conflict)', async () => {
    const rootHandle = new MockFileSystemDirectoryHandle('root');
    const s3Client = new MockS3Client();

    // Setup Base
    const baseRecord = {
        uuid: UUID_1,
        key: 'test-prefix/file.txt',
        version: 'v1',
        syncVersion: 1,
        deviceName: 'dev',
        sha256: computeHash('original'),
        contentLength: 4,
        lastModifiedLocal: new Date().toISOString(),
        compressionMethod: '',
        etag: 'etag'
    };
    await writeBaseMetadata(rootHandle, settings.prefix, baseRecord);

    // Local: Deleted

    // Remote: Modified (v2)
    s3Client.addTextVersion('test-prefix/file.txt', 'modified remote', {
        uuid: UUID_1,
        syncVersion: 2,
    });

    const rootNode = await toSyncNodeLike(rootHandle);
    const status = await scanAndCalculateStatus(rootNode, s3Client as any, settings);

    expect(status).toHaveLength(1);
    expect(status[0].isContentConflict).toBe(true);
});

test('Local Move', async () => {
    const rootHandle = new MockFileSystemDirectoryHandle('root');
    const s3Client = new MockS3Client();

    // Setup Base
    const content = 'test';
    const hash = computeHash(content);
    const baseRecord = {
        uuid: UUID_1,
        key: 'test-prefix/old.txt',
        version: 'v1',
        syncVersion: 1,
        deviceName: 'dev',
        sha256: hash,
        contentLength: content.length,
        lastModifiedLocal: new Date().toISOString(),
        compressionMethod: '',
        etag: 'etag'
    };
    await writeBaseMetadata(rootHandle, settings.prefix, baseRecord);

    // Local: Moved to new.txt (and same content 'test')
    rootHandle.addFile('new.txt', content);
    await updateDirectoryUuidMap(rootHandle, { 'new.txt': UUID_1 });

    // Remote: Unchanged (old.txt exists)
    s3Client.addTextVersion('test-prefix/old.txt', content, {
        versionId: 'v1',
    });

    const rootNode = await toSyncNodeLike(rootHandle);
    const status = await scanAndCalculateStatus(rootNode, s3Client as any, settings);

    expect(status).toHaveLength(1);
    const item = status[0];
    expect(item.localMoved).toBe(true);
    expect(item.pathAction).toBe(SyncPathAction.UseLocalPath);
});

test('Remote Move', async () => {
    const rootHandle = new MockFileSystemDirectoryHandle('root');
    const s3Client = new MockS3Client();

    // Setup Base
    const content = 'test';
    const hash = computeHash(content);
    const baseRecord = {
        uuid: UUID_1,
        key: 'test-prefix/old.txt',
        version: 'v1',
        syncVersion: 1,
        deviceName: 'dev',
        sha256: hash,
        contentLength: content.length,
        lastModifiedLocal: new Date().toISOString(),
        compressionMethod: '',
        etag: 'etag'
    };
    await writeBaseMetadata(rootHandle, settings.prefix, baseRecord);

    // Local: Unchanged (old.txt)
    rootHandle.addFile('old.txt', content);
    await updateDirectoryUuidMap(rootHandle, { 'old.txt': UUID_1 });

    // Remote: Moved to new.txt
    s3Client.addTextVersion('test-prefix/new.txt', content, {
        uuid: UUID_1,
        syncVersion: 1,
        versionId: 'v1',
    });

    const rootNode = await toSyncNodeLike(rootHandle);
    const status = await scanAndCalculateStatus(rootNode, s3Client as any, settings);

    expect(status).toHaveLength(1);
    const item = status[0];
    expect(item.remoteMoved).toBe(true);
    expect(item.pathAction).toBe(SyncPathAction.UseRemotePath);
});

test('Fast Check (Hash Match)', async () => {
    const rootHandle = new MockFileSystemDirectoryHandle('root');
    const s3Client = new MockS3Client();

    // Setup Base
    const content = 'test';
    const hash = computeHash(content);
    const baseRecord = {
        uuid: UUID_1,
        key: 'test-prefix/old.txt',
        version: 'v1',
        syncVersion: 1,
        deviceName: 'dev',
        sha256: hash,
        contentLength: content.length,
        lastModifiedLocal: new Date().toISOString(),
        compressionMethod: '',
        etag: 'etag'
    };
    await writeBaseMetadata(rootHandle, settings.prefix, baseRecord);

    // Local: new.txt with "test", NO UUID
    rootHandle.addFile('new.txt', content);

    // Remote: Deleted

    const rootNode = await toSyncNodeLike(rootHandle);
    const status = await scanAndCalculateStatus(rootNode, s3Client as any, settings);

    expect(status).toHaveLength(1);
    const item = status[0];
    // Match happens via SHA256 match in matchBaseWithLocal (Step 3)
    // because UUID match fails (no uuid for local) and Path match fails (old vs new).

    expect(item.localMoved).toBe(true);
    expect(item.localStatus).toBe(FileStatus.Unchanged);
});

test('Local Changed (Remote Unchanged)', async () => {
    const rootHandle = new MockFileSystemDirectoryHandle('root');
    const s3Client = new MockS3Client();

    // Setup Base
    const content = 'test';
    const baseRecord = {
        uuid: UUID_1,
        key: 'test-prefix/file.txt',
        version: 'v1',
        syncVersion: 1,
        deviceName: 'dev',
        sha256: computeHash(content),
        contentLength: 4,
        lastModifiedLocal: new Date().toISOString(),
        compressionMethod: '',
        etag: 'etag'
    };
    await writeBaseMetadata(rootHandle, settings.prefix, baseRecord);

    // Local: Changed
    rootHandle.addFile('file.txt', 'changed-content');
    await updateDirectoryUuidMap(rootHandle, { 'file.txt': UUID_1 });

    // Remote: Unchanged
    s3Client.addTextVersion('test-prefix/file.txt', content, {
        versionId: 'v1',
    });

    const rootNode = await toSyncNodeLike(rootHandle);
    const status = await scanAndCalculateStatus(rootNode, s3Client as any, settings);

    expect(status).toHaveLength(1);
    const item = status[0];
    expect(item.localStatus).toBe(FileStatus.Changed);
    expect(item.contentAction).toBe(SyncContentAction.CopyLocalToRemote);
});

test('Both Moved (Path Conflict)', async () => {
    const rootHandle = new MockFileSystemDirectoryHandle('root');
    const s3Client = new MockS3Client();

    // Setup Base
    const content = 'test';
    const hash = computeHash(content);
    const baseRecord = {
        uuid: UUID_1,
        key: 'test-prefix/old.txt',
        version: 'v1',
        syncVersion: 1,
        deviceName: 'dev',
        sha256: hash,
        contentLength: content.length,
        lastModifiedLocal: new Date().toISOString(),
        compressionMethod: '',
        etag: 'etag'
    };
    await writeBaseMetadata(rootHandle, settings.prefix, baseRecord);

    // Local: Moved to local.txt
    rootHandle.addFile('local.txt', content);
    await updateDirectoryUuidMap(rootHandle, { 'local.txt': UUID_1 });

    // Remote: Moved to remote.txt
    s3Client.addTextVersion('test-prefix/remote.txt', content, {
        uuid: UUID_1,
        syncVersion: 1,
        versionId: 'v1',
    });

    const rootNode = await toSyncNodeLike(rootHandle);
    const status = await scanAndCalculateStatus(rootNode, s3Client as any, settings);

    expect(status).toHaveLength(1);
    expect(status[0].isPathConflict).toBe(true);
});

test('Both Deleted', async () => {
    const rootHandle = new MockFileSystemDirectoryHandle('root');
    const s3Client = new MockS3Client();

    // Setup Base
    const baseRecord = {
        uuid: UUID_1,
        key: 'test-prefix/file.txt',
        version: 'v1',
        syncVersion: 1,
        deviceName: 'dev',
        sha256: computeHash('original'),
        contentLength: 4,
        lastModifiedLocal: new Date().toISOString(),
        compressionMethod: '',
        etag: 'etag'
    };
    await writeBaseMetadata(rootHandle, settings.prefix, baseRecord);

    // Local: Deleted
    // Remote: Deleted

    const rootNode = await toSyncNodeLike(rootHandle);
    const status = await scanAndCalculateStatus(rootNode, s3Client as any, settings);

    expect(status).toHaveLength(1);
    expect(status[0].contentAction).toBe(SyncContentAction.None);
});

test('Remote Reverted', async () => {
    const rootHandle = new MockFileSystemDirectoryHandle('root');
    const s3Client = new MockS3Client();

    // Setup Base
    const baseRecord = {
        uuid: UUID_1,
        key: 'test-prefix/file.txt',
        version: 'v2',
        syncVersion: 2,
        deviceName: 'dev',
        sha256: computeHash('test'),
        contentLength: 4,
        lastModifiedLocal: new Date().toISOString(),
        compressionMethod: '',
        etag: 'etag'
    };
    await writeBaseMetadata(rootHandle, settings.prefix, baseRecord);

    // Local: Unchanged (v2)
    rootHandle.addFile('file.txt', 'test');

    // Remote: Reverted to v1
    s3Client.addTextVersion('test-prefix/file.txt', 'old version', {
        uuid: UUID_1,
        syncVersion: 1,
        versionId: 'v1',
    });

    const rootNode = await toSyncNodeLike(rootHandle);
    const status = await scanAndCalculateStatus(rootNode, s3Client as any, settings);

    expect(status).toHaveLength(1);
    expect(status[0].remoteStatus).toBe(FileStatus.Reverted);
    expect(status[0].isWarning).toBe(true);
});

test('Remote Unknown (No SyncVer)', async () => {
    const rootHandle = new MockFileSystemDirectoryHandle('root');
    const s3Client = new MockS3Client();

    // Setup Base
    const baseRecord = {
        uuid: UUID_1,
        key: 'test-prefix/file.txt',
        version: 'v1',
        syncVersion: 1,
        deviceName: 'dev',
        sha256: computeHash('test'),
        contentLength: 4,
        lastModifiedLocal: new Date().toISOString(),
        compressionMethod: '',
        etag: 'etag'
    };
    await writeBaseMetadata(rootHandle, settings.prefix, baseRecord);

    // Local: Unchanged
    rootHandle.addFile('file.txt', 'test');

    // Remote: No sync metadata (uuid present but no syncversion)
    s3Client.addTextVersion('test-prefix/file.txt', 'different content', {
        uuid: UUID_1,
        // NO syncVersion
    });

    const rootNode = await toSyncNodeLike(rootHandle);
    const status = await scanAndCalculateStatus(rootNode, s3Client as any, settings);

    expect(status).toHaveLength(1);
    expect(status[0].remoteStatus).toBe(FileStatus.Unknown);
    expect(status[0].isWarning).toBe(true);
});

test('Remote Unknown (Hash Mismatch, Same SyncVer)', async () => {
    const rootHandle = new MockFileSystemDirectoryHandle('root');
    const s3Client = new MockS3Client();

    // Setup Base
    const baseRecord = {
        uuid: UUID_1,
        key: 'test-prefix/file.txt',
        version: 'v1',
        syncVersion: 1,
        deviceName: 'dev',
        sha256: computeHash('test'),
        contentLength: 4,
        lastModifiedLocal: new Date().toISOString(),
        compressionMethod: '',
        etag: 'etag'
    };
    await writeBaseMetadata(rootHandle, settings.prefix, baseRecord);

    // Local: Unchanged
    rootHandle.addFile('file.txt', 'test');

    // Remote: Same SyncVer, Diff Hash
    s3Client.addTextVersion('test-prefix/file.txt', 'tampered content', {
        uuid: UUID_1,
        syncVersion: 1,
    });

    const rootNode = await toSyncNodeLike(rootHandle);
    const status = await scanAndCalculateStatus(rootNode, s3Client as any, settings);

    expect(status).toHaveLength(1);
    expect(status[0].remoteStatus).toBe(FileStatus.Unknown);
    expect(status[0].isWarning).toBe(true);
});

test('New Remote File (Nested, No Metadata) triggers getOrCreateDirectory', async () => {
    const rootHandle = new MockFileSystemDirectoryHandle('root');
    const s3Client = new MockS3Client();

    // Remote: Unsynced file in subfolder (no metadata)
    s3Client.addTextVersion('test-prefix/nested/remote.txt', 'nested content');

    const rootNode = await toSyncNodeLike(rootHandle);
    const status = await scanAndCalculateStatus(rootNode, s3Client as any, settings);

    expect(status).toHaveLength(1);
    // Should be treated as New Remote
    expect(status[0].remoteStatus).toBe(FileStatus.New);
});

test('Nested Sync Root Ignored', async () => {
    const rootHandle = new MockFileSystemDirectoryHandle('root');
    const s3Client = new MockS3Client();

    // Local: subfolder which is a sync root
    const nested = rootHandle.addDirectory('nested');
    nested.addFile('file.txt', 'ignored');

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

    const status = await scanAndCalculateStatus(customRoot, s3Client as any, settings);

    expect(status).toHaveLength(0); // Should skip the file inside nested
});

test('Ignore File (ignore.toml)', async () => {
    const rootHandle = new MockFileSystemDirectoryHandle('root');
    const s3Client = new MockS3Client();

    // Local: ignore.toml present
    const ignoreDir = rootHandle.addDirectory('.adoc-editor');
    ignoreDir.addFile('ignore.toml', 'some config');

    // S3 Sync should INCLUDE ignore.toml in the listing

    const rootNode = await toSyncNodeLike(rootHandle);
    const status = await scanAndCalculateStatus(rootNode, s3Client as any, settings);

    expect(status).toHaveLength(1);
    expect(status[0].local?.key).toBe('test-prefix/.adoc-editor/ignore.toml');
});

test('Local Files in Subdirectories', async () => {
    const rootHandle = new MockFileSystemDirectoryHandle('root');
    const s3Client = new MockS3Client();

    const subdir = await rootHandle.getDirectoryHandle('subdir', { create: true }) as unknown as MockFileSystemDirectoryHandle;
    subdir.addFile('subfile.txt', 'sub-content');

    const rootNode = await toSyncNodeLike(rootHandle);
    const status = await scanAndCalculateStatus(rootNode, s3Client as any, settings);

    expect(status).toHaveLength(1);
    expect(status[0].local?.key).toBe('test-prefix/subdir/subfile.txt');
    expect(status[0].localStatus).toBe(FileStatus.New);
});

test('Verify Caching of HEAD requests (Second scan uses cache)', async () => {
    const rootHandle = new MockFileSystemDirectoryHandle('root');
    const s3Client = new MockS3Client();

    // Remote file with NO metadata in List response (mock default)
    s3Client.addTextVersion('test-prefix/remote.txt', 'some content');
    // HeadObject will be called to fetch metadata

    // Spy on send
    let callCount = 0;
    const originalSend = s3Client.send.bind(s3Client);
    s3Client.send = (async (command: any) => {
        callCount++;
        return originalSend(command);
    }) as any;

    // First Scan
    let rootNode = await toSyncNodeLike(rootHandle);
    await scanAndCalculateStatus(rootNode, s3Client as any, settings);

    // Expect List + Head = 2 calls
    expect(callCount).toBeGreaterThanOrEqual(2);

    // Second Scan
    // The first scan should have written to .adoc-editor/s3/remote cache
    callCount = 0;
    await scanAndCalculateStatus(rootNode, s3Client as any, settings);

    // Expect List only = 1 call. Head should be skipped due to cache.
    expect(callCount).toBe(1);
});

test('Match Logic Step 2 (Path Match, Missing UUID)', async () => {
    const rootHandle = new MockFileSystemDirectoryHandle('root');
    const s3Client = new MockS3Client();

    // Base: Has UUID
    // Base: Has UUID
    const baseRecord = {
        uuid: UUID_1,
        key: 'test-prefix/file.txt',
        version: 'v1',
        syncVersion: 1,
        deviceName: 'dev',
        sha256: computeHash('old-content'),
        contentLength: 4,
        lastModifiedLocal: new Date().toISOString(),
        compressionMethod: '',
        etag: 'etag'
    };
    await writeBaseMetadata(rootHandle, settings.prefix, baseRecord);

    // Remote: Matches Path, but NO metadata (so no UUID)
    s3Client.addTextVersion('test-prefix/file.txt', 'some content');

    const rootNode = await toSyncNodeLike(rootHandle);
    const status = await scanAndCalculateStatus(rootNode, s3Client as any, settings);

    expect(status).toHaveLength(1);
    expect(status[0].base).toBeDefined();
    expect(status[0].remote).toBeDefined();
    expect(status[0].remote!.key).toBe(baseRecord.key);
    expect(status[0].remote!.uuid).toBe(''); // Confirms missing UUID
});

test('Match Logic Step 3 (Hash Match, Missing UUID, Different Path)', async () => {
    const rootHandle = new MockFileSystemDirectoryHandle('root');
    const s3Client = new MockS3Client();

    const someContent = 'test-content-for-hash';
    const contentHash = computeHash(someContent);

    // Base: UUID_1, hash matches content
    // Base: UUID_1, hash matches content
    const baseRecord = {
        uuid: UUID_1,
        key: 'test-prefix/old.txt',
        version: 'v1',
        syncVersion: 1,
        deviceName: 'dev',
        sha256: contentHash,
        contentLength: 10,
        lastModifiedLocal: new Date().toISOString(),
        compressionMethod: '',
        etag: 'etag'
    };
    await writeBaseMetadata(rootHandle, settings.prefix, baseRecord);

    // Remote: Path B, NO UUID, Match Hash 'common-hash' (via content match)
    s3Client.addTextVersion('test-prefix/new.txt', someContent);

    const rootNode = await toSyncNodeLike(rootHandle);
    const status = await scanAndCalculateStatus(rootNode, s3Client as any, settings);

    expect(status).toHaveLength(1);
    expect(status[0].remoteMoved).toBe(true);
    expect(status[0].pathAction).toBe(SyncPathAction.UseRemotePath);
});

test('Local Unchanged + Remote Changed', async () => {
    const rootHandle = new MockFileSystemDirectoryHandle('root');
    const s3Client = new MockS3Client();

    // Base
    // Base
    const content = 'v1-content';
    const hash1 = computeHash(content);

    const baseRecord = {
        uuid: UUID_1,
        key: 'test-prefix/file.txt',
        version: 'v1',
        syncVersion: 1,
        deviceName: 'dev',
        sha256: hash1,
        contentLength: content.length,
        lastModifiedLocal: new Date().toISOString(),
        compressionMethod: '',
        etag: 'etag'
    };
    await writeBaseMetadata(rootHandle, settings.prefix, baseRecord);

    // Local: Matches Base
    rootHandle.addFile('file.txt', content);

    // Remote: Changed (Different Version, Different Hash, SyncVer 2)
    s3Client.addTextVersion('test-prefix/file.txt', 'v2-content', {
        uuid: UUID_1,
        syncVersion: 2,
    });

    const rootNode = await toSyncNodeLike(rootHandle);
    const status = await scanAndCalculateStatus(rootNode, s3Client as any, settings);

    expect(status).toHaveLength(1);
    expect(status[0].localStatus).toBe(FileStatus.Unchanged);
    expect(status[0].remoteStatus).toBe(FileStatus.Changed);
    expect(status[0].contentAction).toBe(SyncContentAction.CopyRemoteToLocal);
});

test('Verify readRecords recursion (nested base/remote cache)', async () => {
    const rootHandle = new MockFileSystemDirectoryHandle('root');
    const s3Client = new MockS3Client();

    // Setup: Create a nested structure in base metadata
    const baseRecord = {
        uuid: UUID_NESTED,
        key: 'test-prefix/nested/file.txt',
        version: 'v1',
        syncVersion: 1,
        deviceName: 'dev',
        sha256: computeHash('content-n'),
        contentLength: 10,
        lastModifiedLocal: new Date().toISOString(),
        compressionMethod: '',
        etag: 'etag'
    };
    await writeBaseMetadata(rootHandle, settings.prefix, baseRecord);

    // Trigger scan
    const rootNode = await toSyncNodeLike(rootHandle);
    const status = await scanAndCalculateStatus(rootNode, s3Client as any, settings);

    // If recursion works, base record should be loaded
    // Since no remote or local, it should show as Deleted Remote
    expect(status).toHaveLength(1);
    expect(status[0].base?.key).toBe('test-prefix/nested/file.txt');
    expect(status[0].remoteStatus).toBe(FileStatus.Deleted);
});

test('Verify writeRemoteRecordsCache merging', async () => {
    const rootHandle = new MockFileSystemDirectoryHandle('root');
    const s3Client = new MockS3Client();

    // Setup: Pre-populate remote cache with an existing record
    const metaCacheDir = await createDirectoryAtPath(rootHandle, S3Paths.metaCacheDir) as unknown as MockFileSystemDirectoryHandle;

    const existingRecord = {
        uuid: UUID_1,
        key: 'test-prefix/existing.txt',
        version: 'v1',
        syncVersion: 1,
        deviceName: 'dev',
        sha256: computeHash('existing content'),
        contentLength: 10,
        lastModified: new Date().toISOString()
    };
    metaCacheDir.addFile('.index.json', JSON.stringify({ 'existing.txt': existingRecord }));

    // Remote: existing.txt (Matches cache) AND new.txt (New)
    s3Client.addTextVersion('test-prefix/existing.txt', 'existing content', {
        versionId: 'v1',
    });
    s3Client.addTextVersion('test-prefix/new.txt', 'new content', {
        uuid: UUID_2,
        syncVersion: 1,
    });

    // Trigger scan
    const rootNode = await toSyncNodeLike(rootHandle);
    await scanAndCalculateStatus(rootNode, s3Client as any, settings);

    // Verify cache file contains BOTH records
    const cacheFile = await metaCacheDir.getFileHandle('.index.json');
    const file = await cacheFile.getFile();
    const content = JSON.parse(await file.text());

    expect(content['existing.txt']).toBeDefined();
    expect(content['new.txt']).toBeDefined();
    expect(content['existing.txt'].uuid).toBe(UUID_1);
    expect(content['new.txt'].uuid).toBe(UUID_2);
});

test('Empty S3 Prefix', async () => {
    const rootHandle = new MockFileSystemDirectoryHandle('root');
    const s3Client = new MockS3Client();

    // Setup: empty prefix settings
    const emptyPrefixSettings = { ...settings, prefix: '' };

    // Remote file at root of bucket
    s3Client.addTextVersion('root-file.txt', 'root content', {
        uuid: UUID_ROOT,
        syncVersion: 1,
    });

    const rootNode = await toSyncNodeLike(rootHandle);
    const status = await scanAndCalculateStatus(rootNode, s3Client as any, emptyPrefixSettings);

    expect(status).toHaveLength(1);
    expect(status[0].remote?.key).toBe('root-file.txt');
});

test('Identical Hash but Different UUID', async () => {
    const rootHandle = new MockFileSystemDirectoryHandle('root');
    const s3Client = new MockS3Client();

    const commonContent = 'some content';
    const commonHash = computeHash(commonContent);

    // Base: UUID_1
    const baseRecord = {
        uuid: UUID_1,
        key: 'test-prefix/file.txt',
        version: 'v1',
        syncVersion: 1,
        deviceName: 'dev',
        sha256: commonHash,
        contentLength: 10,
        lastModifiedLocal: new Date().toISOString(),
        compressionMethod: '',
        etag: 'etag'
    };
    await writeBaseMetadata(rootHandle, settings.prefix, baseRecord);

    // Remote: UUID_2, but MATCHING hash
    s3Client.addTextVersion('test-prefix/file.txt', commonContent, {
        uuid: UUID_2,
        syncVersion: 1,
    });

    const rootNode = await toSyncNodeLike(rootHandle);
    const status = await scanAndCalculateStatus(rootNode, s3Client as any, settings);

    // They have the same path.
    // Step 1 (UUID Match): No match.
    // Step 2 (Path Match): Both have UUIDs, and they differ. So NO match.
    // Step 3 (Hash Match): Both have UUIDs, different. So NO match.
    // Result: Base -> Deleted Remote. Remote -> New.
    expect(status).toHaveLength(2);
    const baseItem = status.find(s => s.base?.uuid === UUID_1);
    const remoteItem = status.find(s => s.remote?.uuid === UUID_2);

    expect(baseItem).toBeDefined();
    expect(remoteItem).toBeDefined();
    expect(baseItem!.remoteStatus).toBe(FileStatus.Deleted);
    expect(remoteItem!.remoteStatus).toBe(FileStatus.New);
});

test('Missing Metadata (UUID/SyncVersion) in HeadObject response', async () => {
    const rootHandle = new MockFileSystemDirectoryHandle('root');
    const s3Client = new MockS3Client();

    // Remote file with NO metadata
    s3Client.addTextVersion('test-prefix/no-meta.txt', 'no metadata file');

    const rootNode = await toSyncNodeLike(rootHandle);
    const status = await scanAndCalculateStatus(rootNode, s3Client as any, settings);

    expect(status).toHaveLength(1);
    expect(status[0].remote?.key).toBe('test-prefix/no-meta.txt');
    expect(status[0].remote?.uuid).toBe('');
    expect(status[0].remote?.syncVersion).toBe(0);
});

test('Local UUID Mismatch (Same Path) - Should NOT match', async () => {
    const rootHandle = new MockFileSystemDirectoryHandle('root');
    const s3Client = new MockS3Client();

    // Base Record: path matching local, but has specific UUID
    const baseRecord = {
        uuid: UUID_BASE,
        key: 'test-prefix/conflict.txt',
        version: 'v1',
        syncVersion: 1,
        deviceName: 'dev',
        sha256: computeHash('content'),
        contentLength: 10,
        lastModifiedLocal: new Date().toISOString(),
        compressionMethod: '',
        etag: 'etag'
    };
    await writeBaseMetadata(rootHandle, settings.prefix, baseRecord);

    // Local File: Same path, but DIFFERENT UUID
    const s3LocalDir = rootHandle.addDirectory('.s3');
    s3LocalDir.addFile('uuids.json', JSON.stringify({ 'conflict.txt': UUID_LOCAL }));

    rootHandle.addFile('conflict.txt', 'some content');

    const rootNode = await toSyncNodeLike(rootHandle);
    const status = await scanAndCalculateStatus(rootNode, s3Client as any, settings);

    // Step 2 (Path Match) checks: !br.uuid || !lr.uuid || br.uuid === lr.uuid
    // Here: UUID_BASE !== UUID_LOCAL. So NO MATCH.
    // Result: Two status items.
    expect(status).toHaveLength(2);
    const baseItem = status.find(s => s.base?.uuid === UUID_BASE);
    const localItem = status.find(s => s.local?.uuid === UUID_LOCAL);

    expect(baseItem).toBeDefined();
    expect(baseItem!.localStatus).toBe(FileStatus.Deleted);

    expect(localItem).toBeDefined();
    expect(localItem!.localStatus).toBe(FileStatus.New);
});

test('Local UUID Mismatch (Different Path, Same Hash) - Should NOT match', async () => {
    const rootHandle = new MockFileSystemDirectoryHandle('root');
    const s3Client = new MockS3Client();

    // Base Record
    const sameContent = 'same-content';
    const sameContentHash = computeHash(sameContent);

    const baseRecord = {
        uuid: UUID_BASE,
        key: 'test-prefix/old.txt',
        version: 'v1',
        syncVersion: 1,
        deviceName: 'dev',
        sha256: sameContentHash,
        contentLength: sameContent.length,
        lastModifiedLocal: new Date().toISOString(),
        compressionMethod: '',
        etag: 'etag'
    };
    await writeBaseMetadata(rootHandle, settings.prefix, baseRecord);

    // Local File: Different path, same content (hash), DIFFERENT UUID
    const s3LocalDir = rootHandle.addDirectory('.s3');
    s3LocalDir.addFile('uuids.json', JSON.stringify({ 'new.txt': UUID_LOCAL }));

    rootHandle.addFile('new.txt', sameContent);

    const rootNode = await toSyncNodeLike(rootHandle);
    const status = await scanAndCalculateStatus(rootNode, s3Client as any, settings);

    // Step 3: Hash matches (real hash). UUID check: UUID_BASE !== UUID_LOCAL. Should FAIL matching.
    expect(status).toHaveLength(2);
    const baseItem = status.find(s => s.base?.key === 'test-prefix/old.txt');
    const localItem = status.find(s => s.local?.key === 'test-prefix/new.txt');

    expect(baseItem).toBeDefined();
    expect(baseItem!.localStatus).toBe(FileStatus.Deleted);

    expect(localItem).toBeDefined();
    expect(localItem!.localStatus).toBe(FileStatus.New);
});

test('Local Hash Match (Different Path) - Missing Base UUID (Should Match)', async () => {
    const rootHandle = new MockFileSystemDirectoryHandle('root');
    const s3Client = new MockS3Client();

    // Base: Hash-X, No UUID
    const sharedContentHash = computeHash('shared-content');

    const baseRecord = {
        uuid: '', // Missing UUID
        key: 'test-prefix/base-no-uuid.txt',
        version: 'v1',
        syncVersion: 1,
        deviceName: 'dev',
        sha256: sharedContentHash,
        contentLength: 14, // 'shared-content' is 14 chars
        lastModifiedLocal: new Date().toISOString(),
        compressionMethod: '',
        etag: 'etag'
    };
    await writeBaseMetadata(rootHandle, settings.prefix, baseRecord);

    // Local: Hash-X, Has UUID
    const s3LocalDir = rootHandle.addDirectory('.s3');
    s3LocalDir.addFile('uuids.json', JSON.stringify({ 'local-moved.txt': UUID_LOCAL }));
    rootHandle.addFile('local-moved.txt', 'shared-content');

    const rootNode = await toSyncNodeLike(rootHandle);
    const status = await scanAndCalculateStatus(rootNode, s3Client as any, settings);

    // Step 3 (Hash): Matches.
    // Condition: !br.uuid (True) || ... -> True.
    expect(status).toHaveLength(1);
    expect(status[0].base?.key).toBe('test-prefix/base-no-uuid.txt');
    expect(status[0].local?.key).toBe('test-prefix/local-moved.txt');
    expect(status[0].localMoved).toBe(true);
});

test('Local Hash Match (Different Path) - Missing Local UUID (Should Match)', async () => {
    const rootHandle = new MockFileSystemDirectoryHandle('root');
    const s3Client = new MockS3Client();
    const settings = { bucket: 'test-bucket', prefix: 'test-prefix/', region: 'us-east-1', identity_pool_id: 'id', authority: 'auth', client_id: 'client', device_name: 'test-device' };

    // Base: Hash-X, Has UUID
    const sharedContentHash = computeHash('shared-content');
    const baseRecord = {
        uuid: UUID_BASE,
        key: 'test-prefix/base-has-uuid.txt',
        version: 'v1',
        syncVersion: 1,
        deviceName: 'dev',
        sha256: sharedContentHash,
        contentLength: 14,
        lastModifiedLocal: new Date().toISOString(),
        compressionMethod: '',
        etag: 'etag'
    };
    await writeBaseMetadata(rootHandle, settings.prefix, baseRecord);

    // Local: Hash-X, No UUID (e.g. fresh file)
    // No uuids.json entry for this file
    rootHandle.addFile('local-fresh.txt', 'shared-content');

    const rootNode = await toSyncNodeLike(rootHandle);
    const status = await scanAndCalculateStatus(rootNode, s3Client as any, settings);

    // Match
    expect(status).toHaveLength(1);
    expect(status[0].base?.key).toBe('test-prefix/base-has-uuid.txt');
    expect(status[0].local?.key).toBe('test-prefix/local-fresh.txt');
    expect(status[0].localMoved).toBe(true);
});
