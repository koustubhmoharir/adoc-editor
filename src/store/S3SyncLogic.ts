
import { S3Client, ListObjectVersionsCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { Sha256 } from "@aws-crypto/sha256-browser";
import { S3SyncSettings } from "../file_system/S3SyncSettings";
import { traceLog } from "../utils/trace";

/**
 * Information about an object version in s3
 */
export interface S3VersionRecord {
    /**
     * uuid to track / moves even if key / path changes
     * Stored in metadata
     */
    uuid: string;
    /**
     * Full key in s3 bucket
     */
    key: string;
    /**
     * s3 object version
     */
    version: string;
    /**
     * integer to help with conflict resolution because s3 object version is not ordered
     * Stored in metadata
     */
    syncVersion: number;
    deviceName: string;
    etag?: string;
    sha256?: string;
    contentLength?: number;
    lastModified?: string;
}

/**
 * Information about the base (last synced with s3) version and some information about the current local file
 */
export interface BaseVersionRecord extends S3VersionRecord {
    /**
     * Hash of the base version. Redefined here as not-nullable. This is *not* the hash of the local file.
     */
    sha256: string;
    /**
     * contentLength of the base version. Redefined here as not-nullable. This is *not* the contentLength of the local file.
     */
    contentLength: number;
    /**
     * The time that can be used to bypass a full hash check by simply comparing against local file system modified time (along with a check on the contentLength).
     * If it is the same, we assume no change. This is not safe, but a full hash calculation of every file would be too expensive.
     * This can be updated whenever a full hash is calculated to match or not match the local file system modified time as appropriate.
     */
    lastModifiedLocal: string;
    /**
     * Compression algorithm applied to the base file content. Can be an empty string if the content is not compressed.
     */
    compressionMethod: string;
}

export interface LocalFileRecord {
    uuid: string;
    key: string;
    sha256?: string;
    contentLength: number;
    lastModified: string;
    handle: FileSystemFileHandle;
}

function pathToDirAndFileName(path: string) {
    const i = path.lastIndexOf('/');
    if (i >= 0) {
        return [path.substring(0, i), path.substring(i + 1)];
    }
    return ['', path];
}

async function getOrCreateDirectory(dir: FileSystemDirectoryHandle, ...dirNames: string[]) {
    let path = ''
    for (const name of dirNames) {
        try {
            dir = await dir.getDirectoryHandle(name, { create: true });
            path += `${name}/`;
        }
        catch {
            console.error(`Could not get or create directory ${name} at ${path}`);
            return undefined;
        }
    }
    return dir;
}

export interface FileNodeLike {
    name: string;
    kind: 'file';
    handle: FileSystemFileHandle;
}

export interface DirNodeLike {
    name: string;
    kind: 'directory';
    handle: FileSystemDirectoryHandle;
    children: (DirNodeLike | FileNodeLike)[] | undefined;
    hasS3SyncConfig?: boolean;
}

async function scanLocalFiles(rootNode: DirNodeLike, s3Prefix: string): Promise<Map<string, LocalFileRecord>> {
    const filesByPath = new Map<string, LocalFileRecord>();

    const scan = async (dirNode: DirNodeLike, currentPath: string) => {
        // map of file name to uuids
        // this is created with a null prototype to avoid surprises when accessing entries.
        const uuids: Record<string, string> = Object.create(null);
        try {
            // TODO: protect with lock
            const s3Dir = await dirNode.handle.getDirectoryHandle('.s3');
            let count = 0;
            try {
                for await (const entry of s3Dir.values()) {
                    if (entry.kind !== 'file') continue;
                    count++;
                    if (entry.name.startsWith('uuids.') && entry.name.endsWith('.json')) {
                        try {
                            const file = await entry.getFile();
                            const text = await file.text();
                            Object.assign(uuids, JSON.parse(text));
                        }
                        catch { }
                    }
                }
            }
            catch { }
            // TODO: If count is greater than one, combine files into a single file
        }
        catch { }
        // 1. Unconditionally check for .adoc-editor/ignore.toml in this directory (on disk)
        try {
            const configDir = await dirNode.handle.getDirectoryHandle('.adoc-editor');
            const ignoreFileHandle = await configDir.getFileHandle('ignore.toml');
            const ignoreFile = await ignoreFileHandle.getFile();
            const ignorePath = `${currentPath}.adoc-editor/ignore.toml`;
            filesByPath.set(ignorePath, {
                uuid: uuids['.adoc-editor/ignore.toml'],
                key: s3Prefix + ignorePath,
                contentLength: ignoreFile.size,
                lastModified: new Date(ignoreFile.lastModified).toISOString(),
                handle: ignoreFileHandle,
                sha256: undefined
            });
        } catch {
            // ignore if not found
        }

        // 2. Iterate children (model)
        if (dirNode.children) {
            for (const child of dirNode.children) {
                const entryPath = `${currentPath}${child.name}`;

                if (child.name === '.adoc-editor' || child.name === '.s3') {
                    continue;
                }

                if (child.kind === 'file') {
                    try {
                        const file = await child.handle.getFile();
                        filesByPath.set(entryPath, {
                            uuid: uuids[child.name],
                            key: s3Prefix + entryPath,
                            contentLength: file.size,
                            lastModified: new Date(file.lastModified).toISOString(),
                            handle: child.handle as FileSystemFileHandle,
                            sha256: undefined
                        });
                    }
                    catch { }
                } else if (child.kind === 'directory') {
                    if (child.hasS3SyncConfig) {
                        traceLog(`Skipping nested sync root: ${entryPath}`);
                        continue;
                    }
                    await scan(child, entryPath + '/');
                }
            }
        }
    };

    await scan(rootNode, '');
    return filesByPath;
}

async function readRecords<T>(metaDir: FileSystemDirectoryHandle) {
    const recordsByPath = new Map<string, T>();

    const scan = async (dirHandle: FileSystemDirectoryHandle, currentPath: string) => {
        try {
            const index = await dirHandle.getFileHandle('.index.json');
            const file = await index.getFile();
            const text = await file.text();
            const meta = JSON.parse(text) as Record<string, T>;
            for (const [name, record] of Object.entries(meta)) {
                recordsByPath.set(currentPath + name, record);
            }
        }
        catch { }
        try {
            for await (const entry of dirHandle.values()) {
                if (entry.kind === 'directory') {
                    await scan(entry, `${currentPath}${entry.name}/`);
                }
            }
        }
        catch { }
    };

    await scan(metaDir, '');

    return recordsByPath;
}

function groupRecordsByKey<T>(records: Map<string, T>, keyFunc: (r: T) => string | undefined) {
    const recordsByUuid: Map<string, T[]> = new Map();
    for (const record of records.values()) {
        const key = keyFunc(record);
        if (key) {
            let rs = recordsByUuid.get(key);
            if (!rs) {
                recordsByUuid.set(key, rs = []);
            }
            rs.push(record);
        }
    }
    return recordsByUuid;
}

async function computeSha256(input: FileSystemFileHandle): Promise<[number, string]> {
    const hash = new Sha256();
    const file = await input.getFile();
    const stream = file.stream();
    const reader = stream.getReader();

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) {
                hash.update(value);
            }
        }
    } finally {
        reader.releaseLock();
    }

    const digest = await hash.digest();
    return [file.size, Array.from(digest).map(b => b.toString(16).padStart(2, '0')).join('')];
}

