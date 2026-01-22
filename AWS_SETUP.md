# AWS Configuration Guide for Authenticated S3 Access

To provide secure access to your S3 bucket, we will use **Amazon Cognito User Pools** (for authentication) and **Identity Pools** (for authorization).

## Step 1: Create a Cognito User Pool

1.  Go to the [Amazon Cognito Console](https://console.aws.amazon.com/cognito/home).
2.  **Create user pool**:
    *   **Sign-in options**: Select **Email**.
    *   **Security requirements**: Leave defaults (MFA off for testing).
    *   **Sign-up experience**: Leave defaults.
    *   **Email delivery**: Send email with Cognito.
3.  **App client**:
    *   App type: **Public client**.
    *   App client name: `adoc-editor-client`.
    *   **Client secret**: Don't generate a client secret (Web apps can't store it securely).
4.  **Review and Create**.
5.  **Noted Values**:
    *   **User Pool ID** (e.g., `us-east-1_abcdef123`) -> `AUTH_USER_POOL_ID`
    *   **App Client ID** (e.g., `1234567890abcdef123456789`) -> `CLIENT_ID`

## Step 2: Configure App Client Settings

1.  Go to your new User Pool -> **App integration**.
2.  **App client list** -> Click your client.
3.  **Hosted UI**:
    *   **Allowed callback URLs**: `http://localhost:8001/callback.html`
    *   **Allowed sign-out URLs**: `http://localhost:8001`
    *   **OAuth 2.0 grant types**: Select **Authorization code grant**.
    *   **OpenID Connect scopes**: Select `openid`, `email`, `profile`.
4.  **Domain**: Create a Cognito domain (e.g., `https://my-adoc-editor.auth.us-east-1.amazoncognito.com`).
    *   Note this URL (The base part is your `AUTHORITY` sans `/oauth2...`, actually `oidc-client-ts` typically uses `https://cognito-idp.<region>.amazonaws.com/<pool_id>`).
    *   Wait, `oidc-client-ts` needs the **Issuer** which is `https://cognito-idp.{region}.amazonaws.com/{userPoolId}`.
    *   You DO need a domain for the Hosted UI to work.

## Step 3: Create a Cognito Identity Pool

1.  Go to **Identity pools**.
2.  **Create identity pool**.
3.  **Authentication providers**:
    *   Select **Cognito User Pool**.
    *   Enter your **User Pool ID** and **App Client ID**.
4.  **Permissions**:
    *   Create a new IAM Basic Role (for Authenticated users).
    *   Name it something like `Cognito_AdocEditorAuth_Role`.
5.  Review and Create.
6.  **Noted Values**:
    *   **Identity Pool ID** -> `IDENTITY_POOL_ID`

## Step 4: Grant S3 Permissions to the IAM Role

1.  Go to **IAM Console** -> **Roles**.
2.  Find `Cognito_AdocEditorAuth_Role`.
3.  Add Inline Policy (same as before, but for this role):

```json
{
	"Version": "2012-10-17",
	"Statement": [
		{
			"Effect": "Allow",
			"Action": [ "s3:ListBucket" ],
			"Resource": "arn:aws:s3:::YOUR_BUCKET_NAME"
		},
		{
			"Effect": "Allow",
			"Action": [ "s3:GetObject", "s3:PutObject", "s3:DeleteObject" ],
			"Resource": "arn:aws:s3:::YOUR_BUCKET_NAME/*"
		}
	]
}
```

## Step 5: Configure S3 CORS

Ensure your bucket allows requests from `http://localhost:8001` (as described in previous guide).

## Step 6: Create a User

1.  Go to User Pool -> **Users**.
2.  Create user (enter email, temp password).
3.  Since we are using Hosted UI, the new user will be prompted to change password on first login.

## Configuration in Code

**`src/store/AuthStore.ts`**:
-   `AUTHORITY`: `https://cognito-idp.<region>.amazonaws.com/<user_pool_id>`
-   `CLIENT_ID`: Your App Client ID.

**`src/store/S3Store.ts`**:
-   `IDENTITY_POOL_ID`: Your Identity Pool ID.
-   `AUTH_USER_POOL_ID`: Your User Pool ID (e.g., `us-east-1_xxxxx`).
-   `REGION`: AWS Region.
-   `BUCKET_NAME`: Target Bucket.
