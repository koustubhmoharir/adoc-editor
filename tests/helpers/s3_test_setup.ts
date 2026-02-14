
import { Page } from '@playwright/test';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { MockS3Client, AddVersionOptions } from './mock_s3_client';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class S3TestSetup {
    private mockClient: MockS3Client;

    constructor() {
        this.mockClient = new MockS3Client();
    }

    cleanup() {
        // MockS3Client doesn't hold external resources, but let's reset it
        this.mockClient = new MockS3Client();
    }

    /**
     * Seeds the mock S3 client with initial data.
     */
    seed(versions: { key: string, content: string | Buffer, options?: AddVersionOptions }[]) {
        for (const v of versions) {
            if (typeof v.content === 'string') {
                this.mockClient.addTextVersion(v.key, v.content, v.options);
            } else {
                this.mockClient.addBinaryVersion(v.key, v.content, v.options);
            }
        }
    }

    /**
     * Proxies to MockS3Client.addTextVersion
     */
    addTextVersion(key: string, content: string, options?: AddVersionOptions): string {
        return this.mockClient.addTextVersion(key, content, options);
    }

    /**
     * Proxies to MockS3Client.addBinaryVersion
     */
    addBinaryVersion(key: string, content: Buffer, options?: AddVersionOptions): string {
        return this.mockClient.addBinaryVersion(key, content, options);
    }

    getCalls() {
        return this.mockClient.calls;
    }

    async register(page: Page) {
        // Expose function to receive commands from browser
        await page.exposeFunction('__TEST_S3_send', async (commandName: string, input: any) => {
            // Reconstruct command object loosely
            const command = {
                constructor: { name: commandName },
                schema: [, , commandName.replace('Command', '')], // loose mock of Smithy structure [,, 'Name']
                input: input
            };

            // Fix input body if it was sent as string/buffer from browser
            if (input.Body && typeof input.Body === 'object' && input.Body.type === 'Buffer') {
                input.Body = Buffer.from(input.Body.data);
            }

            try {
                const result = await this.mockClient.send(command);

                // Serialize result for transport back to browser
                // Buffers/Streams need to be converted
                if (Buffer.isBuffer(result.Body)) {
                    result.Body = {
                        type: 'Buffer',
                        data: result.Body.toString('base64')
                    };
                }
                // We'll handle serialization in the mock or here.
                // For now, assuming JSON-serializable structure except Body.

                return result;
            } catch (err: any) {
                // transport error
                return {
                    __isError: true,
                    name: err.name,
                    message: err.message,
                    $metadata: err.$metadata
                };
            }
        });

        // Expose function to reset/seed from browser if needed (mostly done via fixtures though)

        // Inject the mock shim
        await page.addInitScript({ path: path.join(__dirname, 's3_mock.js') });
    }
}
