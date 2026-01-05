import { observable, action, runInAction, reaction, computed } from "mobx";
import { get, set } from 'idb-keyval';
import { Fzf } from 'fzf';
import { editorStore } from './EditorStore';
import { createRef } from "react";
import { EffectAwareModel } from "./EffectAwareModel";

export interface FileNodeData {
    name: string;
    path: string;
    kind: 'file' | 'directory';
    handle: FileSystemFileHandle | FileSystemDirectoryHandle;
    children?: FileNodeData[];
}

export class FileNodeModel extends EffectAwareModel {
    @observable accessor name: string;
    readonly path: string;
    readonly kind: 'file' | 'directory';
    readonly handle: FileSystemFileHandle | FileSystemDirectoryHandle;
    @observable accessor children: FileNodeModel[] | undefined;

    // UI State
    @observable accessor isRenaming: boolean = false;
    @observable accessor renameValue: string = '';

    // Refs
    readonly renameInputRef = createRef<HTMLInputElement>();
    readonly treeItemRef = createRef<HTMLDivElement>();



    constructor(data: FileNodeData) {
        super();
        this.name = data.name;
        this.path = data.path;
        this.kind = data.kind;
        this.handle = data.handle;
        if (data.children) {
            this.children = data.children.map(child => new FileNodeModel(child));
        }
    }

    @action
    startRenaming() {
        this.isRenaming = true;
        this.renameValue = this.name;

        // Schedule focus effect
        this.scheduleEffect(() => {
            if (this.renameInputRef.current) {
                this.renameInputRef.current.focus();
                // Select name part excluding extension
                const dotIndex = this.renameValue.lastIndexOf('.');
                if (dotIndex > 0) {
                    this.renameInputRef.current.setSelectionRange(0, dotIndex);
                } else {
                    this.renameInputRef.current.select();
                }
            }
        });
    }


    @action
    cancelRenaming(restoreFocus: boolean = true) {
        this.isRenaming = false;
        this.renameValue = '';
        if (restoreFocus) {
            this.scheduleEffect(() => {
                this.treeItemRef.current?.focus();
            });
        }
    }

    @action
    setRenameValue(val: string) {
        this.renameValue = val;
    }

    @action
    async commitRenaming(revertOnFailure: boolean = false, restoreFocus: boolean = true) {
        if (!this.renameValue || this.renameValue === this.name) {
            this.cancelRenaming(restoreFocus);
            return;
        }
        const success = await fileSystemStore.renameFile(this, this.renameValue, restoreFocus);
        // If rename is successful, the store refreshes the tree, so this model instance might be discarded.
        if (!success && revertOnFailure) {
            this.cancelRenaming(restoreFocus);
        }
    }

    @action
    async delete() {
        if (confirm(`Are you sure you want to delete '${this.name}'?`)) {
            await fileSystemStore.deleteFile(this);
        }
    }

    @action
    handleRenameInputKeyDown(e: React.KeyboardEvent | KeyboardEvent) {
        if (e.key === 'Enter') {
            e.stopPropagation();
            this.commitRenaming(false, true);
        } else if (e.key === 'Escape') {
            e.stopPropagation();
            this.cancelRenaming(true);
        }
    }

    @action
    handleRenameInputBlur() {
        // If the window loses focus (e.g. alt-tab), we want to KEEP renaming state.
        // If the click is inside the app but outside input, we want to COMMIT.
        // We do NOT want to restore focus to the tree item, because the user likely clicked something else.
        if (document.hasFocus()) {
            this.commitRenaming(true, false);
        }
    }

    @action
    handleTreeItemKeyDown(e: React.KeyboardEvent | KeyboardEvent) {
        if (this.isRenaming) return;

        if (e.key === 'F2') {
            e.preventDefault();
            e.stopPropagation();
            this.startRenaming();
        } else if (e.key === 'Delete') {
            e.preventDefault();
            e.stopPropagation();
            this.delete();
        }
    }
}

export class SearchResultItemModel {
    @observable accessor isHighlighted: boolean = false;
    readonly ref = createRef<HTMLDivElement>();
    constructor(public readonly item: FileNodeModel) { }

    @action
    setHighlight(val: boolean) {
        this.isHighlighted = val;
    }
}

class FileSystemStore extends EffectAwareModel {
    @observable accessor directoryHandle: FileSystemDirectoryHandle | null = null;
    @observable accessor fileTree: FileNodeModel[] = [];
    @observable accessor currentFileHandle: FileSystemFileHandle | null = null;
    @observable accessor dirty: boolean = false;
    @observable accessor isLoading: boolean = false;
    @observable accessor collapsedPaths: Set<string> = new Set();
    @observable accessor searchQuery: string = '';
    @observable accessor isSearchVisible: boolean = false;

