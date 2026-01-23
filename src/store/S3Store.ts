
import { action, observable } from "mobx";
import { S3Client, ListObjectVersionsCommand, HeadObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { CognitoIdentityClient } from "@aws-sdk/client-cognito-identity";
import { fromCognitoIdentityPool } from "@aws-sdk/credential-provider-cognito-identity";
import { AuthStore } from "./AuthStore";
import { Sha256 } from "@aws-crypto/sha256-browser";
import { S3SyncSettings } from "../file_system/S3SyncSettings";
import { DirectoryNodeModel, FileNodeModel } from "./FileSystemModels";
import { traceLog } from "../utils/trace";

export interface SyncItem {
    uuid: string;
    path: string;
    key: string;
    version: string;
    syncversion: number;
    etag?: string;
    sha256?: string;
    mtime?: string;
}

export class S3Store {

    constructor(settings: S3SyncSettings) {
        this.settings = settings;
        this.authStore = new AuthStore(settings.authority, settings.client_id);
    }
    readonly settings: S3SyncSettings;
    readonly authStore: AuthStore;

    @observable accessor connectionStatus: 'idle' | 'testing' | 'success' | 'error' = 'idle';

    // State
    baseItemsByUuid = new Map<string, SyncItem>(); // uuid -> item
    baseItemsByPath = new Map<string, SyncItem>(); // path -> uuid

    @action
    cleanup() {
        this.authStore.cleanup();
    }

    private async scanLocalFiles(rootNode: DirectoryNodeModel): Promise<Map<string, FileSystemFileHandle>> {
        const files = new Map<string, FileSystemFileHandle>();

        const scan = async (dirNode: DirectoryNodeModel, currentPath: string) => {
            // 1. Unconditionally check for .adoc-editor/ignore.toml in this directory (on disk)
            try {
                const configDir = await dirNode.handle.getDirectoryHandle('.adoc-editor');
                const ignoreFile = await configDir.getFileHandle('ignore.toml');
                const ignorePath = currentPath ? `${currentPath}/.adoc-editor/ignore.toml` : '.adoc-editor/ignore.toml';
                files.set(ignorePath, ignoreFile);
            } catch {
                // ignore if not found
            }

            // 2. Iterate children (model)
            if (dirNode.children) {
                for (const child of dirNode.children) {
                    const entryPath = currentPath ? `${currentPath}/${child.name}` : child.name;

                    if (child.name === '.adoc-editor') {
                        continue;
                    }

                    if (child instanceof FileNodeModel) {
                        files.set(entryPath, child.handle);
                    } else if (child instanceof DirectoryNodeModel) {
                        if (child.hasS3SyncConfig) {
                            traceLog(`Skipping nested sync root: ${entryPath}`);
                            continue;
                        }
                        await scan(child, entryPath);
                    }
                }
            }
        };

        await scan(rootNode, '');
        return files;
    }

    private async readBaseState(configDir: FileSystemDirectoryHandle) {
        this.baseItemsByUuid.clear();
        this.baseItemsByPath.clear();
        let baseDir: FileSystemDirectoryHandle;
        try {
            const s3Dir = await configDir.getDirectoryHandle('s3');
            baseDir = await s3Dir.getDirectoryHandle('base');

        } catch (e) {
            traceLog("No existing base state found (or failed to read).");
            return;
        }
        for await (const [name, entry] of baseDir.entries()) {
            if (entry.kind === 'file' && name.endsWith('.json')) {
                const file = await entry.getFile();
                const text = await file.text();
                try {
                    const data = JSON.parse(text) as SyncItem;
                    const uuid = name.replace('.json', '');
                    data.uuid = uuid; // Ensure uuid is set
                    this.baseItemsByUuid.set(uuid, data);
                    this.baseItemsByPath.set(data.path, data);
                } catch (e) {
                    console.warn(`Failed to parse base state file ${name}: ${e}`);
                }
            }
        }
    }

    @action
    async sync(rootNode: DirectoryNodeModel) {
        let configDir: FileSystemDirectoryHandle;
        try {
            configDir = await rootNode.handle.getDirectoryHandle('.adoc-editor');
        } catch {
            traceLog("Cannot read .adoc-editor directory");
            return;
        }
        this.connectionStatus = 'testing';
        traceLog("Starting S3 Sync scan...");

        try {
            // 1. Check Auth logic
            if (!this.authStore.user) {
                traceLog("User not authenticated. Initiating login...");
                await this.authStore.login();

                if (!this.authStore.user) {
                    traceLog("Login failed or cancelled.");
                    this.connectionStatus = 'error';
                    return;
                }
            }

            // 2. Setup AWS Client
            const user = this.authStore.user;
            if (!user) {
                this.connectionStatus = 'error';
                return;
            }

            traceLog(`Configuring AWS credentials for region: ${this.settings.region}`);
            const logins = {};
            let loginKey = this.settings.authority.replace('https://', '');
            if (loginKey.endsWith('/')) loginKey = loginKey.slice(0, -1);
            // @ts-ignore
            logins[loginKey] = user.id_token;

            const credentialProvider = fromCognitoIdentityPool({
                client: new CognitoIdentityClient({ region: this.settings.region }),
                identityPoolId: this.settings.identity_pool_id,
                logins: logins
            });

            const s3Client = new S3Client({
                region: this.settings.region,
                credentials: credentialProvider,
            });

            // 3. Scan Local Files
            traceLog("Scanning local files...");
            const localFiles = await this.scanLocalFiles(rootNode);
            traceLog(`Found ${localFiles.size} local files.`);

            // 4. Read Base State
            traceLog("Reading base state...");
            await this.readBaseState(configDir);
            traceLog(`Found ${this.baseItemsByUuid.size} items in base state.`);

            // 5. List Remote Objects & Persist State
            traceLog(`Listing objects in bucket: ${this.settings.bucket} (prefix: ${this.settings.prefix || ''})`);

            // Ensure .adoc-editor/s3/remote directory exists
            let remoteStateDir: FileSystemDirectoryHandle | undefined;
            try {
                const s3Dir = await configDir.getDirectoryHandle('s3', { create: true });
                remoteStateDir = await s3Dir.getDirectoryHandle('remote', { create: true });
            } catch (e) {
                traceLog(`Failed to read or create remote state directory: ${e}`);
                return;
            }

            const remoteItems = new Map<string, SyncItem>();
            let keyMarker: string | undefined;
            let versionIdMarker: string | undefined;
            const prefix = this.settings.prefix || '';

            do {
                const command = new ListObjectVersionsCommand({
                    Bucket: this.settings.bucket,
                    Prefix: prefix,
                    KeyMarker: keyMarker,
                    VersionIdMarker: versionIdMarker
                });
                const response = await s3Client.send(command);

                if (response.Versions) {
                    for (const item of response.Versions) {
                        if (!item.IsLatest) continue;
                        if (!item.Key || item.Key.endsWith('/')) continue;
                        if (!item.VersionId) continue;

                        let syncItem: SyncItem | undefined = undefined;
                        const relativePath = item.Key.startsWith(prefix) ? item.Key.slice(prefix.length) : null;

                        if (!relativePath) {
                            continue;
                        }

                        // Optimization: Check Base State by Path AND S3 Object Version
                        // If both path and version match base, we can reuse the uuid AND syncversion from base.
                        const baseItem = this.baseItemsByPath.get(relativePath);
                        if (baseItem && baseItem.version === item.VersionId) {
                            syncItem = {
                                uuid: baseItem.uuid,
                                path: relativePath,
                                key: item.Key,
                                version: item.VersionId,
                                syncversion: baseItem.syncversion,
                                etag: item.ETag?.replace(/"/g, '') || baseItem.etag,
                                mtime: item.LastModified?.toISOString() || baseItem.mtime
                            };
                        } else {
                            // Mismatch or new file - Fetch Metadata via HEAD
                            try {
                                const headCommand = new HeadObjectCommand({
                                    Bucket: this.settings.bucket,
                                    Key: item.Key,
                                    VersionId: item.VersionId
                                });
                                const headResponse = await s3Client.send(headCommand);
                                const uuid = headResponse.Metadata?.['uuid'];
                                const syncversionStr = headResponse.Metadata?.['syncversion'];

                                if (uuid && syncversionStr) {
                                    syncItem = {
                                        uuid: uuid,
                                        path: relativePath,
                                        key: item.Key,
                                        version: item.VersionId,
                                        syncversion: parseInt(syncversionStr, 10),
                                        etag: item.ETag?.replace(/"/g, ''),
                                        mtime: item.LastModified?.toISOString()
                                    };
                                } else {
                                    console.warn(`Skipping object without proper metadata (uuid/syncversion): ${item.Key}`);
                                }
                            } catch (e) {
                                console.warn(`Failed to fetch metadata for ${item.Key}: ${e}`);
                            }
                        }

                        if (syncItem) {
                            remoteItems.set(syncItem.path, syncItem);

                            // Persist to disk
                            try {
                                const fileHandle = await remoteStateDir.getFileHandle(`${syncItem.uuid}.json`, { create: true });
                                const writable = await fileHandle.createWritable();
                                await writable.write(JSON.stringify(syncItem, null, 2));
                                await writable.close();
                            } catch (e) {
                                console.warn(`Failed to persist remote state item: ${e}`);
                            }
                        }
                    }
                }
                keyMarker = response.NextKeyMarker;
                versionIdMarker = response.NextVersionIdMarker;
            } while (keyMarker || versionIdMarker);

            traceLog(`Found ${remoteItems.size} remote objects.`);

            // 6. Compute Actions
            await this.computeProposedActions(localFiles, remoteItems, s3Client, remoteStateDir!);

            this.connectionStatus = 'success';
        } catch (error: any) {
            console.error("S3 Sync Error:", error);
            this.connectionStatus = 'error';
        }
    }

    private async computeProposedActions(
        localFiles: Map<string, FileSystemFileHandle>,
        remoteItems: Map<string, SyncItem>,
        s3Client: S3Client,
        remoteStateDir: FileSystemDirectoryHandle
    ) {
        traceLog("Computing proposed actions...");

        const processedPaths = new Set<string>();

        // A. Iterate Base Items
        for (const [_, baseItem] of this.baseItemsByUuid) {
            const path = baseItem.path;
            processedPaths.add(path);

            const localExists = localFiles.has(path);
            const remoteItem = remoteItems.get(path); // Lookup by path

            // Logic Matrix with syncversion
            const remoteVersion = remoteItem ? remoteItem.syncversion : 0;
            const baseVersion = baseItem.syncversion;

            const remoteChanged = remoteItem && remoteVersion > baseVersion;
            const remoteReverted = remoteItem && remoteVersion < baseVersion;
            const remoteMatchesBase = remoteItem && remoteVersion === baseVersion;
            const remoteDeleted = !remoteItem;

            let localSha256: string | undefined;
            if (localExists) {
                const handle = localFiles.get(path)!;
                localSha256 = await this.computeSha256(handle);
            }

            // Ensure remote hash is available if we need to compare content
            if (remoteItem && !remoteItem.sha256) {
                try {
                    traceLog(`Downloading content for ${path} to compute hash...`);
                    // Create handle for content
                    const fileHandle = await remoteStateDir.getFileHandle(`${remoteItem.uuid}.content`, { create: true });
                    // Download and compute hash simultaneously (streaming)
                    remoteItem.sha256 = await this.downloadAndHashRaw(s3Client, remoteItem.key, fileHandle, remoteItem.version);
                } catch (e) {
                    console.error(`Failed to download/hash remote content for ${path}`, e);
                }
            }

            const contentMatchesBase = localExists && localSha256 === baseItem.sha256;
            const contentMatchesRemote = localExists && remoteItem && localSha256 === remoteItem.sha256;

            if (remoteMatchesBase) {
                if (localExists) {
                    if (contentMatchesBase) {
                        console.log(`[${path}] No change.`);
                    } else {
                        // Local changed, Remote same as base -> Upload
                        console.log(`[${path}] Upload new version.`);
                    }
                } else {
                    // Local deleted, Remote same as base -> Delete Remote
                    console.log(`[${path}] Delete remote version.`);
                }
            } else if (remoteChanged) {
                // Remote is newer (higher syncversion)
                if (localExists) {
                    if (contentMatchesBase) {
                        // Local same as base, Remote newer -> Update Local
                        console.log(`[${path}] Replace local with remote (v${remoteVersion}).`);
                    } else if (contentMatchesRemote) {
                        // Local matches remote -> No change, update base
                        console.log(`[${path}] Local matches remote (v${remoteVersion}). Update base.`);
                    } else {
                        // Local changed, Remote newer -> Conflict
                        console.log(`[${path}] Conflict (local change, remote v${remoteVersion}).`);
                    }
                } else {
                    // Local deleted, Remote newer -> Conflict
                    console.log(`[${path}] Conflict (local delete, remote v${remoteVersion}).`);
                }
            } else if (remoteReverted) {
                // Remote is older (lower syncversion) - likely reverted
                if (localExists) {
                    if (contentMatchesBase) {
                        // Local same as base, Remote reverted -> Replace Local
                        console.log(`[${path}] Replace local with remote (reverted v${remoteVersion}).`);
                    } else if (contentMatchesRemote) {
                        // Local matches remote -> No change, update base
                        console.log(`[${path}] Local matches remote (reverted v${remoteVersion}). Update base.`);
                    } else {
                        // Local changed, Remote reverted -> Conflict
                        console.log(`[${path}] Conflict (local change, remote revert v${remoteVersion}).`);
                    }
                } else {
                    // Local deleted, Remote reverted -> Conflict
                    console.log(`[${path}] Conflict (local delete, remote revert v${remoteVersion}).`);
                }
            } else if (remoteDeleted) {
                if (localExists) {
                    if (contentMatchesBase) {
                        // Local same as base, Remote deleted -> Delete Local
                        console.log(`[${path}] Remote file missing. Delete local.`);
                    } else {
                        // Local changed, Remote deleted -> Conflict
                        console.log(`[${path}] Conflict (local change, remote delete).`);
                    }
                } else {
                    // Both deleted
                    console.log(`[${path}] Both deleted. Clean up base.`);
                }
            }
        }

        // B. New Local Files
        for (const [path] of localFiles) {
            if (processedPaths.has(path)) continue;

            const remoteItem = remoteItems.get(path);
            if (remoteItem) {
                // Determine if content matches to detect "No change but update base"
                let localSha256: string | undefined;
                const handle = localFiles.get(path)!;
                localSha256 = await this.computeSha256(handle); // Calculate strictly

                // Ensure remote hash
                if (!remoteItem.sha256) {
                    try {
                        const fileHandle = await remoteStateDir.getFileHandle(`${remoteItem.uuid}.content`, { create: true });
                        remoteItem.sha256 = await this.downloadAndHashRaw(s3Client, remoteItem.key, fileHandle, remoteItem.version);
                    } catch (e) { console.error(e); }
                }

                if (localSha256 === remoteItem.sha256) {
                    console.log(`[${path}] Match existing remote file (v${remoteItem.syncversion}). Update base.`);
                } else {
                    // Exists on remote but different -> Conflict
                    console.log(`[${path}] Conflict (local new, remote exists v${remoteItem.syncversion}).`);
                }
            } else {
                console.log(`[${path}] Upload new file to remote.`);
            }
        }

        // C. New Remote Files
        for (const [relativePath, remoteItem] of remoteItems) {
            // Check if handled by Base (via Path)
            if (processedPaths.has(relativePath)) continue;

            // Also check if local file exists (handled in B)
            if (localFiles.has(relativePath)) continue;

            // If not in Base and not in Local -> New Remote File (Download)
            console.log(`[${relativePath}] Download new file from remote (v${remoteItem.syncversion}).`);
        }
    }

    private async computeSha256(input: FileSystemFileHandle): Promise<string> {
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
        return Array.from(digest).map(b => b.toString(16).padStart(2, '0')).join('');
    }

    private async downloadAndHashRaw(client: S3Client, key: string, destHandle: FileSystemFileHandle, versionId?: string): Promise<string> {
        const command = new GetObjectCommand({
            Bucket: this.settings.bucket,
            Key: key,
            VersionId: versionId
        });
        const response = await client.send(command);

        if (!response.Body) {
            throw new Error("Empty body in S3 response");
        }

        const hash = new Sha256();
        const writable = await destHandle.createWritable();

        // AWS SDK Body (Blob | ReadableStream | etc)
        // We assume ReadableStream in browser environment
        const stream = response.Body as unknown as ReadableStream<Uint8Array>;
        const reader = stream.getReader();

        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                if (value) {
                    // Update Hash
                    hash.update(value);
                    // Write to Disk
                    await writable.write(value as any);
                }
            }
        } finally {
            reader.releaseLock();
            await writable.close();
        }

        const digest = await hash.digest();
        return Array.from(digest).map(b => b.toString(16).padStart(2, '0')).join('');
    }
}
