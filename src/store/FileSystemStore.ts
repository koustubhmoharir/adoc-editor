import { observable, action, runInAction, reaction, computed } from "mobx";
import { get, set } from 'idb-keyval';
import { Fzf } from 'fzf';
import { editorStore } from './EditorStore';
import { createRef } from "react";

export interface FileNode {
    name: string;
    path: string;
    kind: 'file' | 'directory';
    handle: FileSystemFileHandle | FileSystemDirectoryHandle;
    children?: FileNode[];
}

export class SearchResultItemModel {
    @observable accessor isHighlighted: boolean = false;
    readonly ref = createRef<HTMLDivElement>();
    constructor(public readonly item: FileNode) { }

    @action
    setHighlight(val: boolean) {
        this.isHighlighted = val;
    }
}

class FileSystemStore {
    @observable accessor directoryHandle: FileSystemDirectoryHandle | null = null;
    @observable accessor fileTree: FileNode[] = [];
    @observable accessor currentFileHandle: FileSystemFileHandle | null = null;
    @observable accessor dirty: boolean = false;
    @observable accessor isLoading: boolean = false;
    @observable accessor collapsedPaths: Set<string> = new Set();
    @observable accessor searchQuery: string = '';
    @observable accessor isSearchVisible: boolean = false;

    get allFiles(): FileNode[] {
        const result: FileNode[] = [];
        const traverse = (nodes: FileNode[]) => {
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

    async readDirectory(dirHandle: FileSystemDirectoryHandle, parentPath: string = ''): Promise<FileNode[]> {
        const entries: FileNode[] = [];
        for await (const entry of dirHandle.values()) {
            if (entry.name.startsWith('.')) continue; // Skip hidden files/dotfiles

            // Build the relative path for this entry
            // parentPath is empty for root items.
            // If parentPath exists, append '/'
            const currentPath = parentPath ? `${parentPath}/${entry.name}` : entry.name;


            if (entry.kind === 'file') {
                if (entry.name.endsWith('.adoc')) {
                    entries.push({
                        name: entry.name,
                        path: currentPath,
                        kind: 'file',
                        handle: entry
                    });
                }
            } else if (entry.kind === 'directory') {
                entries.push({
                    name: entry.name,
                    path: currentPath,
                    kind: 'directory',
                    handle: entry,
                    children: await this.readDirectory(entry, currentPath)
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

    get currentDirectoryPath(): string {
        if (!this.directoryHandle) return '';
        const rootName = this.directoryHandle.name;

        if (!this.currentFileHandle) return rootName;

        // Find path of current file in tree
        const findPath = (nodes: FileNode[]): string | null => {
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

        if (!targetDir) return; // Should not happen given logic above

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
            const findNode = (nodes: FileNode[]): FileNode | undefined => {
                for (const node of nodes) {
                    if (node.kind === 'file' && (node.handle as any).name === filename) {
                        // This check is a bit weak if multiple files have same name in diff dirs,
                        // but since we just created it in targetDir and refreshed, we ideally need a robust way.
                        // Ideally we match handles but strict equality might fail after refresh if handles are re-fetched?
                        // Actually, refreshTree re-reads handles.
                        // Let's use isSameEntry
                        // But we can't await inside sync filter/find easily.
                        return node;
                    } else if (node.children) {
                        const found = findNode(node.children);
                        if (found) return found;
                    }
                }
            };

            // Since handle comparison needs await, and we just need to select,
            // we can try to "find" it by structure if we know the path, but we don't know the full path string easily without reconstructing it.
            // Let's rely on `isSameEntry` in `syncSelectedFileWithTree` logic but adapted.

            // Simpler approach: Select it manually by constructing a partial node or just calling selectFile with the handle
            // But selectFile expects a Node to get the name? No, it casts node.handle.
            // Let's construct a temporary node or find it properly.

            const findNodeAsync = async (nodes: FileNode[]): Promise<FileNode | undefined> => {
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

    async deleteFile(node: FileNode) {
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

    async renameFile(node: FileNode, newName: string) {
        if (node.kind !== 'file') return;

        const trimmedName = newName.trim();
        if (!trimmedName) return;

        // Ensure extension
        const finalName = trimmedName.endsWith('.adoc') ? trimmedName : `${trimmedName}.adoc`;

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
                    return;
                }
            } else {
                // It is NOT printable ASCII (e.g. Unicode or Control)
                // Check if it is a Unicode Letter or Number
                if (!unicodeWordRegex.test(char)) {
                    alert(`Invalid character: ${char}`);
                    return;
                }
            }
        }

        const parentDir = this.findParentDirectory(node.handle);
        if (!parentDir) {
            alert('Cannot find parent directory.');
            return;
        }

        // 2. Uniqueness Check
        // Check for siblings with case-insensitive match
        // We can use this.fileTree to search, but we need the specific parent's children.
        // It's safer to re-read or use existing tree if up to date.
        // Let's use `findSiblingFile` logic or iterate parentDir values? 
        // `findSiblingFile` is async and accurate.

        // Check if file exists (case insensitive check implies we need to list all and compare?)
        // FileSystemHandle API getFileHandle is case sensitive on some OS/Browsers, insensitive on others. 
        // To strictly follow "If there is a conflict considering insensitive match, lets alert...", we should scan.

        // Find the folder node in tree to get siblings
        const findParentNode = (nodes: FileNode[], target: FileSystemHandle): FileNode | null => {
            for (const n of nodes) {
                if (n.kind === 'directory' && n.children) {
                    if (n.children.some(c => c.handle === target)) return n;
                    const found = findParentNode(n.children, target);
                    if (found) return found;
                }
            }
            // If root
            if (nodes.some(n => n.handle === target)) return { handle: this.directoryHandle } as any;
            return null;
        };
        // Searching tree is easier than re-reading dir
        // Actually we can just iterate `parentDir.values()`
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
            if (!proceed) return;
        }

        // 3. Execute Rename
        // Check for move() support
        const handle = node.handle as any;
        if (handle.move) {
            try {
                await handle.move(parentDir, finalName);

                // Refresh
                await this.refreshTree();

                // If it was selected, ensure selection is maintained (refreshTree might lose it if reference changes, 
                // but syncSelectedFileWithTree should handle it if path updates? 
                // If path changed, syncSelectedFileWithTree relies on finding handle.
                // Depending on browser, handle object might mutate or remain same.
                // We should re-select by name if needed.

                // Wait, if we renamed current file, logic in store might need update
                if (this.currentFileHandle && await node.handle.isSameEntry(this.currentFileHandle)) {
                    // Update current handle reference if needed (move modifies in place usually)
                    // But we should re-sync just in case
                    // The handle itself points to the file. 
                }

            } catch (error) {
                console.error('Rename failed:', error);
                alert(`Rename failed: ${error}`);
            }
        } else {
            alert('Your browser does not support renaming files directly (File System Access API "move" method is missing). Please use a supported browser (e.g. Chrome 111+).');
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

    getPageSize(): number {
        const first = this.searchResults[0];
        if (!first || !first.ref.current) return 10;

        const itemHeight = first.ref.current.offsetHeight;
        // The container is the offsetParent
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

        // Calculate new index
        // If nothing selected (-1), start from -1. 
        // For ArrowDown (delta=1): -1 + 1 = 0
        // For PageDown (delta=10): -1 + 10 = 9
        let newIndex = currentIndex + delta;

        // Boundary checks
        if (newIndex < 0) {
            // Moving up past top -> clear highlight
            if (currentIndex !== -1) {
                results[currentIndex].setHighlight(false);
            }
            // Scroll to top/input
            this.searchInputRef.current?.scrollIntoView({ block: 'center' });
            return;
        }

        if (newIndex >= results.length) {
            // Stay at last
            newIndex = results.length - 1;
        }

        // Update highlight
        if (currentIndex !== -1) {
            results[currentIndex].setHighlight(false);
        }
        results[newIndex].setHighlight(true);

        // Scroll into view
        this.scrollToResult(results[newIndex]);
    }

    scrollToResult(result: SearchResultItemModel) {
        setTimeout(() => {
            result.ref.current?.scrollIntoView({ block: 'nearest' });
        }, 0);
    }

    @action
    openHighlighted() {
        const result = this.searchResults.find(r => r.isHighlighted);
        if (result) {
            this.handleSearchResultClick(result.item);
        }
    }

    @action
    handleSearchChange(e: React.ChangeEvent<HTMLInputElement>) {
        this.setSearchQuery(e.target.value);
    }

    @action
    handleSearchResultClick(node: FileNode) {
        this.selectFile(node);
        this.closeSearch();
    }

    @action
    setSearchVisible(visible: boolean) {
        this.isSearchVisible = visible;
        if (visible) {
            // giving React time to render input? or use layout effect?
            // Since this is in store, we can't easily wait for render.
            // We rely on the component using useEffect or callback ref,
            // OR we just focus if ref exists.
            setTimeout(() => this.searchInputRef.current?.focus(), 0);
        } else {
            this.searchQuery = '';
        }
    }

    @action
    toggleSearch(e?: React.MouseEvent) {
        if (e) e.stopPropagation();
        this.setSearchVisible(!this.isSearchVisible);
    }

    @action
    closeSearch() {
        this.setSearchVisible(false);
    }

    @action
    clearSearch() {
        this.setSearchQuery('');
        this.searchInputRef.current?.focus();
    }

    @action
    handleClearButtonClick(e: React.MouseEvent) {
        e.stopPropagation();
        if (this.searchQuery) {
            this.clearSearch();
        } else {
            this.closeSearch();
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