    // Internal state for focus management
    pendingFocusPath: string | null = null;


    get allFiles(): FileNodeModel[] {
        const result: FileNodeModel[] = [];
        const traverse = (nodes: FileNodeModel[]) => {
            for (const node of nodes) {
                if (node.kind === 'file') {
                    result.push(node);
                } else if (node.children) {
                    traverse(node.children);
                }
            }
        };
        traverse(this.fileTree);
        return result;
    }

    @computed
    get searchResults() {
        if (!this.searchQuery) return [];
        const files = this.allFiles;
        const fzf = new Fzf(files, { selector: (item) => item.path });
        const matches = fzf.find(this.searchQuery);
        return matches.map(match => new SearchResultItemModel(match.item));
    }

    saveInterval: number | null = null;

    constructor() {
        super();
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


    @action
    setDirty(val: boolean) {
        this.dirty = val;
    }

    async openDirectory() {
        try {
            const handle = await window.showDirectoryPicker();
            runInAction(() => {
                this.directoryHandle = handle;
            });
            try {
                await set('directoryHandle', handle);
            } catch (e) {
                console.warn('Failed to persist directory handle:', e);
            }
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
                // console.log('Skipping directory restoration due to skip_restore flag');
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
                    await this.restoreCollapsedPaths();
                    await this.restoreLastFile();
                } else {
                    // We maintain the handle but can't list files yet.
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

        const findAndReplaceHandle = async (nodes: FileNodeModel[]) => {
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

    @action
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

            // Handle pending focus
            if (this.pendingFocusPath) {
                const findNode = (nodes: FileNodeModel[]): FileNodeModel | undefined => {
                    for (const node of nodes) {
                        if (node.path === this.pendingFocusPath) return node;
                        if (node.children) {
                            const found = findNode(node.children);
                            if (found) return found;
                        }
                    }
                }
                const nodeToFocus = findNode(this.fileTree);
                if (nodeToFocus) {
                    nodeToFocus.scheduleEffect(() => {
                        nodeToFocus.treeItemRef.current?.focus();
                    });
                }
                this.pendingFocusPath = null;
            }
        });
    }

    async readDirectory(dirHandle: FileSystemDirectoryHandle, parentPath: string = ''): Promise<FileNodeModel[]> {
        const models: FileNodeModel[] = [];

        for await (const entry of dirHandle.values()) {
            const currentPath = parentPath ? `${parentPath}/${entry.name}` : entry.name;

            if (entry.kind === 'file') {
                if (entry.name.endsWith('.adoc')) {
                    models.push(new FileNodeModel({
                        name: entry.name,
                        path: currentPath,
                        kind: 'file',
                        handle: entry
                    }));
                }
            } else if (entry.kind === 'directory') {
                if (entry.name.startsWith('.')) continue;
                const children = await this.readDirectory(entry, currentPath);
                const dirModel = new FileNodeModel({
                    name: entry.name,
                    path: currentPath,
                    kind: 'directory',
                    handle: entry
                });
                dirModel.children = children; // Assign children explicitly
                models.push(dirModel);
            }
        }

        return models.sort((a, b) => {
            if (a.kind === b.kind) return a.name.localeCompare(b.name);
            return a.kind === 'directory' ? -1 : 1;
        });
    }

    async selectFile(node: FileNodeModel) {
        if (node.kind !== 'file') return;


        // Auto-save previous file if dirty
        if (this.currentFileHandle && this.dirty) {
            await this.saveFile();
        }

        const fileHandle = node.handle as FileSystemFileHandle;

        // Persist file handle
        try {
            await set('lastOpenFile', fileHandle);
        } catch (e) {
            console.warn('Failed to persist file handle:', e);
        }

        let content = '';
        try {
            const file = await fileHandle.getFile();
            content = await file.text();
        } catch (e) {
            console.error('Failed to read file:', e);
            alert('Failed to read file. It might have been moved or deleted.');
            return;
        }

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
            // console.log('Saved file:', this.currentFileHandle.name);
        } catch (err) {
            console.error('Failed to save file:', err);
        }
    }

    startAutoSave() {
        if (this.saveInterval) {
            clearInterval(this.saveInterval);
        }
        this.saveInterval = window.setInterval(async () => {
            if ((window as any).__TEST_DISABLE_AUTO_SAVE__) return;

            if (this.dirty) {
                await this.saveFile();
            }
        }, 5000); // 5 seconds
    }

