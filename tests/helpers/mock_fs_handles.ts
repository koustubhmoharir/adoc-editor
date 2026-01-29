type IsMatch<K1 extends 'file' | 'directory', K2 extends 'file' | 'directory'> = K1 extends K2 ? K2 extends K1 ? true : false : false;

export class MockFileSystemHandle<K extends 'file' | 'directory'> implements FileSystemHandle {
    constructor(kind: K, name: string) { 
        this.kind = kind;
        this.name = name;
    }
    readonly kind: K;
    readonly name: string;

    get isFile(): IsMatch<K, 'file'> { return (this.kind === 'file') as any; }
    get isDirectory(): IsMatch<K, 'directory'> { return (this.kind === 'directory') as any; }

    async isSameEntry(other: FileSystemHandle): Promise<boolean> {
        return this === other;
    }

    async queryPermission(_descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState> {
        return 'granted';
    }

    async requestPermission(_descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState> {
        return 'granted';
    }
}

export class MockFileSystemFileHandle extends MockFileSystemHandle<'file'> implements FileSystemFileHandle {

    constructor(name: string, content: string = '', lastModified: number = Date.now()) {
        super('file', name);
        this.content = content;
        this.lastModified = lastModified;
    }
    private content: string;
    private lastModified: number;

    async getFile(): Promise<File> {
        const content = this.content;
        return {
            name: this.name,
            lastModified: this.lastModified,
            size: content.length,
            type: 'text/plain',
            slice: (start: number, end: number) => new Blob([content.slice(start, end)]), // This might still fail if Blob missing
            text: async () => content,
            arrayBuffer: async () => new TextEncoder().encode(content).buffer,
            stream: () => {
                const encoder = new TextEncoder();
                const view = encoder.encode(content);
                return new ReadableStream({
                    start(controller) {
                        controller.enqueue(view);
                        controller.close();
                    }
                });
            }
        } as unknown as File;
    }

    async createWritable(_options?: FileSystemCreateWritableOptions): Promise<FileSystemWritableFileStream> {
        const self = this;
        return {
            async write(data: any) {
                if (typeof data === 'string') {
                    self.content = data;
                } else if (data instanceof Blob) {
                    self.content = await data.text();
                } else if (data instanceof Uint8Array || data instanceof ArrayBuffer) {
                    self.content = new TextDecoder().decode(data);
                } else {
                    // Assume it's the value from stream reader
                    self.content += new TextDecoder().decode(data);
                }
            },
            async close() { },
            async seek(_position: number) { },
            async truncate(size: number) {
                self.content = self.content.substring(0, size);
            },
            locked: false,
            getWriter(): WritableStreamDefaultWriter { throw new Error('NotImplemented'); },
            async abort() { }
        };
    }
}

export class MockFileSystemDirectoryHandle extends MockFileSystemHandle<'directory'> implements FileSystemDirectoryHandle {
    private _entries = new Map<string, MockFileSystemHandle<'file' | 'directory'>>();

    constructor(name: string) {
        super('directory', name);
    }

    getFile(): Promise<FileSystemFileHandle> { throw new Error('Deprecated'); }
    getDirectory(): Promise<FileSystemDirectoryHandle> { throw new Error('Deprecated'); }
    getEntries(): AsyncIterableIterator<FileSystemFileHandle | FileSystemDirectoryHandle> { throw new Error('Deprecated'); }

    // Helper for tests to access entries synchronously
    getEntry(name: string) {
        return this._entries.get(name);
    }

    async getDirectoryHandle(name: string, options?: FileSystemGetDirectoryOptions): Promise<FileSystemDirectoryHandle> {
        let entry = this._entries.get(name);
        if (!entry) {
            if (options?.create) {
                entry = new MockFileSystemDirectoryHandle(name);
                this._entries.set(name, entry);
            } else {
                throw new Error(`Directory not found: ${name}`);
            }
        }
        if (entry.kind !== 'directory') {
            throw new Error(`Type mismatch: ${name} is not a directory`);
        }
        return entry as FileSystemDirectoryHandle;
    }

    async getFileHandle(name: string, options?: FileSystemGetFileOptions): Promise<FileSystemFileHandle> {
        let entry = this._entries.get(name);
        if (!entry) {
            if (options?.create) {
                entry = new MockFileSystemFileHandle(name);
                this._entries.set(name, entry);
            } else {
                throw new Error(`File not found: ${name}`);
            }
        }
        if (entry.kind !== 'file') {
            throw new Error(`Type mismatch: ${name} is not a file`);
        }
        return entry as FileSystemFileHandle;
    }

    async removeEntry(name: string, _options?: FileSystemRemoveOptions): Promise<void> {
        if (!this._entries.has(name)) {
            throw new Error(`Entry not found: ${name}`);
        }
        this._entries.delete(name);
    }

    async resolve(_possibleDescendant: FileSystemHandle): Promise<string[] | null> {
        return null; // Not implemented for now
    }

    // Async Iterable iterator for values (handles)
    async *values(): AsyncIterableIterator<FileSystemDirectoryHandle | FileSystemFileHandle> {
        for (const entry of this._entries.values()) {
            yield entry as FileSystemDirectoryHandle | FileSystemFileHandle;
        }
    }

    async *keys(): AsyncIterableIterator<string> {
        for (const key of this._entries.keys()) {
            yield key;
        }
    }

    async *entries(): AsyncIterableIterator<[string, FileSystemDirectoryHandle | FileSystemFileHandle]> {
        for (const [key, value] of this._entries.entries()) {
            yield [key, value as FileSystemDirectoryHandle | FileSystemFileHandle];
        }
    }

    [Symbol.asyncIterator](): AsyncIterableIterator<[string, FileSystemDirectoryHandle | FileSystemFileHandle]> {
        return this.entries();
    }

    // Helper to add mock content easily
    addFile(name: string, content: string, lastModified?: number) {
        const file = new MockFileSystemFileHandle(name, content, lastModified);
        this._entries.set(name, file);
        return file;
    }

    addDirectory(name: string) {
        const dir = new MockFileSystemDirectoryHandle(name);
        this._entries.set(name, dir);
        return dir;
    }
}
