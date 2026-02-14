
// This script is injected into the browser context to mock the File System Access API.
// It relies on window.__fs_* functions being exposed by Playwright.

class MockFileSystemHandle {
    constructor(kind, name, path) {
        this.kind = kind;
        this.name = name;
        this._path = path;
    }

    async isSameEntry(other) {
        return this._path === other._path && this.kind === other.kind;
    }

    async queryPermission(descriptor) {
        return 'granted';
    }

    async requestPermission(descriptor) {
        return 'granted';
    }

    async move(destination, newName) {
        // destination is a DirectoryHandle (mock)
        // newName is string (optional if destination is file handle? spec is varying, but usage is handle.move(parentDir, newName))
        let newPath;
        if (destination.kind === 'directory') {
            newPath = destination._path + '/' + (newName || this.name);
        } else {
            // If destination is a handle to overwrite? 
            // The API signature used in app is: handle.move(parentDir, finalName)
            // So destination is parentDir
            throw new Error('Destination must be a directory');
        }

        await window.__fs_rename(this._path, newPath);

        // Update this handle? 
        this.name = newName || this.name;
        this._path = newPath;
    }
}

class MockFileSystemFileHandle extends MockFileSystemHandle {
    constructor(name, path) {
        super('file', name, path);
    }

    async getFile() {
        const base64Content = await window.__fs_readFile(this._path);

        // Decode Base64 to Uint8Array
        const binaryString = atob(base64Content);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }

        // We create a simple File object. 
        // Note: Using 'application/octet-stream' or just letting it be inferred/empty is fine.
        const blob = new Blob([bytes], { type: 'application/octet-stream' });
        const file = new File([blob], this.name, { lastModified: Date.now() });
        return file;
    }

    async createWritable() {
        const path = this._path;
        let chunks = [];

        const stream = new WritableStream({
            write(chunk) {
                if (typeof chunk === 'string') {
                    chunks.push(new TextEncoder().encode(chunk));
                } else if (chunk.type) { // Blob-like
                    // We can't await in sync write easily if it's a blob without reading? 
                    // But WritableStream write can return promise.
                    // However, we need to handle Blob specifically.
                    if (chunk instanceof Blob) {
                        return chunk.arrayBuffer().then(buf => chunks.push(new Uint8Array(buf)));
                    }
                    // Fallback for unexpected types
                    chunks.push(new TextEncoder().encode(String(chunk)));
                } else if (chunk.buffer || chunk instanceof ArrayBuffer) {
                    chunks.push(new Uint8Array(chunk.buffer || chunk, chunk.byteOffset, chunk.byteLength));
                } else {
                    chunks.push(new TextEncoder().encode(String(chunk)));
                }
            },
            close() {
                // Concat chunks
                const size = chunks.reduce((acc, c) => acc + c.length, 0);
                const combined = new Uint8Array(size);
                let offset = 0;
                for (const c of chunks) {
                    combined.set(c, offset);
                    offset += c.length;
                }

                // Convert to base64
                let binary = '';
                const len = combined.byteLength;
                for (let i = 0; i < len; i += 32768) {
                    binary += String.fromCharCode.apply(null, combined.subarray(i, Math.min(i + 32768, len)));
                }
                const base64 = btoa(binary);

                return window.__fs_writeFile(path, { type: 'base64', data: base64 });
            }
        });

        // Patch methods required by FileSystemWritableFileStream
        stream.write = async (data) => {
            const writer = stream.getWriter();
            await writer.write(data);
            writer.releaseLock();
        };

        stream.close = async () => {
            const writer = stream.getWriter();
            await writer.close();
        };

        stream.seek = async (position) => { console.warn("seek not implemented in mock"); };
        stream.truncate = async (size) => { console.warn("truncate not implemented in mock"); };

        return stream;
    }
}

class MockFileSystemDirectoryHandle extends MockFileSystemHandle {
    constructor(name, path) {
        super('directory', name, path);
    }

    async *values() {
        const entries = await window.__fs_readDir(this._path);
        for (const entry of entries) {
            // naive path join
            const childPath = this._path + '/' + entry.name;

            if (entry.kind === 'file') {
                yield new MockFileSystemFileHandle(entry.name, childPath);
            } else {
                yield new MockFileSystemDirectoryHandle(entry.name, childPath);
            }
        }
    }

    async getFileHandle(name, options) {
        const childPath = this._path + '/' + name;
        // Verify existence if not create
        try {
            await window.__fs_stat(childPath);
            return new MockFileSystemFileHandle(name, childPath);
        } catch (e) {
            if (options?.create) {
                await window.__fs_writeFile(childPath, '');
                return new MockFileSystemFileHandle(name, childPath);
            }
            throw new Error(`File not found: ${name}`);
        }
    }

    // Minimal impl for getDirectoryHandle
    async getDirectoryHandle(name, options) {
        const childPath = this._path + '/' + name;
        try {
            await window.__fs_stat(childPath);
            return new MockFileSystemDirectoryHandle(name, childPath);
        } catch (e) {
            if (options?.create) {
                await window.__fs_mkdir(childPath);
                return new MockFileSystemDirectoryHandle(name, childPath);
            }
            throw new Error(`Directory not found: ${name}`);
        }
    }

    async removeEntry(name, options) {
        const childPath = this._path + '/' + name;
        // In real FS Access, removeEntry is on DirectoryHandle, taking the name of child to remove.
        await window.__fs_remove(childPath);
    }
}

window.showDirectoryPicker = async () => {
    const dirName = window.__TEST_mockDirPickerDirName;
    if (!dirName) throw new Error("Call setDirectoryPickerChoice first");
    return new MockFileSystemDirectoryHandle(dirName, dirName);
};

window.showOpenFilePicker = async (options) => {
    window.__TEST_mockFilePickerLastCallOptions = options || null;
    const filePath = window.__TEST_mockFilePickerFilePath;
    if (filePath === undefined) throw new Error("Call setFilePickerChoice first");
    if (filePath === null) {
        const error = new Error("Cancelled");
        error.name = 'AbortError';
        throw error;
    }
    // extract file name from filePath
    const parts = filePath.split(/[/\\]/);
    const name = parts[parts.length - 1];
    // Return array as per spec
    return [new MockFileSystemFileHandle(name, filePath)];
};

// Hydration helper for tests
window.__TEST_hydrateHandle = (obj) => {
    if (!obj) return obj;
    if (obj.kind === 'file') {
        return new MockFileSystemFileHandle(obj.name, obj._path);
    }
    if (obj.kind === 'directory') {
        return new MockFileSystemDirectoryHandle(obj.name, obj._path);
    }
    return obj;
};

// console.log('FileSystem Access API Mocked');