    findParentDirectory(targetHandle: FileSystemHandle): FileSystemDirectoryHandle | null {
        if (!this.directoryHandle) return null;

        const traverse = (nodes: FileNodeModel[]): FileSystemDirectoryHandle | undefined => {
            // Check if target is a child of any node in this list? 
            // Logic in original was: is `nodes` children of `node`? 
            // Original was iterating nodes to check if THEIR children contain target.

            // Wait, original: `findParentRecursive(this.fileTree, targetHandle)`
            // `for (const node of nodes)`
            // `if (node.kind === 'directory' && node.children)`
            // `if (node.children.some(child => child.handle === target))` -> return node.handle

            for (const node of nodes) {
                if (node.kind === 'directory' && node.children) {
                    if (node.children.some(child => child.handle === targetHandle)) { // Equality check on handle reference
                        return node.handle as FileSystemDirectoryHandle;
                    }
                    const found = traverse(node.children);
                    if (found) return found;
                }
            }
        };

        // Root check
        if (this.fileTree.some(n => n.handle === targetHandle)) {
            return this.directoryHandle;
        }

        return traverse(this.fileTree) || null;
    }

    // Helper to find actual parent node Model
    findParentNode(nodes: FileNodeModel[], target: FileSystemHandle): FileNodeModel | null {
        for (const n of nodes) {
            if (n.kind === 'directory' && n.children) {
                if (n.children.some(c => c.handle === target)) return n;
                const found = this.findParentNode(n.children, target);
                if (found) return found;
            }
        }
        // If root, we don't have a parent "node" unless we consider root a node which isn't in fileTree.
        return null;
    }


    get currentDirectoryPath(): string {
        if (!this.directoryHandle) return '';
        const rootName = this.directoryHandle.name;

        if (!this.currentFileHandle) return rootName;

        // Find path of current file in tree
        const findPath = (nodes: FileNodeModel[]): string | null => {
            for (const node of nodes) {
                if (node.kind === 'file') {
                    // Optimized check? node.handle is same as currentFileHandle?
                    // We can check reference equality first
                    if (node.handle === this.currentFileHandle) return node.path;
                    // Fallback to isSameEntry async? computed properties shouldn't be async.
                    // relying on reference equality assuming syncSelectedFileWithTree updated it.
                } else if (node.children) {
                    const found = findPath(node.children);
                    if (found) return found;
                }
            }
            return null;
        };

        const path = findPath(this.fileTree);
        if (!path) return rootName; // Fallback

        const lastSlash = path.lastIndexOf('/');
        if (lastSlash === -1) return rootName;

        return `${rootName}/${path.substring(0, lastSlash)}`;
    }

