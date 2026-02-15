import { computed, observable } from "mobx";
import { S3Client, ListObjectVersionsCommand, HeadObjectCommand, PutObjectCommand, DeleteObjectCommand, CopyObjectCommand } from "@aws-sdk/client-s3";
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
    etag: string;
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

export async function createDirectoryAtPath(rootHandle: FileSystemDirectoryHandle, path: string): Promise<FileSystemDirectoryHandle> {
    return (await _getDirectoryHandle(rootHandle, path, { create: true }))!;
}

export async function getDirectoryAtPath(rootHandle: FileSystemDirectoryHandle, path: string): Promise<FileSystemDirectoryHandle> {
    return (await _getDirectoryHandle(rootHandle, path, { optional: false }))!;
}

export async function tryGetDirectoryAtPath(rootHandle: FileSystemDirectoryHandle, path: string): Promise<FileSystemDirectoryHandle | null> {
    return await _getDirectoryHandle(rootHandle, path, { optional: true });
}

async function _getDirectoryHandle(dir: FileSystemDirectoryHandle, path: string, options?: { create?: boolean; optional?: boolean }) {
    if (!path || path === '/') return dir;
    let curPath = '';
    const parts = path.split('/').filter(Boolean);
    const createOptions = { create: options?.create ?? false };
    const optional = options?.optional ?? false;
    for (const name of parts) {
        try {
            dir = await dir.getDirectoryHandle(name, createOptions);
            curPath += `${name}/`;
        }
        catch (e) {
            if (createOptions.create || !optional) {
                throw Error(`Could not create directory ${name} at ${curPath}`, { cause: e });
            }
            return null;
        }
    }
    return dir;
}

export async function createFileAtPath(rootHandle: FileSystemDirectoryHandle, path: string): Promise<FileSystemFileHandle> {
    return (await _getFileHandle(rootHandle, path, { create: true }))!;
}

export async function getFileAtPath(rootHandle: FileSystemDirectoryHandle, path: string): Promise<FileSystemFileHandle> {
    return (await _getFileHandle(rootHandle, path, { optional: false }))!;
}

export async function tryGetFileAtPath(rootHandle: FileSystemDirectoryHandle, path: string): Promise<FileSystemFileHandle | null> {
    return await _getFileHandle(rootHandle, path, { optional: true });
}

