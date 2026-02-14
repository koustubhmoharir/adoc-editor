
import { createHash } from 'crypto';
import { traceLog } from '../../src/utils/trace';

/**
 * Stored object version in the mock S3 bucket.
 */
interface StoredVersion {
    key: string;
    versionId: string;
    isLatest: boolean;
    lastModified: Date;
    etag: string;
    size: number;
    content: Buffer;
    metadata: Record<string, string>;
    checksumSHA256?: string;
}

/**
 * Options when adding a version to MockS3Client.
 */
export interface AddVersionOptions {
    /** UUID to store in metadata */
    uuid?: string;
    /** Sync version to store in metadata */
    syncVersion?: number;
    /** Device name to store in metadata */
    deviceName?: string;
    /** Override version ID (auto-generated if omitted) */
    versionId?: string;
    /** Override ETag (computed from content if omitted) */
    etag?: string;
    /** Override last modified date */
    lastModified?: Date;
    /** Whether this is the latest version (default: true, automatically sets previous latest to false) */
    isLatest?: boolean;
}

function computeEtag(content: Buffer): string {
    return createHash('md5').update(content).digest('hex');
}

function computeSha256Base64(content: Buffer): string {
    const digest = createHash('sha256').update(content).digest();
    return digest.toString('base64');
}

function identifyCommand(command: any): string {
    const schemaName = command.schema?.[2] ?? '';
    return `${schemaName}Command`;
}

/**
 * Mock S3 client for testing. Implements the `send()` method to handle
 * all S3 commands used by S3SyncLogic:
 * - ListObjectVersionsCommand
 * - HeadObjectCommand
 * - PutObjectCommand
 * - DeleteObjectCommand
 * - CopyObjectCommand
 */
export class MockS3Client {
    private versions: StoredVersion[] = [];
    private nextVersionCounter = 1;
    public calls: Array<{ command: string; input: any }> = [];

    private generateVersionId(): string {
        return `mock-version-${this.nextVersionCounter++}`;
    }

    /**
     * Add an object version with text content.
     */
    addTextVersion(key: string, content: string, options?: AddVersionOptions): string {
        return this.addBinaryVersion(key, Buffer.from(content, 'utf-8'), options);
    }

    /**
     * Add an object version with binary content.
     */
    addBinaryVersion(key: string, content: Buffer, options?: AddVersionOptions): string {
        const versionId = options?.versionId ?? this.generateVersionId();
        const etag = options?.etag ?? computeEtag(content);
        const sha256 = computeSha256Base64(content);

        const metadata: Record<string, string> = {};
        if (options?.uuid !== undefined) metadata['uuid'] = options.uuid;
        if (options?.syncVersion !== undefined) metadata['syncversion'] = options.syncVersion.toString();
        if (options?.deviceName !== undefined) metadata['devicename'] = options.deviceName;

        const isLatest = options?.isLatest ?? true;
        if (isLatest) {
            // Mark previous versions of the same key as not latest
            for (const v of this.versions) {
                if (v.key === key) {
                    v.isLatest = false;
                }
            }
        }

        this.versions.push({
            key,
            versionId,
            isLatest,
            lastModified: options?.lastModified ?? new Date(),
            etag,
            size: content.length,
            content,
            metadata,
            checksumSHA256: sha256,
        });

        return versionId;
    }

    /**
     * Get all stored versions for inspection in tests.
     */
    getVersions(): ReadonlyArray<Readonly<StoredVersion>> {
        return this.versions;
    }

    /**
     * Get latest version of a key, or undefined if not found.
     */
    getLatestVersion(key: string): Readonly<StoredVersion> | undefined {
        return this.versions.find(v => v.key === key && v.isLatest);
    }

    /**
     * Main dispatch: handles all S3 commands by constructor name.
     */
    send(command: any): Promise<any> {
        const name = identifyCommand(command);
        this.calls.push({ command: name, input: command.input });
        switch (name) {
            case 'GetObjectCommand':
                return this.handleGetObject(command.input);
            case 'ListObjectVersionsCommand':
                return this.handleListObjectVersions(command.input);
            case 'HeadObjectCommand':
                return this.handleHeadObject(command.input);
            case 'PutObjectCommand':
                return this.handlePutObject(command.input);
            case 'DeleteObjectCommand':
                return this.handleDeleteObject(command.input);
            case 'CopyObjectCommand':
                return this.handleCopyObject(command.input);
            default:
                return Promise.reject(new Error(`MockS3Client: Unknown command: ${name}`));
        }
    }

