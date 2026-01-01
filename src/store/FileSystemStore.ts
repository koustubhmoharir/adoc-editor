import { makeAutoObservable, runInAction, reaction } from "mobx";
import { get, set } from 'idb-keyval';
import { editorStore } from './EditorStore';

export interface FileNode {
    name: string;
    kind: 'file' | 'directory';
    handle: FileSystemFileHandle | FileSystemDirectoryHandle;
    children?: FileNode[];
}

class FileSystemStore {
    directoryHandle: FileSystemDirectoryHandle | null = null;
    fileTree: FileNode[] = [];
    currentFileHandle: FileSystemFileHandle | null = null;
    dirty: boolean = false;
    saveInterval: number | null = null;
    isLoading: boolean = false;

    constructor() {
        makeAutoObservable(this);
        this.restoreDirectory();

        // React to editor content changes to set dirty state
        reaction(
            () => editorStore.content,
            () => {
                if (!this.isLoading && this.currentFileHandle) {
                    this.setDirty(true);
                }
            }
        );
    }

    async openDirectory() {
        try {
            const handle = await window.showDirectoryPicker();
            runInAction(() => {
                this.directoryHandle = handle;
            });
            await set('directoryHandle', handle);
            await this.refreshTree();
        } catch (error) {
            console.error('Error opening directory:', error);
        }
    }

    async restoreDirectory() {
        try {
            const handle = await get('directoryHandle') as FileSystemDirectoryHandle | undefined;
            if (handle) {
                runInAction(() => {
                    this.directoryHandle = handle;
                });

                // We cannot query permission immediately often without user gesture if 'prompt' is needed.
                // But we can try querying.
                const perm = await handle.queryPermission({ mode: 'read' });
                if (perm === 'granted') {
                    await this.refreshTree();
                } else {
                    // We maintain the handle but can't list files yet.
                    // The UI should show a button to "Restore Access" or "Reload Directory" which matches a user gesture.
                    // For now, we'll try to refresh, if it fails, we handle it?
                    // actually verifyPermission logic below handles requestPermission which needs gesture.
                    // We'll leave it to the user to click "Open Directory" (which might start fresh) or a generic "Refresh" 
                    // mechanism. However, let's try to prompt if possible? No, browsers block prompt on load.
                    // We'll trust that the user clicks something.
                }
            }
        } catch (error) {
            console.error('Error restoring directory:', error);
        }
    }

    async verifyPermission(handle: FileSystemDirectoryHandle, readWrite: boolean = false) {
        const options: FileSystemHandlePermissionDescriptor = {
            mode: readWrite ? 'readwrite' : 'read',
        };
        if ((await handle.queryPermission(options)) === 'granted') {
            return true;
        }
        if ((await handle.requestPermission(options)) === 'granted') {
            return true;
        }
        return false;
    }

    async refreshTree() {
        if (!this.directoryHandle) return;

        // This might trigger a prompt if not granted, so it should ideally be called from a user action 
        // if permission is not 'granted'.
        const hasPerm = await this.verifyPermission(this.directoryHandle);
        if (!hasPerm) return;

        const tree = await this.readDirectory(this.directoryHandle);
        runInAction(() => {
            this.fileTree = tree;
        });
    }

    async readDirectory(dirHandle: FileSystemDirectoryHandle): Promise<FileNode[]> {
        const entries: FileNode[] = [];
        for await (const entry of dirHandle.values()) {
            if (entry.name.startsWith('.')) continue; // Skip hidden files/dotfiles

            if (entry.kind === 'file') {
                if (entry.name.endsWith('.adoc')) {
                    entries.push({
                        name: entry.name,
                        kind: 'file',
                        handle: entry
                    });
                }
            } else if (entry.kind === 'directory') {
                entries.push({
                    name: entry.name,
                    kind: 'directory',
                    handle: entry,
                    children: await this.readDirectory(entry)
                });
            }
        }
        return entries.sort((a, b) => {
            if (a.kind === b.kind) return a.name.localeCompare(b.name);
            return a.kind === 'directory' ? -1 : 1;
        });
    }

    async selectFile(node: FileNode) {
        if (node.kind !== 'file') return;

        // Auto-save previous file if dirty
        if (this.currentFileHandle && this.dirty) {
            await this.saveFile();
        }

        const fileHandle = node.handle as FileSystemFileHandle;

        // For reading, we might need permission too? usually strictly nested files inherit permission.

        const file = await fileHandle.getFile();
        const content = await file.text();

        runInAction(() => {
            this.isLoading = true;
            this.currentFileHandle = fileHandle;
        });

        editorStore.setContent(content);

        runInAction(() => {
            this.dirty = false;
            this.isLoading = false;
        });

        this.startAutoSave();
    }

    async saveFile() {
        if (!this.currentFileHandle) return;

        try {
            const writable = await this.currentFileHandle.createWritable();
            await writable.write(editorStore.content);
            await writable.close();
            runInAction(() => {
                this.dirty = false;
            });
            console.log('Saved file:', this.currentFileHandle.name);
        } catch (err) {
            console.error('Failed to save file:', err);
        }
    }

    startAutoSave() {
        if (this.saveInterval) {
            clearInterval(this.saveInterval);
        }
        this.saveInterval = window.setInterval(async () => {
            if (this.dirty) {
                await this.saveFile();
            }
        }, 5000); // 5 seconds
    }

    setDirty(isDirty: boolean) {
        this.dirty = isDirty;
    }
}

export const fileSystemStore = new FileSystemStore();
