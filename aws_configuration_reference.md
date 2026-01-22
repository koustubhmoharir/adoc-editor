# Browser-only S3 Sync — AWS Configuration Reference

This document describes the complete AWS-side configuration used to enable a **browser-only S3 sync application** authenticated via **Amazon Cognito**, with no long‑lived credentials and no local backend.

It is intended as **future reference** for yourself and for others if the project is shared or open-sourced.

---

## 1. High-level Architecture

**Trust flow:**

```
Browser App
  ↓ (OIDC login)
Cognito User Pool
  ↓ (JWT id token)
Cognito Identity Pool
  ↓ (STS AssumeRoleWithWebIdentity)
IAM Role (scoped)
  ↓
Amazon S3 Bucket (private)
```

Key properties:
- No IAM users are created for end users
- No AWS credentials are stored in the app
- Credentials are short-lived STS credentials
- All access is scoped to a specific bucket (or prefix)

---

## 2. S3 Bucket Configuration

### 2.1 Bucket properties

- **Bucket is private**
- **Block Public Access: ENABLED (all options)**
- Versioning: optional (transparent to the app)

No public bucket policy is used.

---

### 2.2 CORS configuration (required for browser access)

Configured at:
> **S3 → Bucket → Permissions → CORS configuration**

Example:

```json
[
  {
    "AllowedOrigins": [
      "http://localhost:3000",
      "http://127.0.0.1:3000",
      "https://my-app.localhost"
    ],
    "AllowedMethods": [
      "GET",
      "PUT",
      "POST",
      "DELETE",
      "HEAD"
    ],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": [
      "ETag",
      "x-amz-version-id",
      "x-amz-request-id",
      "x-amz-id-2",
      "x-amz-checksum-sha256"
    ],
    "MaxAgeSeconds": 300
  }
]
```

Notes:
- `AllowedHeaders: "*"` is required for SigV4
- `ExposeHeaders` must list explicit names (no wildcards)
- Prefer explicit localhost origins over `*`

---

## 3. Cognito User Pool (Authentication)

Purpose:
- Handles **user login** via OIDC
- Issues **ID tokens** used only for identity federation

### 3.1 Configuration highlights

- App client configured for:
  - Authorization Code Flow (with PKCE)
  - No client secret (browser app)
- Hosted UI or custom OIDC flow supported
- Tokens are kept **in memory**, not localStorage

The User Pool **does not grant AWS permissions**.

---

## 4. Cognito Identity Pool (Federation)

Purpose:
- Bridges **OIDC identity → IAM role**
- Exchanges User Pool tokens for AWS credentials

### 4.1 Provider configuration

- Identity Pool configured with:
  - Cognito User Pool as an authentication provider
- No unauthenticated identities enabled

### 4.2 Workflow choice

- **Enhanced (default) workflow used**
- Basic / Classic flow NOT required

The app only calls:
```text
GetCredentialsForIdentity
```

---

## 5. IAM Role for Browser Access

This role is assumed automatically via STS when the browser calls Cognito Identity Pools.

### 5.1 Trust policy (who can assume the role)

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "cognito-identity.amazonaws.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "cognito-identity.amazonaws.com:aud": "IDENTITY_POOL_ID"
        }
      }
    }
  ]
}
```

---

### 5.2 Permissions policy (what the browser can do)

#### Bucket-level permissions

```json
{
  "Effect": "Allow",
  "Action": [
    "s3:ListBucket",
    "s3:ListBucketMultipartUploads"
  ],
  "Resource": "arn:aws:s3:::MY_BUCKET"
}
```

Optional prefix restriction:
```json
"Condition": {
  "StringLike": {
    "s3:prefix": ["user-data/*"]
  }
}
```

---

#### Object-level permissions

```json
{
  "Effect": "Allow",
  "Action": [
    "s3:GetObject",
    "s3:GetObjectAttributes",
    "s3:PutObject",
    "s3:DeleteObject",

    "s3:AbortMultipartUpload",
    "s3:ListMultipartUploadParts",

    "s3:GetObjectTagging",
    "s3:PutObjectTagging"
  ],
  "Resource": "arn:aws:s3:::MY_BUCKET/*"
}
```

Explicitly NOT granted:
- `s3:TagResource`
- `s3:UntagResource`
- Any bucket policy modification actions

---

## 6. Multipart Upload Support

Multipart uploads work transparently.

Required actions:
- `PutObject`
- `AbortMultipartUpload`
- `ListMultipartUploadParts`

No version awareness required.

---

## 7. Object Metadata, Tags, and Attributes

### Metadata
- Stored as `x-amz-meta-*`
- Must expose **explicit header names** in CORS
- No wildcards allowed in `ExposeHeaders`

### Tags (preferred for sync state)
- Managed via `PutObjectTagging`
- Retrieved via `GetObjectTagging` or `GetObjectAttributes`
- No CORS header exposure required

### Attributes
- Retrieved via `GetObjectAttributes`
- Supports size, checksum, storage class, tags, metadata

---

## 8. Security Model Summary

- No long-lived credentials
- No IAM users per human
- Short-lived STS credentials only
- CORS limits browser origins
- IAM limits AWS actions
- Versioning optional and backward compatible

Primary risk areas:
- XSS in the browser app
- Malicious browser extensions (out of scope)

---

## 9. Operational Notes

- Enable S3 lifecycle rules if versioning is on
- CloudTrail logs STS and S3 access
- Request IDs exposed for debugging
- Costs only incurred for successful AWS API calls

---

## 10. Mental Model

- **User Pool** → authentication
- **Identity Pool** → AWS credentials
- **IAM Role** → permissions
- **S3 CORS** → browser access

Each layer is independent and composable.

---

_End of reference document._