    async createNewFile(parentDirectory?: FileSystemDirectoryHandle) {
        if (!this.directoryHandle) {
            alert('Please open a directory first.');
            return;
        }

        // 1. Determine target directory
        let targetDir: FileSystemDirectoryHandle | null | undefined = parentDirectory;
        if (!targetDir) {
            if (this.currentFileHandle) {
                targetDir = this.findParentDirectory(this.currentFileHandle);
            }
            if (!targetDir) {
                targetDir = this.directoryHandle;
            }
        }

        if (!targetDir) return;

        // 2. Auto-save current file
        if (this.dirty) {
            await this.saveFile();
        }

        try {
            // 3. Find unique filename
            let index = 1;
            let filename = `new-${index}.adoc`;
            while (true) {
                try {
                    await targetDir.getFileHandle(filename);
                    // If successful, file exists
                    index++;
                    filename = `new-${index}.adoc`;
                } catch (e) {
                    // File does not exist (or other error), so we can use this name
                    break;
                }
            }

            // 4. Create the file
            const newFileHandle = await targetDir.getFileHandle(filename, { create: true });

            // 5. Refresh tree to show new file
            await this.refreshTree();

            // 6. Select the new file
            // We need to find the node in the tree to select it properly with path info
            const findNodeAsync = async (nodes: FileNodeModel[]): Promise<FileNodeModel | undefined> => {
                for (const node of nodes) {
                    if (node.kind === 'file') {
                        if (await node.handle.isSameEntry(newFileHandle)) {
                            return node;
                        }
                    } else if (node.children) {
                        const found = await findNodeAsync(node.children);
                        if (found) return found;
                    }
                }
            }

            const newNode = await findNodeAsync(this.fileTree);
            if (newNode) {
                await this.selectFile(newNode);
            }

        } catch (error) {
            console.error('Error creating new file:', error);
            alert('Failed to create new file.');
        }
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

    async deleteFile(node: FileNodeModel) {
        if (node.kind !== 'file') return;

        // 1. Confirm deletion (UI should handle confirmation before calling this, but we can verify)
        // For store action, we assume confirmation is done or we provide a callback? 
        // The plan says "UI side handles alert, this method just executes".

        const parentDir = this.findParentDirectory(node.handle);
        if (!parentDir) {
            alert('Cannot search parent directory needed for deletion.');
            return;
        }

        try {
            await parentDir.removeEntry(node.name);

            // Clear selection if deleted file was active
            if (this.currentFileHandle && await node.handle.isSameEntry(this.currentFileHandle)) {
                await this.clearSelection();
            }

            await this.refreshTree();
        } catch (error) {
            console.error('Error deleting file:', error);
            alert(`Failed to delete file: ${error}`);
        }
    }

    async renameFile(node: FileNodeModel, newName: string, focusAfterRename: boolean): Promise<boolean> {
        if (node.kind !== 'file') return false;

        // 1. Trim the name first
        const trimmedInput = newName.trim();

        // 2. See if it begins with a dot
        const startsWithDot = trimmedInput.startsWith('.');

        // 3. Split by dot, trim all parts, filter out empty parts
        const parts = trimmedInput.split('.').map(p => p.trim()).filter(p => p.length > 0);

        // 4. Join with a dot
        let finalName = parts.join('.');

        // 5. If the result of step 1 was true, prepend a dot again
        if (startsWithDot) {
            finalName = '.' + finalName;
        }

        // 6. Check for empty or just dot (disallowed)
        if (!finalName || finalName === '.') {
            node.cancelRenaming();
            return true;
        }

        // Ensure extension
        // Only append .adoc if original had .adoc AND new name doesn't have it
        if (node.name.endsWith('.adoc') && !finalName.endsWith('.adoc')) {
            finalName = `${finalName}.adoc`;
        }

        // 1. Validation
        // Allowed: 
        // - Printable ASCII (0x20-0x7E) EXCEPT < > : " / \ | ? *
        // - Unicode letters (\p{L}) and numbers (\p{N})
        // - Characters already in the original filename
        const unsafeAsciiRegex = /[<>:"/\\|?*]/;
        const printableAsciiRegex = /^[\x20-\x7E]$/;
        const unicodeWordRegex = /^[\p{L}\p{N}]$/u;

        for (const char of finalName) {
            if (node.name.includes(char)) continue; // Allowed if in original

            if (printableAsciiRegex.test(char)) {
                // It is printable ASCII. Check if it is unsafe.
                if (unsafeAsciiRegex.test(char)) {
                    alert(`Invalid character: ${char}`);
                    return false;
                }
            } else {
                // It is NOT printable ASCII (e.g. Unicode or Control)
                // Check if it is a Unicode Letter or Number
                if (!unicodeWordRegex.test(char)) {
                    alert(`Invalid character: ${char}`);
                    return false;
                }
            }
        }

        const parentDir = this.findParentDirectory(node.handle);
        if (!parentDir) {
            alert('Cannot find parent directory.');
            return false;
        }

        // 2. Uniqueness Check
        let conflict = false;
        try {
            for await (const entry of parentDir.values()) {
                if (entry.name === node.name) continue; // self
                if (entry.name.toLowerCase() === finalName.toLowerCase()) {
                    conflict = true;
                    break;
                }
            }
        } catch (e) { console.warn('Error checking siblings', e); }

        if (conflict) {
            const proceed = confirm(`A file with the name "${finalName}" already exists (case-insensitive). Do you want to try replacing it or proceed?`);
            if (!proceed) return false;
        }

        // 3. Execute Rename
        const handle = node.handle as any;
        if (handle.move) {
            try {
                await handle.move(parentDir, finalName);

                // Determine new path to set pending focus
                // If it was renamed, the path changes.
                // We basically need parent path + finalName
                const parentPath = node.path.substring(0, node.path.lastIndexOf('/'));
                const newPath = parentPath ? `${parentPath}/${finalName}` : finalName;
                if (focusAfterRename) {
                    this.pendingFocusPath = newPath;
                }
                else {
                    this.pendingFocusPath = null;
                }

                await this.refreshTree();
                return true;
            } catch (error) {
                console.error('Rename failed:', error);
                alert(`Rename failed: ${error}`);
                return false;
            }
        } else {
            alert('Your browser does not support renaming files directly (File System Access API "move" method is missing). Please use a supported browser (e.g. Chrome 111+).');
            return false;
        }
    }

    @action
    toggleDirectory(path: string) {
        if (this.collapsedPaths.has(path)) {
            this.collapsedPaths.delete(path);
        } else {
            this.collapsedPaths.add(path);
        }
        // Trigger generic reaction/persist
        try {
            set('collapsedPaths', Array.from(this.collapsedPaths));
        } catch (e) {
            console.warn('Failed to persist collapsed paths:', e);
        }
    }

    isCollapsed(path: string) {
        return this.collapsedPaths.has(path);
    }

    async restoreCollapsedPaths() {
        try {
            const stored = await get('collapsedPaths') as Set<string> | string[] | undefined;
            if (stored) {
                runInAction(() => {
                    if (Array.isArray(stored)) {
                        this.collapsedPaths = new Set(stored);
                    } else if (stored instanceof Set) {
                        this.collapsedPaths = stored;
                    }
                });
            }
        } catch (e) {
            console.error('Error restoring collapsed paths:', e);
        }
    }

    @action
    setSearchQuery(query: string) {
        this.searchQuery = query;
    }

    readonly searchInputRef = createRef<HTMLInputElement>();

    @action
    handleSearchKeyDown(e: React.KeyboardEvent) {
        if (e.key === 'Escape') {
            e.stopPropagation();
            if (this.searchQuery) {
                this.setSearchQuery('');
            } else {
                this.closeSearch();
            }
        } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            this.moveHighlight(1);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            this.moveHighlight(-1);
        } else if (e.key === 'Enter') {
            e.preventDefault();
            this.openHighlighted();
        } else if (e.key === 'PageDown') {
            e.preventDefault();
            this.moveHighlight(this.getPageSize());
        } else if (e.key === 'PageUp') {
            e.preventDefault();
            this.moveHighlight(-this.getPageSize());
        }
    }

    @action
    closeSearch() {
        this.isSearchVisible = false;
        this.setSearchQuery('');
    }

    @action
    toggleSearch(e: React.MouseEvent) {
        e.stopPropagation();
        if (this.isSearchVisible) {
            this.closeSearch();
        } else {
            this.isSearchVisible = true;
            // Schedule focus
            this.scheduleEffect(() => {
                this.searchInputRef.current?.focus();
            });
        }
    }

    @action
    handleClearButtonClick(e: React.MouseEvent) {
        e.stopPropagation();
        if (this.searchQuery) {
            this.setSearchQuery('');
            this.searchInputRef.current?.focus();
        } else {
            this.closeSearch();
        }
    }

    getPageSize(): number {
        const first = this.searchResults[0];
        if (!first || !first.ref.current) return 10;
        const itemHeight = first.ref.current.offsetHeight;
        const container = first.ref.current.offsetParent as HTMLElement;
        if (!container) return 10;
        const height = container.clientHeight;
        if (height === 0 || itemHeight === 0) return 10;
        return Math.floor(height / itemHeight);
    }

    @action
    moveHighlight(delta: number) {
        const results = this.searchResults;
        if (results.length === 0) return;

        const currentIndex = results.findIndex(r => r.isHighlighted);
        let newIndex = currentIndex + delta;

        // Boundary checks
        if (newIndex < 0) {
            if (currentIndex !== -1) results[currentIndex].setHighlight(false);
            this.searchInputRef.current?.scrollIntoView({ block: 'center' });
            return;
        }

        if (newIndex >= results.length) {
            newIndex = results.length - 1;
        }

        if (currentIndex !== -1) results[currentIndex].setHighlight(false);
        results[newIndex].setHighlight(true);
        this.scrollToResult(results[newIndex]);
    }

    scrollToResult(result: SearchResultItemModel) {
        this.scheduleEffect(() => {
            result.ref.current?.scrollIntoView({ block: 'nearest' });
        });
    }

    @action
    openHighlighted() {
        const result = this.searchResults.find(r => r.isHighlighted);
        if (result) {
            this.handleSearchResultClick(result.item);
        }
    }

    @action
    handleSearchResultClick(item: FileNodeModel) {
        this.selectFile(item);
        this.closeSearch();
    }

    @action
    handleSearchChange(e: React.ChangeEvent<HTMLInputElement>) {
        this.setSearchQuery(e.target.value);
    }
}

export const fileSystemStore = new FileSystemStore();

// Expose for testing/debugging
if (typeof window !== 'undefined' && (window as any).__ENABLE_TEST_GLOBALS__) {
    (window as any).__TEST_fileSystemStore = fileSystemStore;
}
