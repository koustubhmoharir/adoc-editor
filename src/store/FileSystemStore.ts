import { observable, action, runInAction, reaction } from "mobx";
import { get, set } from 'idb-keyval';
import { editorStore } from './EditorStore';

export interface FileNode {
    name: string;
    kind: 'file' | 'directory';
    handle: FileSystemFileHandle | FileSystemDirectoryHandle;
    children?: FileNode[];
}

class FileSystemStore {
    @observable accessor directoryHandle: FileSystemDirectoryHandle | null = null;
    @observable accessor fileTree: FileNode[] = [];
    @observable accessor currentFileHandle: FileSystemFileHandle | null = null;
    @observable accessor dirty: boolean = false;
    @observable accessor isLoading: boolean = false;

    saveInterval: number | null = null;

    constructor() {
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

        // Save on close/refresh
        window.addEventListener('beforeunload', () => {
            if (this.dirty && this.currentFileHandle) {
                this.saveFile(); // Attempt to save (best effort)
            }
        });
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
            // Check for skip_restore parameter
            const params = new URLSearchParams(window.location.search);
            if (params.get('skip_restore') === 'true') {
                console.log('Skipping directory restoration due to skip_restore flag');
                return;
            }

            const handle = await get('directoryHandle') as FileSystemDirectoryHandle | undefined;
            if (handle) {
                runInAction(() => {
                    // Test support: Hydrate handle if it's a plain object (mock)
                    const hydrator = (window as any).__hydrateHandle;
                    this.directoryHandle = hydrator ? hydrator(handle) : handle;
                });

                // We cannot query permission immediately often without user gesture if 'prompt' is needed.
                // But we can try querying.
                const perm = await this.directoryHandle!.queryPermission({ mode: 'read' });
                if (perm === 'granted') {
                    await this.refreshTree();
                    await this.restoreLastFile();
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

    async restoreLastFile() {
        try {
            const handle = await get('lastOpenFile') as FileSystemFileHandle | undefined;
            if (handle) {
                // Verify permission for the file (should be inherited from directory usually, or re-verified)
                const hydrator = (window as any).__hydrateHandle;
                const hydratedHandle = hydrator ? hydrator(handle) : handle;

                const perm = await hydratedHandle.queryPermission({ mode: 'read' });

                if (perm === 'granted') {
                    const file = await hydratedHandle.getFile();
                    const content = await file.text();

                    runInAction(() => {
                        this.currentFileHandle = hydratedHandle;
                        this.isLoading = true;
                    });

                    editorStore.setContent(content);

                    runInAction(() => {
                        this.dirty = false;
                        this.isLoading = false;
                    });

                    // Sync with tree if it's already loaded
                    if (this.fileTree.length > 0) {
                        await this.syncSelectedFileWithTree();
                    }
                    this.startAutoSave();
                }
            }
        } catch (error) {
            console.error('Error restoring last file:', error);
        }
    }

    async syncSelectedFileWithTree() {
        if (!this.currentFileHandle) return;

        const findAndReplaceHandle = async (nodes: FileNode[]) => {
            for (const node of nodes) {
                if (node.kind === 'file') {
                    if (await node.handle.isSameEntry(this.currentFileHandle!)) {
                        runInAction(() => {
                            this.currentFileHandle = node.handle as FileSystemFileHandle;
                        });
                        return true;
                    }
                } else if (node.children) {
                    if (await findAndReplaceHandle(node.children)) return true;
                }
            }
            return false;
        };

        await findAndReplaceHandle(this.fileTree);
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
            this.syncSelectedFileWithTree();
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

        // Persist file handle
        await set('lastOpenFile', fileHandle);

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

    async clearSelection() {
        if (this.currentFileHandle && this.dirty) {
            await this.saveFile();
        }

        // Clear persisted handle
        await set('lastOpenFile', null);

        runInAction(() => {
            this.currentFileHandle = null;
            this.dirty = false;
        });

        if (this.saveInterval) {
            clearInterval(this.saveInterval);
            this.saveInterval = null;
        }
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

    findParentDirectory(targetHandle: FileSystemHandle): FileSystemDirectoryHandle | null {
        if (!this.directoryHandle) return null;

        // Check root level
        if (this.fileTree.some(n => n.handle === targetHandle)) {
            return this.directoryHandle;
        }

        // Check recursively
        return this.findParentRecursive(this.fileTree, targetHandle);
    }

    findParentRecursive(nodes: FileNode[], target: FileSystemHandle): FileSystemDirectoryHandle | null {
        for (const node of nodes) {
            if (node.kind === 'directory' && node.children) {
                // Is target a child of this node?
                if (node.children.some(child => child.handle === target)) {
                    return node.handle as FileSystemDirectoryHandle;
                }
                // Recurse
                const found = this.findParentRecursive(node.children, target);
                if (found) return found;
            }
        }
        return null;
    }

    async findSiblingFile(handle: FileSystemFileHandle, siblingName: string): Promise<FileSystemFileHandle | null> {
        const parentHandle = this.findParentDirectory(handle);
        if (!parentHandle) return null;

        try {
            return await parentHandle.getFileHandle(siblingName);
        } catch (e) {
            return null;
        }
    }

    @action
    setDirty(isDirty: boolean) {
        this.dirty = isDirty;
    }
}

export const fileSystemStore = new FileSystemStore();

// Expose for testing/debugging
if (typeof window !== 'undefined' && (window as any).__ENABLE_TEST_GLOBALS__) {
    (window as any).__TEST_fileSystemStore = fileSystemStore;
}