async function _getFileHandle(rootHandle: FileSystemDirectoryHandle, path: string, options?: { create?: boolean; optional?: boolean }): Promise<FileSystemFileHandle | null> {
    let curPath = ''
    const parts = path.split('/').filter(Boolean);
    let currentDir = rootHandle;
    const createOptions = { create: options?.create ?? false };
    const optional = options?.optional ?? false;
    for (let i = 0; i < parts.length - 1; i++) {
        const name = parts[i];
        try {
            currentDir = await currentDir.getDirectoryHandle(name, createOptions);
            curPath += `${name}/`;
        } catch (e) {
            if (createOptions.create || !optional) {
                throw Error(`Could not create directory ${name} at ${curPath}`, { cause: e });
            }
            return null;
        }
    }

    try {
        return await currentDir.getFileHandle(parts[parts.length - 1], createOptions);
    } catch (e) {
        if (createOptions.create || !optional) {
            throw Error(`Could not create file at ${path}`, { cause: e });
        }
        return null;
    }
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
        const uuids = await readUuids(dirNode.handle);
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

/**
 * Returns a hash of file names to uuids for files within the directory by reading .s3/uuids.*.json files
 */
export async function readUuids(dirHandle: FileSystemDirectoryHandle) {
    return await updateDirectoryUuidMap(dirHandle, {}); // Reuse the reading, combining logic in this function
}


/**
 * Updates the uuid map for a directory by reading all .s3/uuids.*.json files, merging them, applying changes,
 * and writing a single new .s3/uuids.<uuid>.json file. Old files are deleted.
 * @param dirHandle Handle to the directory containing the files (not the .s3 directory within it)
 * @param changes Map of filename to uuid. If uuid is null, the entry is removed.
 */
export async function updateDirectoryUuidMap(dirHandle: FileSystemDirectoryHandle, changes: Record<string, string | null>) {
    const changesEntries = Object.entries(changes);

    // object is created with a null prototype to avoid surprises when accessing entries.
    const uuids: Record<string, string> = Object.create(null);

    let s3Dir;
    if (changesEntries.length > 0) {
        s3Dir = await createDirectoryAtPath(dirHandle, '.s3');
    }
    else {
        s3Dir = await tryGetDirectoryAtPath(dirHandle, '.s3');
        if (!s3Dir) return uuids;
    }

    // 1. Read existing UUIDs
    const filesToDelete: string[] = [];

    // TODO: protect with lock
    for await (const entry of s3Dir.values()) {
        if (entry.kind === 'file' && entry.name.startsWith('uuids.') && entry.name.endsWith('.json')) {
            filesToDelete.push(entry.name);
            const file = await entry.getFile();
            const text = await file.text();
            Object.assign(uuids, JSON.parse(text));
        }
    }

    // 2. Apply changes
    for (const [name, uuid] of changesEntries) {
        if (uuid === null) {
            delete uuids[name];
        } else {
            uuids[name] = uuid;
        }
    }

    if (changesEntries.length > 0 || filesToDelete.length > 1) {
        const newFileName = filesToDelete.length > 0 ? filesToDelete[0] : `uuids.${crypto.randomUUID()}.json`;
        // 3. Write new file
        const fileHandle = await s3Dir.getFileHandle(newFileName, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(JSON.stringify(uuids, null, 2));
        await writable.close();

        // 4. Delete old files
        for (const name of filesToDelete) {
            if (name !== newFileName) {
                await s3Dir.removeEntry(name);
            }
        }
    }

    return uuids;
}

/**
 * Updates a specific base record in the .adoc-editor/s3m/<relativeDir>/.index.json metadata store.
 * used to update lastModifiedLocal after a restore/revert to avoid full re-hash.
 */
export async function saveBaseRecord(rootNode: DirNodeLike, relativePath: string, update: Partial<BaseVersionRecord>) {
    const name = fileName(relativePath);
    const dir = directoryPath(relativePath);
    
    // Lock handling would be ideal here but skipping for now
    const fileHandle = await getFileAtPath(rootNode.handle, `.adoc-editor/s3m/${dir}.index.json`);
    const file = await fileHandle.getFile();
    const text = await file.text();
    const records = JSON.parse(text);

    if (records.hasOwnProperty(name)) {
        Object.assign(records[name], update);
        const writable = await fileHandle.createWritable();
        await writable.write(JSON.stringify(records, null, 2));
        await writable.close();
    }
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

async function computeSha256(input: FileSystemFileHandle): Promise<{ size: number; base64: string }> {
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
    const base64 = btoa(String.fromCharCode(...digest));
    return { size: file.size, base64 };
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
                    etag: remoteInfo.ETag?.replace(/"/g, '') ?? '',
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
                        if (!remoteRecord.etag) {
                            remoteRecord.etag = headResponse.ETag?.replace(/"/g, '') ?? '';
                        }
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

function remoteCachePath(relativePath: string, version: string): string {
    return `.adoc-editor/s3r/${relativePath}.${version}`;
}

export async function loadRemoteFileFromCache(rootHandle: FileSystemDirectoryHandle, relativePath: string, version: string): Promise<FileSystemFileHandle | null> {
    return await tryGetFileAtPath(rootHandle, remoteCachePath(relativePath, version)) ?? null;
}

export async function saveRemoteFileToCache(rootHandle: FileSystemDirectoryHandle, relativePath: string, version: string, stream: ReadableStream<Uint8Array>): Promise<FileSystemFileHandle | null> {
    const handle = await createFileAtPath(rootHandle, remoteCachePath(relativePath, version));
    const writable = await handle.createWritable();
    await stream.pipeTo(writable);
    return handle;
}

async function writeRemoteRecordsCache(newRemoteRecordsByDir: Map<string, Record<string, S3VersionRecord>>, metaCacheDir: FileSystemDirectoryHandle) {
    for (const [dir, dirRecords] of newRemoteRecordsByDir.entries()) {
        const dirHandle = await createDirectoryAtPath(metaCacheDir, dir);
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
        const writable = await fileHandle.createWritable();
        await writable.write(JSON.stringify(final, null, 2));
        await writable.close();
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
        const sha256Result = await computeSha256(r.handle);
        r.contentLength = sha256Result.size;
        r.sha256 = sha256Result.base64;
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
        statusItems.push(await FileSyncStatus.create(baseRecord, baseLocalMap.get(baseRecord) ?? null, baseRemoteMap.get(baseRecord) ?? null, s3Prefix));
    }

    const localOnlyByKey = new Map(localOnlyRecords.map(r => [r.key, r]));
    const remoteOnlyByKey = new Map(remoteOnlyRecords.map(r => [r.key, r]));
    for (const key of new Set(localOnlyByKey.keys()).intersection(remoteOnlyByKey)) {
        statusItems.push(await FileSyncStatus.create(null, localOnlyByKey.get(key)!, remoteOnlyByKey.get(key)!, s3Prefix));
        localOnlyByKey.delete(key);
        remoteOnlyByKey.delete(key);
    }
    for (const r of localOnlyByKey.values()) {
        statusItems.push(await FileSyncStatus.create(null, r, null, s3Prefix));
    }
    for (const r of remoteOnlyByKey.values()) {
        statusItems.push(await FileSyncStatus.create(null, null, r, s3Prefix));
    }

    return statusItems;
}

export async function scanAndCalculateStatus(rootNode: DirNodeLike, s3Client: S3Client, settings: Readonly<S3SyncSettings>) {
    const s3Prefix = settings.prefix || '';

    // 1. Scan Local Files
    const localFiles = await scanLocalFiles(rootNode, s3Prefix);
    traceLog(`Found ${localFiles.size} local files.`);

    // 2. Read Base State
    traceLog("Reading base state...");
    const baseRecordsByPath = await readRecords<BaseVersionRecord>(await createDirectoryAtPath(rootNode.handle, '.adoc-editor/s3m/'));
    traceLog(`Found ${baseRecordsByPath.size} items in base state.`);

    // 3. List Remote Objects & Persist State
    traceLog(`Listing objects in bucket: ${settings.bucket} (prefix: ${s3Prefix})`);

    const remoteRecordsByPath = await fetchRemoteRecords(s3Client, s3Prefix, settings.bucket, await createDirectoryAtPath(rootNode.handle, '.adoc-editor/s3mc/'), baseRecordsByPath);

    // 4. Compute Actions
    traceLog("Calculating diff...");
    const statusItems = await matchRecords(baseRecordsByPath, localFiles, remoteRecordsByPath, s3Prefix);

    return statusItems;
}

export enum FileStatus {
    None = "None",
    Unchanged = "Unchanged",
    Changed = "Changed",
    Reverted = "Reverted",
    New = "New",
    Deleted = "Deleted",
    Unknown = "Unknown"
}

export enum SyncPathAction {
    None = "None",
    UseLocalPath = "UseLocalPath",
    UseRemotePath = "UseRemotePath",
}

export enum SyncContentAction {
    None = "None",
    CopyLocalToRemote = "CopyLocalToRemote",
    CopyRemoteToLocal = "CopyRemoteToLocal",
    DeleteRemote = "DeleteRemote",
    DeleteLocal = "DeleteLocal",
}

/**
 * Returns the parent directory path of the input path.
 * If the parent is the root an empty string is returned.
 * If not, the result has a trailing slash.
 * This behavior enables concatenation of a file name to the result without a slash.
 * An exception is thrown if the input path is already a root.
 * @param path A file or directory path. Trailing slashes are ignored.
 * @returns Parent directory path (empty string for root or with a trailing slash for non-root)
 */
export function directoryPath(path: string): string {
    path = path.replace(/\/+$/, ''); //remove trailing slashes
    if (path === '') {
        throw new Error(`Already a root path. path:  ${path}`);
    }
    const lastSlash = path.lastIndexOf('/');
    if (lastSlash >= 0) {
        return path.substring(0, lastSlash + 1);
    }
    else {
        return '';
    }
}

/**
 * Returns the last segment of the input path
 * @param path A file or directory path. Trailing slashes are ignored.
 * @returns 
 */
export function fileName(path: string, allowEmpty = false): string {
    path = path.replace(/\/+$/, ''); //remove trailing slashes
    const lastSlash = path.lastIndexOf('/');
    const name = lastSlash >= 0 ? path.substring(lastSlash + 1) : path;
    if (!allowEmpty && !name) {
        throw new Error('Expected a non-empty name');
    }
    return name;
}

export enum SyncMode {
    Sync = "Sync",
    MirrorLocal = "MirrorLocal",
    MirrorRemote = "MirrorRemote",
}

export type DiffViewMode = 'base-local' | 'base-remote' | 'remote-local' | '3way' | 'single-base' | 'single-local' | 'single-remote';

export class FileSyncStatus {
    private constructor(base: BaseVersionRecord | null, local: LocalFileRecord | null, remote: S3VersionRecord | null) {
        this.base = base;
        this.local = local;
        this.remote = remote;
    }
    static async create(base: BaseVersionRecord | null, local: LocalFileRecord | null, remote: S3VersionRecord | null, prefix: string) {
        const item = new FileSyncStatus(base, local, remote);
        await item.calculateStatus(prefix);
        return item;
    }

    readonly base: BaseVersionRecord | null;
    readonly local: LocalFileRecord | null;
    readonly remote: S3VersionRecord | null;

    @observable accessor localStatus: FileStatus = FileStatus.None;
    @observable accessor remoteStatus: FileStatus = FileStatus.None;

    private _localMoveDesc = '';
    get localMoveDesc() { return this._localMoveDesc; }
    get localMoved() { return !!this._localMoveDesc; }

    private _remoteMoveDesc = '';
    get remoteMoveDesc() { return this._remoteMoveDesc; }
    get remoteMoved() { return !!this._remoteMoveDesc; }

    availableDiffViews: DiffViewMode[] = [];

    @observable private accessor _pathAction: SyncPathAction = SyncPathAction.None;
    @computed
    get pathAction() { return this._pathAction; }
    set pathAction(value) { this._pathAction = value; }

    @observable private accessor _contentAction: SyncContentAction = SyncContentAction.None;
    @computed
    get contentAction() { return this._contentAction; }
    set contentAction(value) { this._contentAction = value; }

    @observable private accessor _isPathConflict: boolean = false;
    get isPathConflict() { return this._isPathConflict; }

    @observable private accessor _isContentConflict: boolean = false;
    get isContentConflict() { return this._isContentConflict; }


    @observable private accessor _isWarning: boolean = false;
    get isWarning() { return this._isWarning; }

    @observable private accessor _isChecked: boolean = true;
    @computed
    get isChecked() { return this._isChecked; }
    set isChecked(value) { this._isChecked = value; }

    /**
     * Returns the relative path for display, with prefix stripped.
     * Priority: local path > base path > remote path
     */
    relativePath(prefix: string): string {
        const fullPath = this.local?.key || this.base?.key || this.remote?.key || '';
        return fullPath.substring(prefix.length);
    }

    /**
     * Returns just the filename portion of the relative path.
     */
    fileName(prefix: string): string {
        const relPath = this.relativePath(prefix);
        return fileName(relPath);
    }

    /**
     * Returns the directory portion of the relative path (without filename).
     * Returns empty string if the file is at the root.
     */
    directoryPath(prefix: string): string {
        const relPath = this.relativePath(prefix);
        return directoryPath(relPath);
    }

    private async calculateStatus(prefix: string) {
        // Remote Status
        if (this.base && this.remote) {
            if (this.base.key !== this.remote.key) {
                const basePath = this.base.key.substring(prefix.length);
                const remotePath = this.remote.key.substring(prefix.length);
                const baseDirPath = directoryPath(basePath);
                const remoteDirPath = directoryPath(remotePath);
                const baseFileName = fileName(basePath);
                const remoteFileName = fileName(remotePath);
                if (baseDirPath === remoteDirPath) {
                    this._remoteMoveDesc = `Renamed from ${baseFileName} to ${remoteFileName}`;
                }
                else if (baseFileName === remoteFileName) {
                    this._remoteMoveDesc = `Moved from ${baseDirPath} to ${remoteDirPath}`;
                }
                else {
                    this._remoteMoveDesc = `Moved from ${basePath} to ${remotePath}`;
                }
                traceLog(`Remote move detected: ${this._remoteMoveDesc}`);
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
                const basePath = this.base.key.substring(prefix.length);
                const localPath = this.local.key.substring(prefix.length);
                const baseDirPath = directoryPath(basePath);
                const localDirPath = directoryPath(localPath);
                const baseFileName = fileName(basePath);
                const localFileName = fileName(localPath);
                if (baseDirPath === localDirPath) {
                    this._localMoveDesc = `Renamed from ${baseFileName} to ${localFileName}`;
                }
                else if (baseFileName === localFileName) {
                    this._localMoveDesc = `Moved from ${baseDirPath} to ${localDirPath}`;
                }
                else {
                    this._localMoveDesc = `Moved from ${basePath} to ${localPath}`;
                }
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
            const sha256Result = await computeSha256(this.local.handle)
            this.local.contentLength = sha256Result.size;
            this.local.sha256 = sha256Result.base64;
            this.localStatus = this.local.sha256 !== this.base?.sha256 ? FileStatus.Changed : FileStatus.Unchanged;
        }

        const hasBase = this.base !== null;
        const hasLocal = this.local !== null;
        const hasRemote = this.remote !== null;

        // Three-way
        if (hasBase && hasLocal && hasRemote) this.availableDiffViews.push('3way');

        // Two-way diffs
        if (hasBase && hasLocal) this.availableDiffViews.push('base-local');
        if (hasBase && hasRemote) this.availableDiffViews.push('base-remote');
        if (hasRemote && hasLocal) this.availableDiffViews.push('remote-local');

        // Single views
        if (hasBase) this.availableDiffViews.push('single-base');
        if (hasLocal) this.availableDiffViews.push('single-local');
        if (hasRemote) this.availableDiffViews.push('single-remote');

        this.updateActions(SyncMode.Sync);
    }

    updateActions(mode: SyncMode) {
        this._pathAction = SyncPathAction.None;
        this._contentAction = SyncContentAction.None;
        this._isPathConflict = false;
        this._isContentConflict = false;
        this._isWarning = false;

        let preferredView: DiffViewMode | undefined = undefined;

        // Path Actions Logic
        // "If exactly one of local status and remote status has the Moved suffix, the default Path Action will be to apply the Move."
        // "If both local status and remote status have the Moved suffix, there is a path conflict"
        if (this.localMoved && this.remoteMoved) {
            if (mode === SyncMode.Sync) {
                this._isPathConflict = true;
            }
            else {
                this._pathAction = mode === SyncMode.MirrorLocal ? SyncPathAction.UseLocalPath : SyncPathAction.UseRemotePath;
            }
        } else if (this.localMoved) {
            this._pathAction = mode === SyncMode.MirrorRemote ? (this.remote ? SyncPathAction.UseRemotePath : SyncPathAction.None) : SyncPathAction.UseLocalPath;
        } else if (this.remoteMoved) {
            this._pathAction = mode === SyncMode.MirrorLocal ? (this.local ? SyncPathAction.UseLocalPath : SyncPathAction.None) : SyncPathAction.UseRemotePath;
        }

        // Content Actions
        const ls = this.localStatus;
        const rs = this.remoteStatus;

        if (this.base) {
            if (this.local) {
                if (this.remote) {
                    if (ls === FileStatus.Unchanged && rs === FileStatus.Unchanged) {
                        this._contentAction = SyncContentAction.None;
                        preferredView = 'single-local';
                    } else if (ls === FileStatus.Unchanged && rs === FileStatus.Changed) {
                        this._contentAction = mode === SyncMode.MirrorLocal ? SyncContentAction.CopyLocalToRemote : SyncContentAction.CopyRemoteToLocal;
                        preferredView = 'base-remote';
                    } else if (ls === FileStatus.Changed && rs === FileStatus.Unchanged) {
                        this._contentAction = mode === SyncMode.MirrorRemote ? SyncContentAction.CopyRemoteToLocal : SyncContentAction.CopyLocalToRemote;
                        preferredView = 'base-local';
                    } else if (ls === FileStatus.Unchanged && rs === FileStatus.Reverted) {
                        this._contentAction = mode === SyncMode.MirrorLocal ? SyncContentAction.CopyLocalToRemote : SyncContentAction.CopyRemoteToLocal;
                        this._isWarning = true;
                        preferredView = 'base-remote';
                    } else if (ls === FileStatus.Unchanged && rs === FileStatus.Unknown) {
                        if (mode === SyncMode.Sync) {
                            this._isWarning = true;
                        }
                        else {
                            this._contentAction = mode === SyncMode.MirrorLocal ? SyncContentAction.CopyLocalToRemote : SyncContentAction.CopyRemoteToLocal;
                        }
                        preferredView = 'base-remote';
                    } else {
                        if (mode === SyncMode.Sync) {
                            this._isContentConflict = true;
                        }
                        else {
                            this._contentAction = mode === SyncMode.MirrorLocal ? SyncContentAction.CopyLocalToRemote : SyncContentAction.CopyRemoteToLocal;
                        }
                        preferredView = '3way';
                    }
                }
                else {
                    // (base, local, null remote)
                    if (ls === FileStatus.Unchanged) {
                        // Remote: Deleted (implied). 
                        // Doc: Use Local OR Use Remote (default), Warning.
                        // "Use Remote" => Delete Local.
                        this._contentAction = mode === SyncMode.MirrorLocal ? SyncContentAction.CopyLocalToRemote : SyncContentAction.DeleteLocal;
                        this._isWarning = true;
                        preferredView = 'single-local';
                    } else {
                        // Local Changed, Remote Deleted
                        if (mode === SyncMode.Sync) {
                            this._isContentConflict = true;
                        }
                        else {
                            this._contentAction = mode === SyncMode.MirrorLocal ? SyncContentAction.CopyLocalToRemote : SyncContentAction.DeleteLocal;
                        }
                        preferredView = 'base-local';
                    }
                }
            }
            else if (this.remote) {
                // (base, null local, remote)
                if (rs === FileStatus.Unchanged) {
                    // Local: Deleted
                    // Doc: Use Local (default) OR Use Remote, Warning
                    // "Use Local" => Delete Remote.
                    this._contentAction = mode === SyncMode.MirrorRemote ? SyncContentAction.CopyRemoteToLocal : SyncContentAction.DeleteRemote;
                    this._isWarning = true;
                    preferredView = 'single-base';
                } else {
                    // Remote Changed/Reverted, Local Deleted
                    if (mode === SyncMode.Sync) {
                        this._isContentConflict = true;
                    }
                    else {
                        this._contentAction = mode === SyncMode.MirrorLocal ? SyncContentAction.DeleteRemote : SyncContentAction.CopyRemoteToLocal;
                    }
                    preferredView = 'base-remote';
                }
            } else {
                // (base, null local, null remote)
                // Both deleted
                this._contentAction = SyncContentAction.None;
                preferredView = 'single-base';
            }
        } else if (this.local) {
            if (this.remote) {
                // Both New
                if (mode === SyncMode.Sync) {
                    this._isContentConflict = true;
                }
                else {
                    this._contentAction = mode === SyncMode.MirrorLocal ? SyncContentAction.CopyLocalToRemote : SyncContentAction.CopyRemoteToLocal;
                }
                preferredView = 'remote-local';
            } else {
                // New Local
                this._contentAction = mode === SyncMode.MirrorRemote ? SyncContentAction.DeleteLocal : SyncContentAction.CopyLocalToRemote;
                preferredView = 'single-local';
            }
        } else if (this.remote) {
            // New Remote
            this._contentAction = mode === SyncMode.MirrorLocal ? SyncContentAction.DeleteRemote : SyncContentAction.CopyRemoteToLocal;
            preferredView = 'single-remote';
        }

        if (preferredView) {
            const i = this.availableDiffViews.indexOf(preferredView);
            this.availableDiffViews.splice(i, 1);
            this.availableDiffViews.unshift(preferredView);
        }
        traceLog(`updateActions: ls=${this.localStatus}, rs=${this.remoteStatus} => contentAction=${this._contentAction}, pathAction=${this._pathAction}, conflict=${this._isContentConflict}`);
    }
}

// ============================================================
// Sync Execution Logic
// ============================================================

export interface PendingChanges {
    /** relativePath → new BaseVersionRecord, or null to delete the record */
    baseRecords: Map<string, BaseVersionRecord | null>;
    /** relativePath → FileSystemFileHandle to copy content from for .adoc-editor.s3b/<relativePath> */
    baseFileWrites: Map<string, FileSystemFileHandle>;
    /** relativePaths to delete from .adoc-editor.s3b/ */
    baseFileDeletes: string[];
    /** dirPath (relative, e.g. "" or "sub/dir") → Record<fileName, uuid | null> */
    uuidChanges: Map<string, Record<string, string | null>>;
    /** Remote cache file paths (relative to root) to delete after sync */
    remoteCacheDeletes: string[];
}

/** Wrap an unquoted ETag with double-quotes for use in If-Match / CopySourceIfMatch headers. */
function quotedEtag(etag: string): string {
    return `"${etag}"`;
}

/** Check if an error is a concurrency conflict (HTTP 409 Conflict or 412 Precondition Failed). */
export function isConcurrencyError(e: unknown): boolean {
    if (e && typeof e === 'object' && '$metadata' in e) {
        const code = (e as { $metadata: { httpStatusCode?: number } }).$metadata.httpStatusCode;
        return code === 409 || code === 412;
    }
    return false;
}

/**
 * Re-fetch the current state of a remote object via HeadObject.
 * Returns a fresh S3VersionRecord, or null if the object no longer exists (404).
 */
export async function refreshRemoteRecord(
    s3Client: S3Client,
    bucket: string,
    key: string,
): Promise<S3VersionRecord | null> {
    try {
        const resp = await s3Client.send(new HeadObjectCommand({
            Bucket: bucket,
            Key: key,
        }));
        return {
            key,
            version: resp.VersionId || '',
            uuid: resp.Metadata?.['uuid'] || '',
            syncVersion: parseInt(resp.Metadata?.['syncversion'] || '0', 10),
            deviceName: resp.Metadata?.['devicename'] || '',
            etag: resp.ETag?.replace(/"/g, '') ?? '',
            sha256: resp.ChecksumSHA256,
            contentLength: resp.ContentLength,
            lastModified: resp.LastModified?.toISOString(),
        };
    } catch (e: unknown) {
        if (e && typeof e === 'object' && '$metadata' in e) {
            const code = (e as { $metadata: { httpStatusCode?: number } }).$metadata.httpStatusCode;
            if (code === 404) return null;
        }
        throw e;
    }
}

interface PutObjectResult {
    versionId: string;
    etag: string;
    lastModified: string;
}

async function putObjectToS3(
    s3Client: S3Client,
    bucket: string,
    key: string,
    body: File,
    metadata: { uuid: string; syncVersion: number; deviceName: string },
    sha256Base64: string,
    expectedEtag: string | undefined,
): Promise<PutObjectResult> {
    const response = await s3Client.send(new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        Metadata: {
            uuid: metadata.uuid,
            syncversion: metadata.syncVersion.toString(),
            devicename: metadata.deviceName,
        },
        ChecksumAlgorithm: 'SHA256',
        ChecksumSHA256: sha256Base64,
        // Conditional write: if updating existing object, require ETag match;
        // if creating new object, require it doesn't already exist.
        ...(expectedEtag ? { IfMatch: quotedEtag(expectedEtag) } : { IfNoneMatch: '*' }),
    }));
    if (!response.VersionId) {
        throw new Error(`PutObject for ${key} did not return a VersionId. Is versioning enabled on the bucket?`);
    }
    // Get the server-side LastModified via HeadObject
    let lastModified = new Date().toISOString();
    try {
        const headResp = await s3Client.send(new HeadObjectCommand({
            Bucket: bucket,
            Key: key,
            VersionId: response.VersionId,
        }));
        if (headResp.LastModified) {
            lastModified = headResp.LastModified.toISOString();
        }
    } catch {
        // Fall back to local timestamp if HeadObject fails
    }
    return {
        versionId: response.VersionId,
        etag: response.ETag?.replace(/"/g, '') || '',
        lastModified,
    };
}

function resolveUuid(item: FileSyncStatus): string {
    return item.local?.uuid || item.base?.uuid || item.remote?.uuid || crypto.randomUUID();
}

function resolveSyncVersion(item: FileSyncStatus): number {
    return Math.max(item.base?.syncVersion ?? 0, item.remote?.syncVersion ?? 0) + 1;
}

/**
 * Determine the target S3 key based on the path action.
 */
function resolveTargetKey(item: FileSyncStatus): string {
    if (item.pathAction === SyncPathAction.UseLocalPath) return item.local!.key;
    if (item.pathAction === SyncPathAction.UseRemotePath) return item.remote!.key;
    return item.base?.key ?? item.local?.key ?? item.remote?.key ?? '';
}

function addUuidChange(pending: PendingChanges, dirPath: string, name: string, uuid: string | null) {
    let changes = pending.uuidChanges.get(dirPath);
    if (!changes) {
        pending.uuidChanges.set(dirPath, changes = Object.create(null));
    }
    changes![name] = uuid;
}

/**
 * Accumulate base record and base file changes resulting from a move.
 * The old base path record is deleted and its base file is deleted.
 */
function accumulateBasePathChange(pending: PendingChanges, prefix: string, oldKey: string, newKey: string) {
    const oldPath = oldKey.substring(prefix.length);
    const newPath = newKey.substring(prefix.length);
    if (oldPath !== newPath) {
        pending.baseRecords.set(oldPath, null);
        pending.baseFileDeletes.push(oldPath);
    }
}

/**
 * Execute sync for a single item. Performs S3 and local FS operations,
 * then accumulates metadata changes in `pending` for batch flush.
 * 
 * @param item The FileSyncStatus item to sync
 * @param s3Client The authenticated S3 client
 * @param rootHandle The root directory handle for the sync root
 * @param settings S3 sync settings
 * @param pending Accumulated changes to be flushed after all items
 * @param getRemoteContent Function to get remote content (from S3Store)
 */
export async function executeSyncItem(
    item: FileSyncStatus,
    s3Client: S3Client,
    rootHandle: FileSystemDirectoryHandle,
    settings: S3SyncSettings,
    pending: PendingChanges,
    ensureRemoteCached: (remote: S3VersionRecord) => Promise<FileSystemFileHandle | null>,
) {
    const prefix = settings.prefix;
    const bucket = settings.bucket;
    const contentAction = item.contentAction;
    const pathAction = item.pathAction;
    const targetKey = resolveTargetKey(item);
    const targetPath = targetKey.substring(prefix.length);
    const uuid = resolveUuid(item);

    // Handle both-deleted case: base exists but local and remote are both gone
    if (contentAction === SyncContentAction.None && pathAction === SyncPathAction.None) {
        if (item.base && !item.local && !item.remote) {
            // Both deleted — clean up base record and base file
            const basePath = item.base.key.substring(prefix.length);
            pending.baseRecords.set(basePath, null);
            pending.baseFileDeletes.push(basePath);
        }
    } else if (contentAction === SyncContentAction.CopyLocalToRemote) {

        const syncVersion = resolveSyncVersion(item);
        let putResult: PutObjectResult | undefined = undefined;
        let sha256Base64: string = '';
        let contentLength: number = 0;

        // Optimization: if local is unchanged (remote deleted or moved), the base version may still
        // exist on the bucket. Use CopyObject from the base version instead of re-uploading.
        if (item.localStatus === FileStatus.Unchanged) {
            try {
                const copyResp = await s3Client.send(new CopyObjectCommand({
                    Bucket: bucket,
                    CopySource: `${bucket}/${encodeURIComponent(item.base!.key)}?versionId=${item.base!.version}`,
                    Key: targetKey,
                    MetadataDirective: 'REPLACE',
                    Metadata: {
                        uuid,
                        syncversion: syncVersion.toString(),
                        devicename: settings.device_name,
                    },
                    // Conditional write: if updating existing object, require ETag match;
                    // if creating new object, require it doesn't already exist.
                    ...(item.remote ? { IfMatch: quotedEtag(item.remote.etag) } : { IfNoneMatch: '*' }),
                }));
                if (!copyResp.VersionId) {
                    throw new Error('CopyObject did not return a VersionId');
                }
                // Get server-side LastModified via HeadObject
                let lastModified = new Date().toISOString();
                try {
                    const headResp = await s3Client.send(new HeadObjectCommand({
                        Bucket: bucket,
                        Key: targetKey,
                        VersionId: copyResp.VersionId,
                    }));
                    if (headResp.LastModified) {
                        lastModified = headResp.LastModified.toISOString();
                    }
                } catch { }
                putResult = {
                    versionId: copyResp.VersionId,
                    etag: copyResp.CopyObjectResult?.ETag?.replace(/"/g, '') ?? item.base!.etag,
                    lastModified,
                };
                sha256Base64 = item.base!.sha256;
                contentLength = item.base!.contentLength;
                traceLog(`CopyLocalToRemote: used CopyObject from base version for ${targetKey}`);
            } catch (e) {
                if (isConcurrencyError(e)) {
                    throw e;
                }
                traceLog(`CopyObject from base failed, falling back to upload: ${e}`);
                // Fall through to upload path below
                putResult = undefined;
            }
        }

        // Upload path: stream SHA256 from file, pass File directly as PutObject body
        if (!putResult) {
            const sha256 = await computeSha256(item.local!.handle);
            sha256Base64 = sha256.base64;
            contentLength = sha256.size;

            const localFile = await item.local!.handle.getFile();
            putResult = await putObjectToS3(s3Client, bucket, targetKey, localFile, {
                uuid, syncVersion, deviceName: settings.device_name,
            }, sha256.base64, item.remote?.etag);
        }

        // If remote exists at a different key, delete the old one
        if (item.remote && item.remote.key !== targetKey) {
            await s3Client.send(new DeleteObjectCommand({
                Bucket: bucket,
                Key: item.remote.key,
                IfMatch: quotedEtag(item.remote.etag),
            }));
        }

        // If local file is at a different path than target, move it
        if (item.local && item.local.key !== targetKey) {
            const newLocalPath = targetPath;
            const newDir = directoryPath(newLocalPath);
            const newName = fileName(newLocalPath);
            const dirHandle = await createDirectoryAtPath(rootHandle, newDir);
            if (dirHandle) {
                const handle = item.local.handle as any;
                if (typeof handle.move === 'function') {
                    await handle.move(dirHandle, newName);
                }
                else {
                    throw new Error('move is not supported');
                }
            }
            // Update uuid maps for the move
            const oldLocalPath = item.local.key.substring(prefix.length);
            addUuidChange(pending, directoryPath(oldLocalPath), fileName(oldLocalPath), null);
            addUuidChange(pending, directoryPath(newLocalPath), newName, uuid);
        } else {
            // Ensure uuid is in the map for the current location
            addUuidChange(pending, directoryPath(targetPath), fileName(targetPath), uuid);
        }

        // Build base record
        const lastModifiedLocal = new Date((await item.local!.handle.getFile()).lastModified).toISOString();
        const baseRecord: BaseVersionRecord = {
            key: targetKey,
            version: putResult.versionId,
            uuid,
            syncVersion,
            deviceName: settings.device_name,
            etag: putResult.etag,
            sha256: sha256Base64,
            contentLength,
            lastModified: putResult.lastModified,
            lastModifiedLocal,
            compressionMethod: '',
        };
        pending.baseRecords.set(targetPath, baseRecord);
        pending.baseFileWrites.set(targetPath, item.local!.handle);

        // Clean up old base path if key changed
        if (item.base && item.base.key !== targetKey) {
            accumulateBasePathChange(pending, prefix, item.base.key, targetKey);
        }

    } else if (contentAction === SyncContentAction.CopyRemoteToLocal) {

        // Get the source file handle to stream from.
        // If remote is unchanged, restore from base file; otherwise from cached S3 download.
        let sourceHandle: FileSystemFileHandle;

        if (item.remoteStatus === FileStatus.Unchanged && item.base) {
            const baseRelPath = item.base.key.substring(prefix.length);
            const basePath = `.adoc-editor/s3b/${baseRelPath}`;
            const baseHandle = await tryGetFileAtPath(rootHandle, basePath);
            if (baseHandle) {
                sourceHandle = baseHandle;
                traceLog(`CopyRemoteToLocal: restoring from base file for ${targetPath}`);
            } else {
                // Base file missing, fall back to S3 download
                const cached = await ensureRemoteCached(item.remote!);
                if (!cached) {
                    throw new Error(`Failed to download remote content for ${item.remote!.key}`);
                }
                sourceHandle = cached;
            }
        } else {
            const cached = await ensureRemoteCached(item.remote!);
            if (!cached) {
                throw new Error(`Failed to download remote content for ${item.remote!.key}`);
            }
            sourceHandle = cached;
        }

        // If local exists at a different path from target, delete old local file
        if (item.local && item.local.key !== targetKey) {
            const oldLocalPath = item.local.key.substring(prefix.length);
            const oldDir = directoryPath(oldLocalPath);
            const oldName = fileName(oldLocalPath);
            const oldDirHandle = await getDirectoryAtPath(rootHandle, oldDir);
            await oldDirHandle.removeEntry(oldName);
            addUuidChange(pending, oldDir, oldName, null);
        }

        // Stream source to local file at targetPath
        const newDir = directoryPath(targetPath);
        const newName = fileName(targetPath);
        const dirHandle = await createDirectoryAtPath(rootHandle, newDir);
        const fileHandle = await dirHandle.getFileHandle(newName, { create: true });
        const sourceFile = await sourceHandle.getFile();
        const writable = await fileHandle.createWritable();
        await sourceFile.stream().pipeTo(writable);

        addUuidChange(pending, newDir, newName, uuid);

        // If S3 key needs to change (path action), copy + delete on S3
        let finalVersionId = item.remote!.version;
        let finalEtag = item.remote!.etag || '';
        if (item.remote!.key !== targetKey) {
            const copyResp = await s3Client.send(new CopyObjectCommand({
                Bucket: bucket,
                CopySource: `${bucket}/${encodeURIComponent(item.remote!.key)}?versionId=${item.remote!.version}`,
                Key: targetKey,
                MetadataDirective: 'COPY',
                // Conditional write: require object at targetKey doesn't exist.
                // There is an edge case where this is not correct such as when 'a' is moved to 'b' and 'b' is moved to something else at the same time. This is difficult to handle. To be addressed later
                IfNoneMatch: '*',
            }));
            await s3Client.send(new DeleteObjectCommand({
                Bucket: bucket,
                Key: item.remote!.key,
                IfMatch: quotedEtag(item.remote!.etag),
            }));
            finalVersionId = copyResp.VersionId || finalVersionId;
            finalEtag = copyResp.CopyObjectResult?.ETag?.replace(/"/g, '') || finalEtag;
        }

        // Build base record
        let sha256 = item.remote!.sha256 || '';
        if (!sha256) {
            sha256 = (await computeSha256(fileHandle)).base64;
        }
        const localFile = await fileHandle.getFile();
        const lastModifiedLocal = new Date(localFile.lastModified).toISOString();
        const baseRecord: BaseVersionRecord = {
            key: targetKey,
            version: finalVersionId,
            uuid,
            syncVersion: item.remote!.syncVersion,
            deviceName: item.remote!.deviceName,
            etag: finalEtag,
            sha256,
            contentLength: localFile.size,
            lastModified: item.remote!.lastModified,
            lastModifiedLocal,
            compressionMethod: '',
        };
        pending.baseRecords.set(targetPath, baseRecord);
        pending.baseFileWrites.set(targetPath, fileHandle);

        // Clean up old base path if key changed
        if (item.base && item.base.key !== targetKey) {
            accumulateBasePathChange(pending, prefix, item.base.key, targetKey);
        }
    } else if (contentAction === SyncContentAction.DeleteRemote) {
        // Delete from S3 with conditional check
        await s3Client.send(new DeleteObjectCommand({
            Bucket: bucket,
            Key: item.remote!.key,
            IfMatch: quotedEtag(item.remote!.etag),
        }));

        // Remove base record and file
        if (item.base) {
            const basePath = item.base.key.substring(prefix.length);
            pending.baseRecords.set(basePath, null);
            pending.baseFileDeletes.push(basePath);
        }

    } else if (contentAction === SyncContentAction.DeleteLocal) {
        // Delete local file
        if (item.local) {
            const localPath = item.local.key.substring(prefix.length);
            const dir = directoryPath(localPath);
            const name = fileName(localPath);
            const dirHandle = await getDirectoryAtPath(rootHandle, dir);
            await dirHandle.removeEntry(name);
            addUuidChange(pending, dir, name, null);
        }

        // Remove base record and file
        if (item.base) {
            const basePath = item.base.key.substring(prefix.length);
            pending.baseRecords.set(basePath, null);
            pending.baseFileDeletes.push(basePath);
        }

    } else if (contentAction === SyncContentAction.None && pathAction !== SyncPathAction.None) {
        // Content unchanged, just path move
        if (pathAction === SyncPathAction.UseLocalPath) {
            // S3 key needs to match local key
            const copyResp = await s3Client.send(new CopyObjectCommand({
                Bucket: bucket,
                CopySource: `${bucket}/${encodeURIComponent(item.remote!.key)}?versionId=${item.remote!.version}`,
                Key: targetKey,
                MetadataDirective: 'COPY',
                IfNoneMatch: '*',
            }));
            await s3Client.send(new DeleteObjectCommand({
                Bucket: bucket,
                Key: item.remote!.key,
                IfMatch: quotedEtag(item.remote!.etag),
            }));

            const newVersionId = copyResp.VersionId || item.remote!.version;
            const newEtag = copyResp.CopyObjectResult?.ETag?.replace(/"/g, '') || item.remote!.etag || '';

            // Update base record with new key and version
            const baseRecord: BaseVersionRecord = {
                ...item.base!,
                key: targetKey,
                version: newVersionId,
                etag: newEtag,
            };
            pending.baseRecords.set(targetPath, baseRecord);
            accumulateBasePathChange(pending, prefix, item.base!.key, targetKey);
            // Copy old base file to new path
            pending.baseFileWrites.set(targetPath, item.local!.handle);
        } else {
            // UseRemotePath: move local file to match remote path
            const localPath = item.local!.key.substring(prefix.length);
            const newDir = directoryPath(targetPath);
            const newName = fileName(targetPath);
            const dirHandle = await createDirectoryAtPath(rootHandle, newDir);
            if (dirHandle) {
                const handle = item.local!.handle as any;
                if (typeof handle.move === 'function') {
                    await handle.move(dirHandle, newName);
                }
                else {
                    throw new Error('move is not supported');
                }
            }
            // Update uuid maps
            addUuidChange(pending, directoryPath(localPath), fileName(localPath), null);
            addUuidChange(pending, newDir, newName, uuid);

            // Update base record with new key
            const baseRecord: BaseVersionRecord = {
                ...item.base!,
                key: targetKey,
                lastModifiedLocal: new Date((await item.local!.handle.getFile()).lastModified).toISOString(),
            };
            pending.baseRecords.set(targetPath, baseRecord);
            accumulateBasePathChange(pending, prefix, item.base!.key, targetKey);
            // Copy base file from local handle at new location
            pending.baseFileWrites.set(targetPath, item.local!.handle);
        }
    }

    // Schedule remote cache cleanup for this item's version
    if (item.remote) {
        const remoteRelPath = item.remote.key.substring(prefix.length);
        pending.remoteCacheDeletes.push(remoteCachePath(remoteRelPath, item.remote.version));
    }
}

/**
 * Flush all accumulated metadata changes to disk.
 * This is called once at the end of the sync (or after cancel).
 */
export async function flushPendingChanges(
    rootHandle: FileSystemDirectoryHandle,
    pending: PendingChanges,
) {
    // 1. Update .adoc-editor/s3m/ base metadata records
    if (pending.baseRecords.size > 0) {
        const baseMetaDir = await createDirectoryAtPath(rootHandle, '.adoc-editor/s3m/');

        // Group by directory
        const byDir = new Map<string, Map<string, BaseVersionRecord | null>>();
        for (const [relPath, record] of pending.baseRecords) {
            const dir = directoryPath(relPath);
            const name = fileName(relPath);
            let dirMap = byDir.get(dir);
            if (!dirMap) {
                byDir.set(dir, dirMap = new Map());
            }
            dirMap.set(name, record);
        }

        for (const [dir, changes] of byDir) {
            const dirHandle = await createDirectoryAtPath(baseMetaDir, dir);

            let records: Record<string, BaseVersionRecord> = Object.create(null);
            try {
                const fh = await dirHandle.getFileHandle('.index.json');
                const file = await fh.getFile();
                const text = await file.text();
                records = JSON.parse(text);
            } catch { }

            for (const [name, record] of changes) {
                if (record === null) {
                    delete records[name];
                } else {
                    records[name] = record;
                }
            }

            const fh = await dirHandle.getFileHandle('.index.json', { create: true });
            const writable = await fh.createWritable();
            await writable.write(JSON.stringify(records, null, 2));
            await writable.close();
        }
    }

    // 2. Write base files at .adoc-editor/s3b/<relativePath>
    if (pending.baseFileWrites.size > 0) {
        const baseDir = await createDirectoryAtPath(rootHandle, '.adoc-editor/s3b/');
        for (const [relPath, sourceHandle] of pending.baseFileWrites) {
            const targetHandle = await createFileAtPath(baseDir, relPath);
            const sourceFile = await sourceHandle.getFile();
            const writable = await targetHandle.createWritable();
            await sourceFile.stream().pipeTo(writable);
        }
    }

    // 3. Delete base files from .adoc-editor/s3b/
    if (pending.baseFileDeletes.length > 0) {
        const baseDir = await createDirectoryAtPath(rootHandle, '.adoc-editor/s3b/');
        for (const relPath of pending.baseFileDeletes) {
            const dir = directoryPath(relPath);
            const name = fileName(relPath);
            const dirHandle = await getDirectoryAtPath(baseDir, dir);
            await dirHandle.removeEntry(name);
        }
    }

    // 4. Update uuid maps
    for (const [dirPath, changes] of pending.uuidChanges) {
        const dirHandle = await getDirectoryAtPath(rootHandle, dirPath);
        await updateDirectoryUuidMap(dirHandle, changes);
    }

    // 5. Delete remote cache files from .adoc-editor/s3r/
    if (pending.remoteCacheDeletes.length > 0) {
        for (const cachePath of pending.remoteCacheDeletes) {
            const dir = directoryPath(cachePath);
            const name = fileName(cachePath);
            const dirHandle = await tryGetDirectoryAtPath(rootHandle, dir);
            if (dirHandle) {
                try {
                    await dirHandle.removeEntry(name);
                } catch { }
            }
        }
    }

    traceLog(`Metadata flush complete: ${pending.baseRecords.size} records, ${pending.baseFileWrites.size} base files written, ${pending.baseFileDeletes.length} base files deleted, ${pending.uuidChanges.size} uuid map updates, ${pending.remoteCacheDeletes.length} remote cache files deleted.`);
}
