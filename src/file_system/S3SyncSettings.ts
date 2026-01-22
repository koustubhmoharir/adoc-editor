
import { parse } from 'smol-toml';

export interface S3SyncSettings {
    bucket: string;
    region: string;
    identity_pool_id: string;
    authority: string;
    client_id: string;
}

export function defaultS3SyncContent(): string {
    return `# S3 Sync Configuration

# The name of the S3 bucket to sync with
bucket = "your-bucket-name"

# The AWS Region (e.g., us-east-1)
region = "us-east-1"

# The Cognito Identity Pool ID
identity_pool_id = "us-east-1:xxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"

# The OIDC Authority (Cognito User Pool Issuer URL)
# e.g. https://cognito-idp.us-east-1.amazonaws.com/us-east-1_xxxxx
authority = "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_xxxxx"

# The OIDC Client ID (Cognito App Client ID)
client_id = "your_app_client_id"
`;
}

export function parseS3SyncSettings(content: string): S3SyncSettings {
    try {
        const parsed = parse(content) as any;

        // Basic validation
        if (!parsed.bucket || typeof parsed.bucket !== 'string') throw new Error("Missing or invalid 'bucket'");
        if (!parsed.region || typeof parsed.region !== 'string') throw new Error("Missing or invalid 'region'");
        if (!parsed.identity_pool_id || typeof parsed.identity_pool_id !== 'string') throw new Error("Missing or invalid 'identity_pool_id'");
        if (!parsed.authority || typeof parsed.authority !== 'string') throw new Error("Missing or invalid 'authority'");
        if (!parsed.client_id || typeof parsed.client_id !== 'string') throw new Error("Missing or invalid 'client_id'");

        return {
            bucket: parsed.bucket,
            region: parsed.region,
            identity_pool_id: parsed.identity_pool_id,
            authority: parsed.authority,
            client_id: parsed.client_id
        };
    } catch (e: any) {
        throw new Error(`Failed to parse s3sync.toml: ${e.message}`);
    }
}

export function areSettingsEqual(a: S3SyncSettings, b: S3SyncSettings): boolean {
    return a.bucket === b.bucket &&
        a.region === b.region &&
        a.identity_pool_id === b.identity_pool_id &&
        a.authority === b.authority &&
        a.client_id === b.client_id;
}
