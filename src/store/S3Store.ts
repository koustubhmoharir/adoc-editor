import { observable, action, runInAction } from "mobx";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { CognitoIdentityClient } from "@aws-sdk/client-cognito-identity";
import { fromCognitoIdentityPool } from "@aws-sdk/credential-provider-cognito-identity";
import { AuthStore } from "./AuthStore";
import { S3SyncSettings } from "../file_system/S3SyncSettings";
import { DirectoryNodeModel } from "./FileSystemModels";
import { traceLog } from "../utils/trace";
import { User } from "oidc-client-ts";
import { FileSyncStatus, scanAndCalculateStatus, S3VersionRecord } from "./S3SyncLogic";

export class S3Store {

    constructor(settings: S3SyncSettings) {
        this.settings = settings;
        this.authStore = new AuthStore(settings.authority, settings.client_id);
    }

    readonly settings: S3SyncSettings;
    readonly authStore: AuthStore;

    // Root directory handle for cache access - set by S3SyncStore
    private _rootHandle: FileSystemDirectoryHandle | null = null;

    setRootHandle(handle: FileSystemDirectoryHandle) {
        this._rootHandle = handle;
    }

    // Retained S3 client after first sync
    private _s3Client: S3Client | null = null;
    get s3Client() { return this._s3Client; }

    @observable accessor _syncStatusItems: FileSyncStatus[] | undefined = undefined;
    get syncStatusItems() { return this._syncStatusItems; }

    @observable accessor selectedItem: FileSyncStatus | null = null;

    @action.bound
    setSelectedItem(item: FileSyncStatus | null) {
        this.selectedItem = item;
    }

    @action
    cleanup() {
        this.authStore.cleanup();
        this._s3Client = null;
        this._rootHandle = null;
    }

    private async ensureLoggedIn() {
        if (!this.authStore.user) {
            traceLog("User not authenticated. Initiating login...");
            await this.authStore.login();

            if (!this.authStore.user) {
                traceLog("Login failed or cancelled.");
                return;
            }
        }
        return this.authStore.user;
    }

    private async createClient(user: User) {
        traceLog(`Configuring AWS credentials for region: ${this.settings.region}`);
        const logins: Record<string, string> = {};
        let loginKey = this.settings.authority.replace('https://', '');
        if (loginKey.endsWith('/')) loginKey = loginKey.slice(0, -1);
        logins[loginKey] = user.id_token || '';

        const credentialProvider = fromCognitoIdentityPool({
            client: new CognitoIdentityClient({ region: this.settings.region }),
            identityPoolId: this.settings.identity_pool_id,
            logins: logins
        });

        return new S3Client({
            region: this.settings.region,
            credentials: credentialProvider,
        });
    }

    async ensureClient(): Promise<S3Client | null> {
        if (this._s3Client) return this._s3Client;

        const user = await this.ensureLoggedIn();
        if (!user) return null;

        this._s3Client = await this.createClient(user);
        return this._s3Client;
    }

    /**
     * Get object content with caching.
     * First checks .adoc-editor/s3/r/<relativePath> for cached content.
     * If not found, fetches from S3 and caches locally.
     */
    async getObjectContent(remote: S3VersionRecord): Promise<string | null> {
        const prefix = this.settings.prefix || '';
        const relativePath = remote.key.startsWith(prefix) ? remote.key.substring(prefix.length) : remote.key;

        // Try to load from cache
        const cached = await this.loadFromCache(relativePath);
        if (cached !== null) {
            traceLog(`Using cached remote content for ${relativePath}`);
            return cached;
        }

        // Fetch from S3
        const client = await this.ensureClient();
        if (!client) return null;

        try {
            const response = await client.send(new GetObjectCommand({
                Bucket: this.settings.bucket,
                Key: remote.key,
                VersionId: remote.version, // Fetch specific version
            }));

            if (response.Body) {
                const content = await response.Body.transformToString();
                // Cache the content
                await this.saveToCache(relativePath, content);
                traceLog(`Fetched and cached remote content for ${relativePath}`);
                return content;
            }
            return null;
        } catch (e) {
            console.error(`Failed to get object ${remote.key} version ${remote.version}`, e);
            return null;
        }
    }

    private async loadFromCache(relativePath: string): Promise<string | null> {
        if (!this._rootHandle) return null;

        try {
            const cachePath = `.adoc-editor/s3/r/${relativePath}`;
            const handle = await this.getFileHandle(this._rootHandle, cachePath);
            if (handle) {
                const file = await handle.getFile();
                return await file.text();
            }
        } catch {
            // Cache miss
        }
        return null;
    }

    private async saveToCache(relativePath: string, content: string): Promise<void> {
        if (!this._rootHandle) return;

        try {
            const cachePath = `.adoc-editor/s3/r/${relativePath}`;
            const handle = await this.createFileHandle(this._rootHandle, cachePath);
            if (handle) {
                const writable = await handle.createWritable();
                await writable.write(content);
                await writable.close();
            }
        } catch (e) {
            console.error(`Failed to cache remote content at ${relativePath}`, e);
        }
    }

    private async getFileHandle(rootHandle: FileSystemDirectoryHandle, path: string): Promise<FileSystemFileHandle | null> {
        const parts = path.split('/').filter(p => p.length > 0);
        let currentDir = rootHandle;

        for (let i = 0; i < parts.length - 1; i++) {
            try {
                currentDir = await currentDir.getDirectoryHandle(parts[i]);
            } catch {
                return null;
            }
        }

        try {
            return await currentDir.getFileHandle(parts[parts.length - 1]);
        } catch {
            return null;
        }
    }

    private async createFileHandle(rootHandle: FileSystemDirectoryHandle, path: string): Promise<FileSystemFileHandle | null> {
        const parts = path.split('/').filter(p => p.length > 0);
        let currentDir = rootHandle;

        for (let i = 0; i < parts.length - 1; i++) {
            try {
                currentDir = await currentDir.getDirectoryHandle(parts[i], { create: true });
            } catch {
                return null;
            }
        }

        try {
            return await currentDir.getFileHandle(parts[parts.length - 1], { create: true });
        } catch {
            return null;
        }
    }

    @action
    async sync(rootNode: DirectoryNodeModel) {
        traceLog("Starting S3 Sync scan...");

        // Store root handle for cache access
        this._rootHandle = rootNode.handle;

        const s3Client = await this.ensureClient();
        if (!s3Client) return;

        try {
            const statusItems = await scanAndCalculateStatus(rootNode, s3Client, this.settings);
            const prefix = this.settings.prefix || '';

            runInAction(() => {
                statusItems.sort((a, b) => a.relativePath(prefix).localeCompare(b.relativePath(prefix)));
                this._syncStatusItems = statusItems;
                traceLog(`Sync status calculation complete. Found ${statusItems.length} items.`);
            });
        } catch (e) {
            console.error("Sync failed", e);
            runInAction(() => {
                traceLog(`Sync failed: ${e}`);
            });
        }
    }
}
