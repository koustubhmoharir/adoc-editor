
import { action, observable } from "mobx";
import { S3Client, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { CognitoIdentityClient } from "@aws-sdk/client-cognito-identity";
import { fromCognitoIdentityPool } from "@aws-sdk/credential-provider-cognito-identity";
import { AuthStore } from "./AuthStore";
import { S3SyncSettings } from "../file_system/S3SyncSettings";

export class S3Store {

    constructor(settings: S3SyncSettings) {
        this.settings = settings;
        this.authStore = new AuthStore(settings.authority, settings.client_id);

    }
    readonly settings: S3SyncSettings;
    readonly authStore: AuthStore;

    @observable accessor connectionStatus: 'idle' | 'testing' | 'success' | 'error' = 'idle';
    @observable accessor logs: string[] = [];

    @action
    addLog(message: string) {
        this.logs.push(`[${new Date().toLocaleTimeString()}] ${message}`);
    }

    @action
    cleanup() {
        this.authStore.cleanup();
    }

    @action
    async sync() {
        this.connectionStatus = 'testing';
        this.logs = [];
        this.addLog("Starting S3 Sync...");

        try {
            // Check Auth
            if (!this.authStore.user) {
                this.addLog("User not authenticated. Initiating login...");
                await this.authStore.login();

                if (!this.authStore.user) {
                    this.addLog("Login failed or cancelled.");
                    this.connectionStatus = 'error';
                    return;
                }
            }

            // Get Token
            const user = this.authStore.user;
            if (!user) {
                this.connectionStatus = 'error';
                return;
            }

            this.addLog(`Configuring AWS credentials for region: ${this.settings.region}`);

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

            this.addLog(`Listing objects in bucket: ${this.settings.bucket}`);

            const command = new ListObjectsV2Command({
                Bucket: this.settings.bucket,
                MaxKeys: 5 // Just peek for now
            });

            const response = await s3Client.send(command);

            this.addLog("Successfully received response from S3.");
            this.addLog(`Found ${response.KeyCount || 0} objects.`);

            this.connectionStatus = 'success';
        } catch (error: any) {
            console.error("S3 Sync Error:", error);
            this.addLog(`ERROR: ${error.message}`);
            this.connectionStatus = 'error';
        }
    }
}
