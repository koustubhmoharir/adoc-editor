
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
        let contentBuffer = '';

        return {
            write: async (data) => {
                if (typeof data === 'string') {
                    contentBuffer += data;
                } else if (data instanceof Blob) {
                    contentBuffer += await data.text();
                } else {
                    // BufferSource (ArrayBuffer or ArrayBufferView)
                    // Simplified: assume text
                    const dec = new TextDecoder();
                    contentBuffer += dec.decode(data);
                }
            },
            close: async () => {
                await window.__fs_writeFile(path, contentBuffer);
            },
            abort: async () => { },
            seek: async () => { },
            truncate: async () => { },
        };
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
