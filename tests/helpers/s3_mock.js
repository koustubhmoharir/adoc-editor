
// This script is injected into the browser context

window.__TEST_mockS3Client = {
    send: async function (command) {
        // Extract command name
        // Smithy clients usually have constructor.name as 'ListObjectVersionsCommand' etc.
        // But minification might mangle it.
        // However, in our tests we are running in non-minified env or using the property hack.
        // Let's look at how fixtures.ts did it.
        // It used `command.schema?.[2]` or constructor name.

        let name = command.constructor.name;
        if (command.schema && command.schema[2]) {
            name = command.schema[2] + 'Command';
        }

        const input = command.input;

        // Serialize Blob/File/Buffer in input if necessary
        // Simple serialization for now

        const result = await window.__TEST_S3_send(name, input);

        if (result && result.__isError) {
            const err = new Error(result.message);
            err.name = result.name;
            err.$metadata = result.$metadata;
            throw err;
        }

        // Deserialize Body if present (e.g. for GetObject)
        if (result && result.Body) {
            if (result.Body.type === 'Buffer' && typeof result.Body.data === 'string') {
                const binStr = atob(result.Body.data);
                const len = binStr.length;
                const bytes = new Uint8Array(len);
                for (let i = 0; i < len; i++) {
                    bytes[i] = binStr.charCodeAt(i);
                }

                // Mock the S3 SDK Body behavior (it has transformToWebStream, transformToString, etc.)
                // But S3Store only uses transformToWebStream.
                result.Body = {
                    transformToWebStream: () => {
                        return new ReadableStream({
                            start(controller) {
                                controller.enqueue(bytes);
                                controller.close();
                            }
                        });
                    },
                    transformToString: async () => binStr,
                    transformToByteArray: async () => bytes,
                };
            }
        }

        return result;
    }
};