    private handleGetObject(input: any): Promise<any> {
        const key = input.Key!;
        const versionId = input.VersionId;

        let version: StoredVersion | undefined;
        if (versionId) {
            version = this.versions.find(v => v.key === key && v.versionId === versionId);
        } else {
            version = this.versions.find(v => v.key === key && v.isLatest);
        }

        if (!version) {
            const error: any = new Error(`NoSuchKey: ${key}`);
            error.$metadata = { httpStatusCode: 404 };
            return Promise.reject(error);
        }

        return Promise.resolve({
            VersionId: version.versionId,
            Metadata: { ...version.metadata },
            ChecksumSHA256: version.checksumSHA256,
            ContentLength: version.size,
            ETag: `"${version.etag}"`,
            LastModified: version.lastModified,
            Body: version.content, // Buffer
        });
    }

    private handleListObjectVersions(input: any): Promise<any> {
        const prefix = input.Prefix || '';
        const keyMarker = input.KeyMarker;

        let filtered = this.versions.filter(v => v.key.startsWith(prefix));
        if (keyMarker) {
            const idx = filtered.findIndex(v => v.key > keyMarker);
            filtered = idx >= 0 ? filtered.slice(idx) : [];
        }

        return Promise.resolve({
            Versions: filtered.map(v => ({
                Key: v.key,
                VersionId: v.versionId,
                IsLatest: v.isLatest,
                LastModified: v.lastModified,
                ETag: `"${v.etag}"`,
                Size: v.size,
            })),
            NextKeyMarker: undefined,
            NextVersionIdMarker: undefined,
        });
    }

    private handleHeadObject(input: any): Promise<any> {
        const key = input.Key!;
        const versionId = input.VersionId;

        let version: StoredVersion | undefined;
        if (versionId) {
            version = this.versions.find(v => v.key === key && v.versionId === versionId);
        } else {
            version = this.versions.find(v => v.key === key && v.isLatest);
        }

        if (!version) {
            const error: any = new Error(`NoSuchKey: ${key}`);
            error.$metadata = { httpStatusCode: 404 };
            return Promise.reject(error);
        }

        return Promise.resolve({
            VersionId: version.versionId,
            Metadata: { ...version.metadata },
            ChecksumSHA256: version.checksumSHA256,
            ContentLength: version.size,
            ETag: `"${version.etag}"`,
            LastModified: version.lastModified,
        });
    }

