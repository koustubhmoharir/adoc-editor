import { action } from "mobx";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { CognitoIdentityClient } from "@aws-sdk/client-cognito-identity";
import { fromCognitoIdentityPool } from "@aws-sdk/credential-provider-cognito-identity";
import { AuthStore } from "./AuthStore";
import { S3SyncSettings } from "../file_system/S3SyncSettings";
import { traceLog } from "../utils/trace";
import { User } from "oidc-client-ts";
import { loadRemoteFileFromCache, S3VersionRecord, saveRemoteFileToCache } from "./S3SyncLogic";

export class S3Store {

    constructor(settings: S3SyncSettings) {
        this.settings = settings;
        this.authStore = new AuthStore(settings.authority, settings.client_id);
    }

    readonly settings: S3SyncSettings;
    readonly authStore: AuthStore;

    // Retained S3 client after first sync
    private _s3Client: S3Client | null = null;
    get s3Client() { return this._s3Client; }

    @action
    cleanup() {
        this.authStore.cleanup();
        this._s3Client = null;
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

        // In E2E tests, use the injected mock S3 client
        if (window.__TEST_mockS3Client) {
            this._s3Client = window.__TEST_mockS3Client as S3Client;
            return this._s3Client;
        }

        const user = await this.ensureLoggedIn();
        if (!user) return null;

        this._s3Client = await this.createClient(user);
        return this._s3Client;
    }

    /**
     * Ensure a remote object's content is cached locally.
     * Checks .adoc-editor/s3/r/<relativePath> for existing cache file.
     * If not found, fetches from S3 and streams directly to cache file.
     * Returns the cache file handle, or null on failure.
     */
    async ensureRemoteCached(rootHandle: FileSystemDirectoryHandle, remote: S3VersionRecord): Promise<FileSystemFileHandle | null> {
        const prefix = this.settings.prefix || '';
        const relativePath = remote.key.startsWith(prefix) ? remote.key.substring(prefix.length) : remote.key;

        // Try to load from cache
        const cached = await loadRemoteFileFromCache(rootHandle, relativePath, remote.version);
        if (cached !== null) {
            traceLog(`Using cached remote content for ${relativePath}`);
            return cached;
        }

        // Fetch from S3 and stream to cache
        const client = await this.ensureClient();
        if (!client) return null;

        try {
            const response = await client.send(new GetObjectCommand({
                Bucket: this.settings.bucket,
                Key: remote.key,
                VersionId: remote.version,
            }));

            if (response.Body) {
                const webStream = response.Body.transformToWebStream() as ReadableStream<Uint8Array>;
                const cacheHandle = await saveRemoteFileToCache(rootHandle, relativePath, remote.version, webStream);
                traceLog(`Fetched and cached remote content for ${relativePath}`);
                return cacheHandle;
            }
            return null;
        } catch (e) {
            console.error(`Failed to get object ${remote.key} version ${remote.version}`, e);
            return null;
        }
    }

    /**
     * Get object content as text string, for display in diff editor.
     * Reads from cache file. If not cached and cachedOnly is false, downloads first.
     */
    async getObjectContentAsText(rootHandle: FileSystemDirectoryHandle, remote: S3VersionRecord, { cachedOnly }: { cachedOnly: boolean }): Promise<string | null> {
        let handle: FileSystemFileHandle | null = null;

        if (cachedOnly) {
            const prefix = this.settings.prefix || '';
            const relativePath = remote.key.startsWith(prefix) ? remote.key.substring(prefix.length) : remote.key;
            handle = await loadRemoteFileFromCache(rootHandle, relativePath, remote.version);
        } else {
            handle = await this.ensureRemoteCached(rootHandle, remote);
        }

        if (!handle) return null;

        try {
            const file = await handle.getFile();
            return await file.text();
        } catch (e) {
            console.error(`Failed to read cached file for ${remote.key}`, e);
            return null;
        }
    }
}