async function fetchRemoteRecords(s3Client: S3Client, s3Prefix: string, bucket: string, metaCacheDir: FileSystemDirectoryHandle, baseRecordsByPath: Map<string, BaseVersionRecord>) {

    const cachedRemoteRecordsByPath = await readRecords<S3VersionRecord>(metaCacheDir);

    const remoteRecordsByPath = new Map<string, S3VersionRecord>();
    const newRemoteRecordsByDir = new Map<string, Record<string, S3VersionRecord>>();
    let keyMarker: string | undefined;
    let versionIdMarker: string | undefined;

    do {
        const command = new ListObjectVersionsCommand({
            Bucket: bucket,
            Prefix: s3Prefix,
            KeyMarker: keyMarker,
            VersionIdMarker: versionIdMarker
        });
        const response = await s3Client.send(command);

        if (response.Versions) {
            for (const remoteInfo of response.Versions) {
                if (!remoteInfo.IsLatest) continue;
                if (!remoteInfo.Key || remoteInfo.Key.endsWith('/')) continue;
                if (!remoteInfo.VersionId) continue;

                const remoteRecord: S3VersionRecord = {
                    key: remoteInfo.Key,
                    version: remoteInfo.VersionId,
                    uuid: '',
                    syncVersion: 0,
                    deviceName: '',
                    etag: remoteInfo.ETag?.replace(/"/g, ''),
                    sha256: '',
                    lastModified: remoteInfo.LastModified?.toISOString()
                };

                // Optimization: Check Base State by Key AND S3 Object Version
                // If both key and version match base, we can reuse the uuid, sha256, syncversion from base.
                const remotePath = remoteInfo.Key.substring(s3Prefix.length);
                const baseRecord = baseRecordsByPath.get(remotePath);
                const cachedRecord = cachedRemoteRecordsByPath.get(remotePath);

                const copyFrom = baseRecord && baseRecord.version === remoteInfo.VersionId ? baseRecord : cachedRecord && cachedRecord.version === remoteInfo.VersionId ? cachedRecord : undefined;
                if (copyFrom) {
                    remoteRecord.uuid = copyFrom.uuid;
                    remoteRecord.syncVersion = copyFrom.syncVersion;
                    remoteRecord.deviceName = copyFrom.deviceName;
                    remoteRecord.sha256 = copyFrom.sha256;
                    if (!remoteRecord.etag) {
                        remoteRecord.etag = copyFrom.etag;
                    }
                    if (!remoteRecord.lastModified) {
                        remoteRecord.lastModified = copyFrom.lastModified;
                    }
                } else {
                    // Mismatch or new file - Fetch Metadata via HEAD
                    try {
                        const headCommand = new HeadObjectCommand({
                            Bucket: bucket,
                            Key: remoteInfo.Key,
                            VersionId: remoteInfo.VersionId
                        });
                        const headResponse = await s3Client.send(headCommand);
                        remoteRecord.uuid = headResponse.Metadata?.['uuid'] || '';
                        const syncversionStr = headResponse.Metadata?.['syncversion'];
                        if (syncversionStr) {
                            remoteRecord.syncVersion = parseInt(syncversionStr, 10);
                        }
                        remoteRecord.deviceName = headResponse.Metadata?.['devicename'] || '';
                        remoteRecord.sha256 = headResponse.ChecksumSHA256;
                        remoteRecord.contentLength = headResponse.ContentLength;
                        const [dir, name] = pathToDirAndFileName(remotePath);
                        let dirRecords = newRemoteRecordsByDir.get(dir);
                        if (!dirRecords) {
                            newRemoteRecordsByDir.set(dir, dirRecords = Object.create(null));
                        }
                        dirRecords![name] = remoteRecord;
                    } catch (e) {
                        console.warn(`Failed to fetch metadata for ${remoteInfo.Key}: ${e}`);
                    }
                }

                if (remoteRecord) {
                    remoteRecordsByPath.set(remoteRecord.key.substring(s3Prefix.length), remoteRecord);
                }
            }
        }
        keyMarker = response.NextKeyMarker;
        versionIdMarker = response.NextVersionIdMarker;
    } while (keyMarker || versionIdMarker);

    traceLog(`Found ${remoteRecordsByPath.size} remote objects.`);

    // Persist results of head requests for remote records to disk
    await writeRemoteRecordsCache(newRemoteRecordsByDir, metaCacheDir);

    return remoteRecordsByPath;
}

async function writeRemoteRecordsCache(newRemoteRecordsByDir: Map<string, Record<string, S3VersionRecord>>, metaCacheDir: FileSystemDirectoryHandle) {
    for (const [dir, dirRecords] of newRemoteRecordsByDir.entries()) {
        const dirHandle = dir ? await getOrCreateDirectory(metaCacheDir, ...dir.split('/')) : metaCacheDir;
        if (!dirHandle) continue;
        let fileHandle: FileSystemFileHandle | undefined = undefined;
        let final = dirRecords;
        // TODO: Protect the code below with a "lock"
        // Genuine locking is not possible from the file system access API
        // .index.json.lock file can be used for cooperative locking
        try {
            fileHandle = await dirHandle.getFileHandle('.index.json');
            const file = await fileHandle.getFile();
            const text = await file.text();
            const existing = JSON.parse(text) as Record<string, S3VersionRecord>;
            final = Object.assign(existing, dirRecords);
        }
        catch {
            fileHandle = await dirHandle.getFileHandle('.index.json', { create: true });
        }
        try {
            const writable = await fileHandle.createWritable();
            await writable.write(JSON.stringify(final, null, 2));
            await writable.close();
        }
        catch { }
    }
}

async function matchBaseWithRemote(baseRecords: Map<string, BaseVersionRecord>, baseRecordsByUuid: Map<string, BaseVersionRecord[]>, remoteRecords: Map<string, S3VersionRecord>, s3Prefix: string) {

    const baseRemoteMap = new Map<BaseVersionRecord, S3VersionRecord | null>();
    const remoteOnlyRecords: S3VersionRecord[] = []

    const pathFromKey = (key: string) => key.substring(s3Prefix.length);

    const remainingBaseRecords = new Map(baseRecords.entries());
    const remainingRemoteRecords = new Map(remoteRecords.entries());
    const remoteRecordsByUuid = groupRecordsByKey(remainingRemoteRecords, r => r.uuid);

    // 1. Group base records and remote records by uuid separately, and construct (base, remote) pairs from single element groups where base uuid matches remote uuid.
    const baseRemoteUuids = new Set(baseRecordsByUuid.keys()).intersection(remoteRecordsByUuid);
    for (const uuid of baseRemoteUuids) {
        const brs = baseRecordsByUuid.get(uuid)!;
        const rrs = remoteRecordsByUuid.get(uuid)!;
        if (brs.length === 1 && rrs.length === 1) {
            baseRemoteMap.set(brs[0], rrs[0]);
            remainingBaseRecords.delete(pathFromKey(brs[0].key));
            remainingRemoteRecords.delete(pathFromKey(rrs[0].key));
        }
    }

    // 2. Construct (base, remote) pairs where base path matches remote path and base uuid does not mis-match remote uuid. Missing uuids are allowed on either side, but if both uuids are present they must match.
    const baseRemotePaths = new Set(remainingBaseRecords.keys()).intersection(remainingRemoteRecords);
    for (const path of baseRemotePaths) {
        const br = remainingBaseRecords.get(path)!;
        const rr = remainingRemoteRecords.get(path)!;
        if (!br.uuid || !rr.uuid || br.uuid === rr.uuid) {
            baseRemoteMap.set(br, rr);
            remainingBaseRecords.delete(pathFromKey(br.key));
            remainingRemoteRecords.delete(pathFromKey(rr.key));
        }
    }

    // 3. Construct (base, remote) pairs where contentLength > 0 and base sha256 matches remote sha256 and base uuid does not mis-match remote uuid.
    const baseRecordsByHash = groupRecordsByKey(remainingBaseRecords, r => r.contentLength ? r.sha256 : '');
    const remoteRecordsByHash = groupRecordsByKey(remainingRemoteRecords, r => r.contentLength ? r.sha256 : '');
    const baseRemoteHashes = new Set(baseRecordsByHash.keys()).intersection(remoteRecordsByHash);
    for (const hash of baseRemoteHashes) {
        const brs = baseRecordsByHash.get(hash)!;
        const rrs = remoteRecordsByHash.get(hash)!;
        for (const br of brs) {
            for (const rr of rrs) {
                if (!br.uuid || !rr.uuid || br.uuid === rr.uuid) {
                    baseRemoteMap.set(br, rr);
                    remainingBaseRecords.delete(pathFromKey(br.key));
                    remainingRemoteRecords.delete(pathFromKey(rr.key));
                    break;
                }
            }
        }
    }

    // 4. The remaining records on both sides will remain unmatched. Construct (base, null remote) and (null base, remote) pairs for all the remaining records.
    for (const br of remainingBaseRecords.values()) {
        baseRemoteMap.set(br, null);
    }
    for (const rr of remainingRemoteRecords.values()) {
        remoteOnlyRecords.push(rr);
    }

    return [baseRemoteMap, remoteOnlyRecords] as const; // as const tells typescript to infer tuple instead of array
}

async function matchBaseWithLocal(baseRecords: Map<string, BaseVersionRecord>, baseRecordsByUuid: Map<string, BaseVersionRecord[]>, localRecords: Map<string, LocalFileRecord>, s3Prefix: string) {

    const baseLocalMap = new Map<BaseVersionRecord, LocalFileRecord | null>();
    const localOnlyRecords: LocalFileRecord[] = [];

    const pathFromKey = (key: string) => key.substring(s3Prefix.length);

    const remainingBaseRecords = new Map(baseRecords.entries());
    const remainingLocalRecords = new Map(localRecords.entries());
    const localRecordsByUuid = groupRecordsByKey(remainingLocalRecords, r => r.uuid);


    // 1. Group base records and local records by uuid separately, and construct (base, local) pairs from single element groups where base uuid matches local uuid.
    const baseLocalUuids = new Set(baseRecordsByUuid.keys()).intersection(localRecordsByUuid);
    for (const uuid of baseLocalUuids) {
        const brs = baseRecordsByUuid.get(uuid)!;
        const lrs = localRecordsByUuid.get(uuid)!;
        if (brs.length === 1 && lrs.length === 1) {
            baseLocalMap.set(brs[0], lrs[0]);
            remainingBaseRecords.delete(pathFromKey(brs[0].key));
            remainingLocalRecords.delete(pathFromKey(lrs[0].key));
        }
    }

    // 2. Construct (base, local) pairs where base path matches local path and base uuid does not mis-match local uuid. Missing uuids are allowed on either side, but if both uuids are present they must match.
    const baseLocalPaths = new Set(remainingBaseRecords.keys()).intersection(remainingLocalRecords);
    for (const path of baseLocalPaths) {
        const br = remainingBaseRecords.get(path)!;
        const lr = remainingLocalRecords.get(path)!;
        if (!br.uuid || !lr.uuid || br.uuid === lr.uuid) {
            baseLocalMap.set(br, lr);
            remainingBaseRecords.delete(pathFromKey(br.key));
            remainingLocalRecords.delete(pathFromKey(lr.key));
        }
    }

    // 3. Construct (base, local) pairs where contentLength > 0 and base sha256 matches local sha256 and base uuid does not mis-match local uuid.
    const baseRecordsByHash = groupRecordsByKey(remainingBaseRecords, r => r.contentLength ? r.sha256 : '');

    for (const r of remainingLocalRecords.values()) {
        const [contentLength, hash] = await computeSha256(r.handle);
        r.contentLength = contentLength;
        r.sha256 = hash;
    }
    const localRecordsByHash = groupRecordsByKey(remainingLocalRecords, r => r.contentLength ? r.sha256 : '');
    const baseLocalHashes = new Set(baseRecordsByHash.keys()).intersection(localRecordsByHash);
    for (const hash of baseLocalHashes) {
        const brs = baseRecordsByHash.get(hash)!;
        const lrs = localRecordsByHash.get(hash)!;
        for (const br of brs) {
            for (const lr of lrs) {
                if (!br.uuid || !lr.uuid || br.uuid === lr.uuid) {
                    baseLocalMap.set(br, lr);
                    remainingBaseRecords.delete(br.key.substring(s3Prefix.length));
                    remainingLocalRecords.delete(lr.key.substring(s3Prefix.length));
                    break;
                }
            }
        }
    }

    // 4. The remaining records on both sides will remain unmatched. Construct (base, null local) and (null base, local) pairs for all the remaining records.
    for (const br of remainingBaseRecords.values()) {
        baseLocalMap.set(br, null);
    }
    for (const lr of remainingLocalRecords.values()) {
        localOnlyRecords.push(lr);
    }

    return [baseLocalMap, localOnlyRecords] as const; // as const tells typescript to infer tuple instead of array
}

async function matchRecords(
    baseRecords: Map<string, BaseVersionRecord>,
    localRecords: Map<string, LocalFileRecord>,
    remoteRecords: Map<string, S3VersionRecord>,
    s3Prefix: string
) {
    const baseRecordsByUuid = groupRecordsByKey(baseRecords, r => r.uuid);

    const [baseRemoteMap, remoteOnlyRecords] = await matchBaseWithRemote(baseRecords, baseRecordsByUuid, remoteRecords, s3Prefix);

    const [baseLocalMap, localOnlyRecords] = await matchBaseWithLocal(baseRecords, baseRecordsByUuid, localRecords, s3Prefix);

    const statusItems: FileSyncStatus[] = []

    // baseRemoteMap and baseLocalMap must have the same keys
    for (const baseRecord of baseRemoteMap.keys()) {
        statusItems.push(await FileSyncStatus.create(baseRecord, baseLocalMap.get(baseRecord) ?? null, baseRemoteMap.get(baseRecord) ?? null));
    }

    const localOnlyByKey = new Map(localOnlyRecords.map(r => [r.key, r]));
    const remoteOnlyByKey = new Map(remoteOnlyRecords.map(r => [r.key, r]));
    for (const key of new Set(localOnlyByKey.keys()).intersection(remoteOnlyByKey)) {
        statusItems.push(await FileSyncStatus.create(null, localOnlyByKey.get(key)!, remoteOnlyByKey.get(key)!));
        localOnlyByKey.delete(key);
        remoteOnlyByKey.delete(key);
    }
    for (const r of localOnlyByKey.values()) {
        statusItems.push(await FileSyncStatus.create(null, r, null));
    }
    for (const r of remoteOnlyByKey.values()) {
        statusItems.push(await FileSyncStatus.create(null, null, r));
    }

    return statusItems;
}

export async function scanAndCalculateStatus(rootNode: DirNodeLike, s3Client: S3Client, settings: S3SyncSettings) {
    const s3Prefix = settings.prefix || '';

    // 1. Scan Local Files
    const localFiles = await scanLocalFiles(rootNode, s3Prefix);
    traceLog(`Found ${localFiles.size} local files.`);

    let s3Dir: FileSystemDirectoryHandle;
    let baseMetaDir: FileSystemDirectoryHandle;
    let metaCacheDir: FileSystemDirectoryHandle;
    try {
        s3Dir = await rootNode.handle.getDirectoryHandle('.s3', { create: true });
        baseMetaDir = await s3Dir.getDirectoryHandle('m', { create: true });
        metaCacheDir = await s3Dir.getDirectoryHandle('mc', { create: true });
    } catch (e) {
        traceLog("No existing base state found (or failed to read).");
        return [];
    }

    // 2. Read Base State
    traceLog("Reading base state...");
    const baseRecordsByPath = await readRecords<BaseVersionRecord>(baseMetaDir);
    traceLog(`Found ${baseRecordsByPath.size} items in base state.`);

    // 3. List Remote Objects & Persist State
    traceLog(`Listing objects in bucket: ${settings.bucket} (prefix: ${s3Prefix})`);

    const remoteRecordsByPath = await fetchRemoteRecords(s3Client, s3Prefix, settings.bucket, metaCacheDir, baseRecordsByPath);

    // 4. Compute Actions
    traceLog("Calculating diff...");
    const statusItems = await matchRecords(baseRecordsByPath, localFiles, remoteRecordsByPath, s3Prefix);

    return statusItems;
}

export enum FileStatus {
    Unchanged = "Unchanged",
    Changed = "Changed",
    Reverted = "Reverted",
    New = "New",
    Deleted = "Deleted",
    Unknown = "Unknown"
}

export enum SyncAction {
    None = "None",
    CopyLocalToRemote = "CopyLocalToRemote",
    CopyRemoteToLocal = "CopyRemoteToLocal",
    DeleteRemote = "DeleteRemote",
    DeleteLocal = "DeleteLocal",
}

export class FileSyncStatus {
    private constructor(base: BaseVersionRecord | null, local: LocalFileRecord | null, remote: S3VersionRecord | null) {
        this.base = base;
        this.local = local;
        this.remote = remote;
    }
    static async create(base: BaseVersionRecord | null, local: LocalFileRecord | null, remote: S3VersionRecord | null) {
        const item = new FileSyncStatus(base, local, remote);
        await item.calculateStatus();
        return item;
    }

    readonly base: BaseVersionRecord | null;
    readonly local: LocalFileRecord | null;
    readonly remote: S3VersionRecord | null;

    localStatus: FileStatus = FileStatus.Unknown;
    remoteStatus: FileStatus = FileStatus.Unknown;
    localMoved: boolean = false;
    remoteMoved: boolean = false;

    recommendedPathAction: SyncAction = SyncAction.None;
    recommendedContentAction: SyncAction = SyncAction.None;
    isPathConflict: boolean = false;
    isContentConflict: boolean = false;
    isWarning: boolean = false;

    private async calculateStatus() {
        // Remote Status
        if (this.base && this.remote) {
            if (this.base.key !== this.remote.key) {
                this.remoteMoved = true;
            }

            const isShaMatch = this.base.sha256 && this.remote.sha256 && this.base.sha256 === this.remote.sha256;

            if (isShaMatch) {
                this.remoteStatus = FileStatus.Unchanged;
            } else {
                if (!this.remote.syncVersion) {
                    this.remoteStatus = FileStatus.Unknown;
                } else if (this.base.syncVersion < this.remote.syncVersion) {
                    this.remoteStatus = FileStatus.Changed;
                } else if (this.base.syncVersion > this.remote.syncVersion) {
                    this.remoteStatus = FileStatus.Reverted;
                } else {
                    this.remoteStatus = FileStatus.Unknown;
                }
            }
        } else if (!this.base && this.remote) {
            this.remoteStatus = FileStatus.New;
        } else if (this.base && !this.remote) {
            this.remoteStatus = FileStatus.Deleted;
        }

        // Local Status
        if (this.base && this.local) {
            if (this.base.key !== this.local.key) {
                this.localMoved = true;
            }
            let changed: boolean;
            if (this.local.sha256) {
                // Fast check
                changed = this.base.sha256 !== this.local.sha256;
            }
            else {
                // Fast check
                changed = this.base.contentLength !== this.local.contentLength || this.base.lastModifiedLocal !== this.local.lastModified;
            }

            this.localStatus = changed ? FileStatus.Changed : FileStatus.Unchanged;
        } else if (!this.base && this.local) {
            this.localStatus = FileStatus.New;
        } else if (this.base && !this.local) {
            this.localStatus = FileStatus.Deleted;
        }

        // Perform slow check if fast check seems risky
        if (this.local && !this.local.sha256 && (this.localStatus === FileStatus.Changed || this.remoteStatus !== FileStatus.Unchanged)) {
            const [contentLength, hash] = await computeSha256(this.local.handle)
            this.local.contentLength = contentLength;
            this.local.sha256 = hash;
            this.localStatus = this.local.sha256 !== this.base?.sha256 ? FileStatus.Changed : FileStatus.Unchanged;
        }

        this.calculateAction();
    }

    private calculateAction() {
        this.recommendedPathAction = SyncAction.None;
        this.recommendedContentAction = SyncAction.None;
        this.isPathConflict = false;
        this.isContentConflict = false;
        this.isWarning = false;

        // Path Actions Logic
        // "If exactly one of local status and remote status has the Moved suffix, the default Path Action will be to apply the Move."
        // "If both local status and remote status have the Moved suffix, there is a path conflict"
        if (this.localMoved && this.remoteMoved) {
            this.isPathConflict = true;
        } else if (this.localMoved) {
            this.recommendedPathAction = SyncAction.CopyLocalToRemote;
        } else if (this.remoteMoved) {
            this.recommendedPathAction = SyncAction.CopyRemoteToLocal;
        }

        // Content Actions
        const ls = this.localStatus;
        const rs = this.remoteStatus;

        if (this.base && this.local && this.remote) {
            if (ls === FileStatus.Unchanged && rs === FileStatus.Unchanged) {
                this.recommendedContentAction = SyncAction.None;
            } else if (ls === FileStatus.Unchanged && rs === FileStatus.Changed) {
                this.recommendedContentAction = SyncAction.CopyRemoteToLocal;
            } else if (ls === FileStatus.Changed && rs === FileStatus.Unchanged) {
                this.recommendedContentAction = SyncAction.CopyLocalToRemote;
            } else if (ls === FileStatus.Unchanged && rs === FileStatus.Reverted) {
                this.recommendedContentAction = SyncAction.CopyRemoteToLocal;
                this.isWarning = true;
            } else if (ls === FileStatus.Unchanged && rs === FileStatus.Unknown) {
                this.isWarning = true;
            } else {
                this.isContentConflict = true;
            }
        } else if (this.base && this.local && !this.remote) {
            // (base, local, null remote)
            if (ls === FileStatus.Unchanged) {
                // Remote: Deleted (implied). 
                // Doc: Use Local OR Use Remote (default), Warning.
                // "Use Remote" => Delete Local.
                this.recommendedContentAction = SyncAction.DeleteLocal;
                this.isWarning = true;
            } else {
                // Local Changed, Remote Deleted
                this.isContentConflict = true;
            }
        } else if (this.base && !this.local && this.remote) {
            // (base, null local, remote)
            if (rs === FileStatus.Unchanged) {
                // Local: Deleted
                // Doc: Use Local (default) OR Use Remote, Warning
                // "Use Local" => Delete Remote.
                this.recommendedContentAction = SyncAction.DeleteRemote;
                this.isWarning = true;
            } else {
                // Remote Changed/Reverted, Local Deleted
                this.isContentConflict = true;
            }
        } else if (this.base && !this.local && !this.remote) {
            // Both deleted
            this.recommendedContentAction = SyncAction.None;
        } else if (!this.base && this.local && !this.remote) {
            // New Local
            this.recommendedContentAction = SyncAction.CopyLocalToRemote;
        } else if (!this.base && !this.local && this.remote) {
            // New Remote
            this.recommendedContentAction = SyncAction.CopyRemoteToLocal;
        } else if (!this.base && this.local && this.remote) {
            // Both New
            this.isContentConflict = true;
        }
    }
}
