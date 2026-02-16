

/**
 * Returns the parent directory path of the input path.
 * If the parent is the root an empty string is returned.
 * If not, the result has a trailing slash.
 * This behavior enables concatenation of a file name to the result without a slash.
 * An exception is thrown if the input path is already a root.
 * @param path A file or directory path. Trailing slashes are ignored.
 * @returns Parent directory path (empty string for root or with a trailing slash for non-root)
 */
export function parentDirOfPath(path: string): string {
    path = path.replace(/\/+$/, ''); //remove trailing slashes
    if (path === '') {
        throw new Error(`Already a root path. path:  ${path}`);
    }
    const lastSlash = path.lastIndexOf('/');
    if (lastSlash >= 0) {
        return path.substring(0, lastSlash + 1);
    }
    else {
        return '';
    }
}

/**
 * Returns the last segment of the input path
 * @param path A file or directory path. Trailing slashes are ignored.
 * @returns 
 */
export function nameOfPath(path: string, allowEmpty = false): string {
    path = path.replace(/\/+$/, ''); //remove trailing slashes
    const lastSlash = path.lastIndexOf('/');
    const name = lastSlash >= 0 ? path.substring(lastSlash + 1) : path;
    if (!allowEmpty && !name) {
        throw new Error('Expected a non-empty name');
    }
    return name;
}

export async function isBinaryFile(file: File): Promise<boolean> {
    const slice = file.slice(0, Math.min(file.size, 1024));
    const buffer = await slice.arrayBuffer();
    const view = new Uint8Array(buffer);

    for (let i = 0; i < view.length; i++) {
        if (view[i] === 0) {
            return true;
        }
    }
    return false;
}


export async function createDirectoryAtPath(rootHandle: FileSystemDirectoryHandle, path: string): Promise<FileSystemDirectoryHandle> {
    return (await _getDirectoryHandle(rootHandle, path, { create: true }))!;
}

export async function getDirectoryAtPath(rootHandle: FileSystemDirectoryHandle, path: string): Promise<FileSystemDirectoryHandle> {
    return (await _getDirectoryHandle(rootHandle, path, { optional: false }))!;
}

export async function tryGetDirectoryAtPath(rootHandle: FileSystemDirectoryHandle, path: string): Promise<FileSystemDirectoryHandle | null> {
    return await _getDirectoryHandle(rootHandle, path, { optional: true });
}

async function _getDirectoryHandle(dir: FileSystemDirectoryHandle, path: string, options?: { create?: boolean; optional?: boolean }) {
    if (!path || path === '/') return dir;
    let curPath = '';
    const parts = path.split('/').filter(Boolean);
    const createOptions = { create: options?.create ?? false };
    const optional = options?.optional ?? false;
    for (const name of parts) {
        try {
            dir = await dir.getDirectoryHandle(name, createOptions);
            curPath += `${name}/`;
        }
        catch (e) {
            if (createOptions.create || !optional) {
                throw Error(`Could not create directory ${name} at ${curPath}`, { cause: e });
            }
            return null;
        }
    }
    return dir;
}

export async function createFileAtPath(rootHandle: FileSystemDirectoryHandle, path: string): Promise<FileSystemFileHandle> {
    return (await _getFileHandle(rootHandle, path, { create: true }))!;
}

export async function getFileAtPath(rootHandle: FileSystemDirectoryHandle, path: string): Promise<FileSystemFileHandle> {
    return (await _getFileHandle(rootHandle, path, { optional: false }))!;
}

export async function tryGetFileAtPath(rootHandle: FileSystemDirectoryHandle, path: string): Promise<FileSystemFileHandle | null> {
    return await _getFileHandle(rootHandle, path, { optional: true });
}

async function _getFileHandle(rootHandle: FileSystemDirectoryHandle, path: string, options?: { create?: boolean; optional?: boolean }): Promise<FileSystemFileHandle | null> {
    let curPath = ''
    const parts = path.split('/').filter(Boolean);
    let currentDir = rootHandle;
    const createOptions = { create: options?.create ?? false };
    const optional = options?.optional ?? false;
    for (let i = 0; i < parts.length - 1; i++) {
        const name = parts[i];
        try {
            currentDir = await currentDir.getDirectoryHandle(name, createOptions);
            curPath += `${name}/`;
        } catch (e) {
            if (createOptions.create || !optional) {
                throw Error(`Could not create directory ${name} at ${curPath}`, { cause: e });
            }
            return null;
        }
    }

    try {
        return await currentDir.getFileHandle(parts[parts.length - 1], createOptions);
    } catch (e) {
        if (createOptions.create || !optional) {
            throw Error(`Could not create file at ${path}`, { cause: e });
        }
        return null;
    }
}