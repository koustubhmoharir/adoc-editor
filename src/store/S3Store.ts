
import { action, observable, runInAction } from "mobx";
import { S3Client } from "@aws-sdk/client-s3";
import { CognitoIdentityClient } from "@aws-sdk/client-cognito-identity";
import { fromCognitoIdentityPool } from "@aws-sdk/credential-provider-cognito-identity";
import { AuthStore } from "./AuthStore";
import { S3SyncSettings } from "../file_system/S3SyncSettings";
import { DirectoryNodeModel } from "./FileSystemModels";
import { traceLog } from "../utils/trace";
import { User } from "oidc-client-ts";
import { FileSyncStatus, scanAndCalculateStatus } from "./S3SyncLogic";

export class S3Store {

    constructor(settings: S3SyncSettings) {
        this.settings = settings;
        this.authStore = new AuthStore(settings.authority, settings.client_id);
    }

    readonly settings: S3SyncSettings;
    readonly authStore: AuthStore;

    @observable accessor _syncStatusItems: FileSyncStatus[] | undefined = undefined;
    get syncStatusItems() { return this._syncStatusItems; }

    @action
    cleanup() {
        this.authStore.cleanup();
    }

    private async ensureLoggedIn() {
        // 1. Check Auth logic
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

    @action
    async sync(rootNode: DirectoryNodeModel) {
        traceLog("Starting S3 Sync scan...");

        // 2. Setup AWS Client
        const user = await this.ensureLoggedIn();
        if (!user) return;

        const s3Client = await this.createClient(user);

        try {
            const statusItems = await scanAndCalculateStatus(rootNode, s3Client, this.settings);

            runInAction(() => {
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