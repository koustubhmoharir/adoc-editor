
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
}

class MockFileSystemFileHandle extends MockFileSystemHandle {
    constructor(name, path) {
        super('file', name, path);
    }

    async getFile() {
        const content = await window.__fs_readFile(this._path);
        // We create a simpler File object since we primarily need .text()
        const blob = new Blob([content], { type: 'text/PLAIN' });
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
        return new MockFileSystemDirectoryHandle(name, childPath);
    }
}

// Override global
window.showDirectoryPicker = async () => {
    // Return a handle to the root of the "mounted" directory
    return new MockFileSystemDirectoryHandle('root', '.');
};

// Hydration helper for tests
window.__hydrateHandle = (obj) => {
    if (!obj) return obj;
    if (obj.kind === 'file') {
        return new MockFileSystemFileHandle(obj.name, obj._path);
    }
    if (obj.kind === 'directory') {
        return new MockFileSystemDirectoryHandle(obj.name, obj._path);
    }
    return obj;
};

console.log('FileSystem Access API Mocked');