    private async handlePutObject(input: any): Promise<any> {
        const key = input.Key!;
        const body = input.Body;

        let content: Buffer;
        if (body instanceof Buffer) {
            content = body;
        } else if (typeof body === 'string') {
            content = Buffer.from(body, 'utf-8');
        } else if (body && typeof body.arrayBuffer === 'function') {
            // File or Blob
            const ab = await body.arrayBuffer();
            content = Buffer.from(ab);
        } else if (body instanceof Uint8Array) {
            content = Buffer.from(body);
        } else {
            content = Buffer.from('');
        }

        // Check conditional writes
        if (input.IfNoneMatch === '*') {
            const existing = this.versions.find(v => v.key === key && v.isLatest);
            if (existing) {
                const error: any = new Error('PreconditionFailed');
                error.$metadata = { httpStatusCode: 412 };
                return Promise.reject(error);
            }
        }
        if (input.IfMatch) {
            const expectedEtag = input.IfMatch.replace(/"/g, '');
            const existing = this.versions.find(v => v.key === key && v.isLatest);
            if (!existing || existing.etag !== expectedEtag) {
                const error: any = new Error('PreconditionFailed');
                error.$metadata = { httpStatusCode: 412 };
                return Promise.reject(error);
            }
        }

        const etag = computeEtag(content);
        const sha256 = computeSha256Base64(content);
        const versionId = this.generateVersionId();

        // Mark previous versions as not latest
        for (const v of this.versions) {
            if (v.key === key) {
                v.isLatest = false;
            }
        }

        const metadata: Record<string, string> = { ...(input.Metadata || {}) };

        this.versions.push({
            key,
            versionId,
            isLatest: true,
            lastModified: new Date(),
            etag,
            size: content.length,
            content,
            metadata,
            checksumSHA256: sha256,
        });

        traceLog(`MockS3Client: PutObject ${key} -> ${versionId}`);

        return {
            VersionId: versionId,
            ETag: `"${etag}"`,
            ChecksumSHA256: sha256,
        };
    }

    private handleDeleteObject(input: any): Promise<any> {
        const key = input.Key!;

        // Check conditional writes
        if (input.IfMatch) {
            const expectedEtag = input.IfMatch.replace(/"/g, '');
            const existing = this.versions.find(v => v.key === key && v.isLatest);
            if (!existing || existing.etag !== expectedEtag) {
                const error: any = new Error('PreconditionFailed');
                error.$metadata = { httpStatusCode: 412 };
                return Promise.reject(error);
            }
        }

        // Add a delete marker (mark all versions as not latest)
        for (const v of this.versions) {
            if (v.key === key) {
                v.isLatest = false;
            }
        }

        traceLog(`MockS3Client: DeleteObject ${key}`);

        return Promise.resolve({
            DeleteMarker: true,
            VersionId: this.generateVersionId(),
        });
    }

    private handleCopyObject(input: any): Promise<any> {
        const targetKey = input.Key!;
        const copySource = input.CopySource!;

        // Parse CopySource: "bucket/key?versionId=xxx"
        const [bucketAndKey, queryString] = copySource.split('?');
        const sourceKey = decodeURIComponent(bucketAndKey.substring(bucketAndKey.indexOf('/') + 1));
        const sourceVersionId = queryString?.match(/versionId=([^&]+)/)?.[1];

        let sourceVersion: StoredVersion | undefined;
        if (sourceVersionId) {
            sourceVersion = this.versions.find(v => v.key === sourceKey && v.versionId === sourceVersionId);
        } else {
            sourceVersion = this.versions.find(v => v.key === sourceKey && v.isLatest);
        }

        if (!sourceVersion) {
            const error: any = new Error(`NoSuchKey: ${sourceKey}`);
            error.$metadata = { httpStatusCode: 404 };
            return Promise.reject(error);
        }

        // Check conditional writes
        if (input.IfNoneMatch === '*') {
            const existing = this.versions.find(v => v.key === targetKey && v.isLatest);
            if (existing) {
                const error: any = new Error('PreconditionFailed');
                error.$metadata = { httpStatusCode: 412 };
                return Promise.reject(error);
            }
        }
        if (input.IfMatch) {
            const expectedEtag = input.IfMatch.replace(/"/g, '');
            const existing = this.versions.find(v => v.key === targetKey && v.isLatest);
            if (!existing || existing.etag !== expectedEtag) {
                const error: any = new Error('PreconditionFailed');
                error.$metadata = { httpStatusCode: 412 };
                return Promise.reject(error);
            }
        }

        const versionId = this.generateVersionId();
        const metadata = input.MetadataDirective === 'REPLACE'
            ? { ...(input.Metadata || {}) }
            : { ...sourceVersion.metadata };

        // Mark previous versions at target key as not latest
        for (const v of this.versions) {
            if (v.key === targetKey) {
                v.isLatest = false;
            }
        }

        this.versions.push({
            key: targetKey,
            versionId,
            isLatest: true,
            lastModified: new Date(),
            etag: sourceVersion.etag,
            size: sourceVersion.size,
            content: Buffer.from(sourceVersion.content),
            metadata,
            checksumSHA256: sourceVersion.checksumSHA256,
        });

        traceLog(`MockS3Client: CopyObject ${sourceKey} -> ${targetKey} (${versionId})`);

        return Promise.resolve({
            VersionId: versionId,
            CopyObjectResult: {
                ETag: `"${sourceVersion.etag}"`,
                LastModified: new Date(),
            },
        });
    }
}
