import { observable, action, runInAction, reaction, computed } from "mobx";
import { get as getDbValue, set as setDbValue, clear as clearAllDbValues } from 'idb-keyval';
import { Fzf } from 'fzf';
import { editorStore } from './EditorStore';
import { createRef } from "react";
import { EffectAwareModel } from "./EffectAwareModel";
import { dialog } from "../components/Dialog";

export interface FileSystemNodeDataBase {
    kind: 'file' | 'directory';
    name: string;
    path: string;
    handle: FileSystemFileHandle | FileSystemDirectoryHandle;
}

export interface FileNodeData extends FileSystemNodeDataBase {
    kind: 'file';
    handle: FileSystemFileHandle;
}

export interface DirectoryNodeData extends FileSystemNodeDataBase {
    kind: 'directory';
    handle: FileSystemDirectoryHandle;
    children?: FileSystemNodeModel[];
}

export abstract class FileSystemNodeModelBase extends EffectAwareModel {

    constructor(data: FileSystemNodeDataBase, isRoot = false) {
        super();
        this.kind = data.kind;
        this._name = data.name;
        this.path = data.path;
        this.handle = data.handle;
        this.isRoot = isRoot;
    }
    readonly kind: 'file' | 'directory';
    readonly path: string;
    readonly handle: FileSystemFileHandle | FileSystemDirectoryHandle;
    readonly isRoot: boolean = false;

    @observable protected accessor _name: string;
    get name() { return this._name; }

    // UI State
    @observable protected accessor _isRenaming: boolean = false;
    get isRenaming() { return this._isRenaming; }
    @observable protected accessor _renameValue: string = '';
    get renameValue() { return this._renameValue; }
    @observable protected accessor _isCommitting: boolean = false;

    // Refs
    readonly renameInputRef = createRef<HTMLInputElement>();
    readonly acceptRenameBtnRef = createRef<HTMLButtonElement>();
    readonly treeItemRef = createRef<HTMLDivElement>();

    @action
    startRenaming() {
        if (this.isRoot) return;
        this._isRenaming = true;
        this._renameValue = this.name;

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
    cancelRenaming() {
        this._isRenaming = false;
        this._renameValue = '';
        this.scheduleEffect(() => {
            this.treeItemRef.current?.focus();
        });
    }

    @action
    setRenameValue(val: string) {
        this._renameValue = val;
    }

    @action
    async commitRenaming() {
        if (this._isCommitting) return;
        this._isCommitting = true;
        try {
            if (!this.renameValue || this.renameValue === this.name) {
                this.cancelRenaming();
                return;
            }
            const success = await fileSystemStore.renameNode(this, this.renameValue, true);
            // If rename is successful, the store refreshes the tree, so this model instance might be discarded.
            if (!success) {
                this.renameInputRef.current?.focus();
            }
        } finally {
            this._isCommitting = false;
        }
    }

    @action
    async delete() {
        if (this.isRoot) return;
        if (await dialog.confirm(`Are you sure you want to delete '${this.name}'?`)) {
            await fileSystemStore.deleteNode(this);
        }
    }

    @action
    handleRenameInputKeyDown(e: React.KeyboardEvent | KeyboardEvent) {
        if (e.key === 'Enter') {
            e.stopPropagation();
            e.preventDefault();
            this.commitRenaming();
        } else if (e.key === 'Escape') {
            e.stopPropagation();
            e.preventDefault();
            this.cancelRenaming();
        }
    }

    @action
    handleRenameInputBlur(_e: React.FocusEvent) {
        // If the window loses focus (e.g. alt-tab), we want to KEEP renaming state.
        // If the click is inside the app but outside input, we want to COMMIT.
        // We do NOT want to restore focus to the tree item, because the user likely clicked something else.
        if (document.hasFocus() && !dialog.isOpen) {
            this.commitRenaming();
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
        } else if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
            e.preventDefault();
            e.stopPropagation();
            const direction = e.key.replace('Arrow', '').toLowerCase() as 'up' | 'down' | 'left' | 'right';
            fileSystemStore.navigate(direction);
        } else {
            this.handleSpecificKey(e);
        }
    }

    @action.bound
    handleContextMenu(e: React.MouseEvent) {
        e.preventDefault();
        e.stopPropagation();

        if (!this.isRoot && fileSystemStore.highlightedPath !== this.path) {
            fileSystemStore.selectNode(this, 'show');
        }

        fileSystemStore.openContextMenu(this);
    }

    abstract handleSpecificKey(e: React.KeyboardEvent | KeyboardEvent): void;
}

export class FileNodeModel extends FileSystemNodeModelBase {
    constructor(data: FileNodeData) {
        super(data);
    }

    declare readonly kind: 'file';
    declare readonly handle: FileSystemFileHandle;

    @action
    handleSpecificKey(e: React.KeyboardEvent | KeyboardEvent) {
        if (e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            fileSystemStore.selectNode(this, 'focus');
        }
    }
}

export class DirectoryNodeModel extends FileSystemNodeModelBase {

    constructor(data: DirectoryNodeData, isRoot = false) {
        super(data, isRoot);
        this.children = data.children;
    }

    declare readonly kind: 'directory';
    declare readonly handle: FileSystemDirectoryHandle;
    @observable accessor children: FileSystemNodeModel[] | undefined;

    @action
    handleSpecificKey(e: React.KeyboardEvent | KeyboardEvent) {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            e.stopPropagation();
            fileSystemStore.toggleDirectory(this.path);
        }
    }
}

export type FileSystemNodeModel = FileNodeModel | DirectoryNodeModel;

export class SearchResultItemModel {
    @observable accessor isHighlighted: boolean = false;
    readonly ref = createRef<HTMLDivElement>();
    constructor(public readonly item: FileSystemNodeModel) { }

    @action
    setHighlight(val: boolean) {
        this.isHighlighted = val;
    }
}

class FileSystemStore extends EffectAwareModel {

    constructor() {
        super();
        this.restoreDirectory();
        editorStore.focusCurrentFileItem = this.focusCurrentFileInSidebar;
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

        // Global Keyboard Shortcuts
        window.addEventListener('keydown', (e: KeyboardEvent) => {
            // Ctrl + Backtick or Cmd + Backtick (often referred to as Ctrl/Cmd + ~)
            if ((e.ctrlKey || e.metaKey) && (e.code === 'Backquote' || e.key === '`')) {
                e.preventDefault();
                e.stopPropagation();
                // We don't need to pass 'e' here anymore since we handle prevention above
                this.toggleSearch();
            }
        });
    }


    @observable private accessor _currentFileHandle: FileSystemFileHandle | null = null;
    get currentFileHandle() { return this._currentFileHandle; }

    @observable private accessor _dirty: boolean = false;
    get dirty() { return this._dirty; }

    @observable private accessor _isLoading: boolean = false;
    get isLoading() { return this._isLoading; }

    @observable private accessor _collapsedPaths: Set<string> = new Set();
    // No getter for collapsedPaths, use isCollapsed(path)

    @observable private accessor _searchQuery: string = '';
    get searchQuery() { return this._searchQuery; }

    @observable private accessor _isSearchVisible: boolean = false;
    get isSearchVisible() { return this._isSearchVisible; }

    @observable private accessor _highlightedPath: string | null = null;
    get highlightedPath() { return this._highlightedPath; }

    @observable private accessor _contextMenuTarget: FileSystemNodeModelBase | null = null;
    get contextMenuTarget() { return this._contextMenuTarget; }

    // Persistent root node
    @observable private accessor _rootNode: DirectoryNodeModel | null = null;
    get rootNode() { return this._rootNode; }

    private saveInterval: number | null = null;

    private loadTimeout: number | null = null;
    private dbOperations: Promise<void>[] = [];

    readonly contextMenuRef = createRef<HTMLDivElement>();

    readonly searchInputRef = createRef<HTMLInputElement>();

    @computed
    get visibleNodes(): FileSystemNodeModel[] {
        const result: FileSystemNodeModel[] = [];
        const traverse = (nodes: FileSystemNodeModel[]) => {
            for (const node of nodes) {
                result.push(node);
                if (node.kind === 'directory' && !this.isCollapsed(node.path) && node.children) {
                    traverse(node.children);
                }
            }
        };
        traverse(this.rootNode?.children ?? []);
        return result;
    }

    get allFiles(): FileSystemNodeModel[] {
        const result: FileSystemNodeModel[] = [];
        const traverse = (nodes: FileSystemNodeModel[]) => {
            for (const node of nodes) {
                if (node.kind === 'file') {
                    result.push(node);
                } else if (node.kind === 'directory' && node.children) {
                    traverse(node.children);
                }
            }
        };
        traverse(this.rootNode?.children ?? []);
        return result;
    }

    @computed
    get searchResults() {
        if (!this.searchQuery) return [];
        const files = this.allFiles;
        const fzf = new Fzf(files, { selector: (item: FileSystemNodeModel) => item.path });
        const matches = fzf.find(this.searchQuery);
        return matches.map(match => new SearchResultItemModel(match.item));
    }

    async flushPendingDbOperations() {
        await Promise.all(this.dbOperations.slice());
    }

    @action
    openContextMenu(node: FileSystemNodeModelBase) {
        // Clear previous anchor if any
        if (this.contextMenuTarget && this.contextMenuTarget !== node) {
            this.contextMenuTarget.treeItemRef.current?.style.removeProperty('anchor-name');
        }

        this._contextMenuTarget = node;

        // Set new anchor
        // We do this immediately as it's a DOM side-effect needed for popover positioning
        node.treeItemRef.current?.style.setProperty('anchor-name', '--context-menu-trigger');

        this.scheduleEffect(() => {
            if (this.contextMenuRef.current) {
                this.contextMenuRef.current.showPopover();
            }
        });
    }

    @action.bound
    onContextMenuClosed() {
        if (this.contextMenuTarget) {
            this.contextMenuTarget.treeItemRef.current?.style.removeProperty('anchor-name');
            this._contextMenuTarget = null;
        }
    }

    async openDirectory() {
        try {
            const handle = await window.showDirectoryPicker();
            runInAction(() => {
                this._rootNode = new DirectoryNodeModel({
                    name: handle.name,
                    path: handle.name,
                    kind: 'directory',
                    handle: handle,
                    children: []
                }, true);
            });
            await this.pushDbOperation(setDbValue('directoryHandle', handle), 'Failed to persist directory handle:');
            await this.refreshTree();
        } catch (error) {
            console.error('Error opening directory:', error);
        }
    }

    @action
    async clearDirectory() {
        this._rootNode = null;
        this._currentFileHandle = null;
        this._dirty = false;
        this._isLoading = false;
        this._collapsedPaths = new Set();
        this._searchQuery = '';
        this._isSearchVisible = false;
        this._highlightedPath = null;
        this._contextMenuTarget = null;
        if (this.loadTimeout) {
            window.clearTimeout(this.loadTimeout);
            this.loadTimeout = null;
        }
        editorStore.showHelp();
        await clearAllDbValues();
    }

    @action
    selectNode(node: FileSystemNodeModelBase, loadContent: 'focus' | 'show' | 'delay') {
        this.setHighlightedPath(node.path);

        if (loadContent !== 'focus') {
            node.scheduleEffect(() => {
                node.treeItemRef.current?.focus();
            });
        }

        if (this.loadTimeout) {
            window.clearTimeout(this.loadTimeout);
            this.loadTimeout = null;
        }

        if (node instanceof FileNodeModel) {
            if (loadContent === 'delay') {
                // Debounce load
                this.loadTimeout = window.setTimeout(() => {
                    this.loadFileContentInEditor(node);
                }, 750);
            } else {
                this.loadFileContentInEditor(node).then(() => {
                    if (loadContent === 'focus') {
                        editorStore.focusEditor();
                    }
                });
            }
        }
    }

    @action
    navigate(direction: 'up' | 'down' | 'left' | 'right') {
        const visible = this.visibleNodes;
        const currentIndex = visible.findIndex(n => n.path === this.highlightedPath);

        // If nothing selected, select first
        if (currentIndex === -1 && visible.length > 0) {
            this.selectNode(visible[0], 'delay');
            return;
        }

        if (currentIndex === -1) return;

        const currentNode = visible[currentIndex];

        if (direction === 'up') {
            if (currentIndex > 0) {
                this.selectNode(visible[currentIndex - 1], 'delay');
            }
        } else if (direction === 'down') {
            if (currentIndex < visible.length - 1) {
                this.selectNode(visible[currentIndex + 1], 'delay');
            }
        } else if (direction === 'left') {
            if (currentNode.kind === 'directory' && !this.isCollapsed(currentNode.path)) {
                // Collapse
                this.toggleDirectory(currentNode.path);
            } else {
                // Move to parent
                // find strictly via path string manipulation
                const lastSlash = currentNode.path.lastIndexOf('/');
                if (lastSlash !== -1) {
                    const parentPath = currentNode.path.substring(0, lastSlash);
                    const parentNode = visible.find(n => n.path === parentPath);
                    if (parentNode) {
                        this.selectNode(parentNode, 'delay');
                    }
                }
            }
        } else if (direction === 'right') {
            if (currentNode.kind === 'directory') {
                if (this.isCollapsed(currentNode.path)) {
                    this.toggleDirectory(currentNode.path);
                } else {
                    // Move to first child (next in visible list)
                    if (currentIndex < visible.length - 1) {
                        // Verify next one is actually a child?
                        // If expanded, next visible IS first child.
                        this.selectNode(visible[currentIndex + 1], 'delay');
                    }
                }
            }
        }
    }

    @action.bound
    async focusCurrentFileInSidebar() {
        if (!this.currentFileHandle) return;

        const node = this.findNodeByHandle(this.currentFileHandle);
        if (!node) return;

        // 1. Highlight
        this.setHighlightedPath(node.path);

        // 2. Expand all parents
        const parts = node.path.split('/');
        parts.pop(); // Remove file itself

        let currentPath = '';
        runInAction(() => {
            for (const part of parts) {
                currentPath = currentPath ? `${currentPath}/${part}` : part;
                this._collapsedPaths.delete(currentPath);
            }
        });

        this.scheduleEffect(() => {
            node.treeItemRef.current?.scrollIntoView({ block: 'nearest' });
            node.treeItemRef.current?.focus();
        });

        // Trigger generic reaction/persist collapsed paths if needed?
        // toggleDirectory does persist. Here we batch.
        await this.pushDbOperation(setDbValue('collapsedPaths', Array.from(this._collapsedPaths)), 'Failed to persist collapsed paths:');
    }

    async clearSelection() {
        if (this.currentFileHandle && this.dirty) {
            await this.saveFile();
        }

        // Clear persisted handle
        await this.pushDbOperation(setDbValue('lastOpenFile', null), 'failed to clear lastOpenFile');

        runInAction(() => {
            this._currentFileHandle = null;
            this._dirty = false;
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
                this._dirty = false;
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
            if ((window as any).__TEST_DISABLE_AUTO_SAVE) return;

            if (this.dirty) {
                await this.saveFile();
            }
        }, 5000); // 5 seconds
    }

    get currentDirectoryPath(): string {
        if (!this.rootNode) return '';
        const rootName = this.rootNode.name;

        if (!this.currentFileHandle) return rootName;

        // Find path of current file in tree
        const findPath = (nodes: FileSystemNodeModel[]): string | null => {
            for (const node of nodes) {
                if (node.kind === 'file') {
                    // Optimized check? node.handle is same as currentFileHandle?
                    // We can check reference equality first
                    if (node.handle === this.currentFileHandle) return node.path;
                    // Fallback to isSameEntry async? computed properties shouldn't be async.
                    // relying on reference equality assuming syncSelectedFileWithTree updated it.
                } else if (node.kind === 'directory' && node.children) {
                    const found = findPath(node.children);
                    if (found) return found;
                }
            }
            return null;
        };

        const path = findPath(this.rootNode.children ?? []);
        if (!path) return rootName; // Fallback

        const lastSlash = path.lastIndexOf('/');
        if (lastSlash === -1) return rootName;

        return `${rootName}/${path.substring(0, lastSlash)}`;
    }

    async createNewFile(parentDirectory?: FileSystemDirectoryHandle) {
        if (!this.rootNode) {
            await dialog.alert('Please open a directory first.');
            return;
        }

        // 1. Determine target directory
        let targetDir: FileSystemDirectoryHandle | null | undefined = parentDirectory;
        if (!targetDir) {
            if (this.currentFileHandle) {
                targetDir = this.findParentDirectory(this.currentFileHandle);
            }
            if (!targetDir) {
                targetDir = this.rootNode.handle;
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
            let filename = `new-${index}`;
            while (true) {
                try {
                    await targetDir.getFileHandle(filename);
                    // If successful, file exists
                    index++;
                    filename = `new-${index}`;
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
            const findNodeAsync = async (nodes: FileSystemNodeModel[]): Promise<FileSystemNodeModel | undefined> => {
                for (const node of nodes) {
                    if (node.kind === 'file') {
                        if (await node.handle.isSameEntry(newFileHandle)) {
                            return node;
                        }
                    } else if (node.kind === 'directory' && node.children) {
                        const found = await findNodeAsync(node.children);
                        if (found) return found;
                    }
                }
            };

            const newNode = await findNodeAsync(this.rootNode.children ?? []);
            if (newNode) {
                await this.loadFileContentInEditor(newNode);
                newNode.startRenaming(); // Ensure we enter rename mode
            }

        } catch (error) {
            console.error('Error creating new file:', error);
            await dialog.alert('Failed to create new file.');
        }
    }

    async createNewDirectory(parentDirectory?: FileSystemDirectoryHandle) {
        if (!this.rootNode) {
            await dialog.alert('Please open a directory first.');
            return;
        }

        // 1. Determine target directory
        let targetDir: FileSystemDirectoryHandle | null | undefined = parentDirectory;
        if (!targetDir) {
            if (this.currentFileHandle) {
                targetDir = this.findParentDirectory(this.currentFileHandle);
            }
            if (!targetDir) {
                targetDir = this.rootNode.handle;
            }
        }

        if (!targetDir) return;

        try {
            // 2. Find unique name
            let index = 1;
            let dirname = `new-dir-${index}`;
            while (index < 1000) {
                try {
                    await targetDir.getDirectoryHandle(dirname);
                    // If successful, exists
                    index++;
                    dirname = `new-dir-${index}`;
                } catch (e) {
                    break;
                }
            }

            if (index >= 1000) {
                await dialog.alert('Could not find a unique name for new directory.');
                return;
            }

            // 3. Create directory
            const newDirHandle = await targetDir.getDirectoryHandle(dirname, { create: true });

            // 4. Refresh tree
            await this.refreshTree();

            // 5. Find and Select/Rename
            const findNodeAsync = async (nodes: FileSystemNodeModel[]): Promise<FileSystemNodeModel | undefined> => {
                for (const node of nodes) {
                    if (node.kind === 'directory') {
                        if (await node.handle.isSameEntry(newDirHandle)) {
                            return node;
                        }
                        if (node.children) {
                            const found = await findNodeAsync(node.children);
                            if (found) return found;
                        }
                    }
                }
            };

            const newNode = await findNodeAsync(this.rootNode.children ?? []);
            if (newNode) {
                // Expand parent if needed? refreshTree should handle if we are just adding child. 
                // But we want to ensure it is visible.

                // Expand path to this new node
                const parts = newNode.path.split('/');
                parts.pop();
                let currentPath = '';
                runInAction(() => {
                    for (const part of parts) {
                        currentPath = currentPath ? `${currentPath}/${part}` : part;
                        this._collapsedPaths.delete(currentPath);
                    }
                });

                newNode.startRenaming();

                // Scroll to view
                newNode.scheduleEffect(() => {
                    newNode.treeItemRef.current?.scrollIntoView({ block: 'nearest' });
                    newNode.treeItemRef.current?.focus();
                });
            }

        } catch (error) {
            console.error('Error creating new directory:', error);
            await dialog.alert('Failed to create new directory.');
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

    async deleteNode(node: FileSystemNodeModelBase) {
        // 1. Confirm deletion (UI should handle confirmation before calling this, but we can verify)
        // For store action, we assume confirmation is done or we provide a callback? 
        // The plan says "UI side handles alert, this method just executes".

        const parentDir = this.findParentDirectory(node.handle);
        if (!parentDir) {
            // Check if it is root?
            if (node.isRoot) {
                await dialog.alert('Cannot delete root directory.');
                return;
            }
            await dialog.alert('Cannot search parent directory needed for deletion.');
            return;
        }

        try {
            await parentDir.removeEntry(node.name, { recursive: node.kind === 'directory' });

            // Clear selection if deleted file was active (or if active file was inside deleted directory)
            // If we delete a directory, we need to check if currentFileHandle is inside it.
            if (this.currentFileHandle) {
                // If deleted node is file and matches
                if (node.kind === 'file' && await node.handle.isSameEntry(this.currentFileHandle)) {
                    await this.clearSelection();
                } else if (node.kind === 'directory') {
                    // Check if current file is child of deleted directory
                    // We can check path prefix?
                    if (this.highlightedPath && this.highlightedPath.startsWith(node.path + '/')) {
                        await this.clearSelection();
                    }
                }
            }

            await this.refreshTree();
        } catch (error) {
            console.error('Error deleting node:', error);
            await dialog.alert(`Failed to delete ${node.kind}: ${error}`);
        }
    }

    async renameNode(node: FileSystemNodeModelBase, newName: string, focusAfterRename: boolean): Promise<boolean> {
        //console.log('FileSystemStore.renameNode', { nodeName: node.name, newName, focusAfterRename });
        if (node.isRoot) return false;

        // 1. Prepare final name based on kind
        let finalName = '';
        const trimmedInput = newName.trim();

        const startsWithDot = trimmedInput.startsWith('.');
        // split by dot, trim parts, rejoin
        const parts = trimmedInput.split('.').map(p => p.trim()).filter(p => p.length > 0);
        finalName = parts.join('.');
        if (startsWithDot) {
            finalName = '.' + finalName;
        }

        // 2. Check for empty or just dot(s) (disallowed)
        // RegEx: Only dots
        if (!finalName || /^[\.]+$/.test(finalName)) {
            //console.log('renameNode: invalid finalName', finalName);
            node.cancelRenaming();
            return true;
        }

        // 3. Validation
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
                    //console.log('renameNode: unsafe char', char);
                    await dialog.alert(`Invalid character: ${char}`);
                    return false;
                }
            } else {
                // It is NOT printable ASCII (e.g. Unicode or Control)
                // Check if it is a Unicode Letter or Number
                if (!unicodeWordRegex.test(char)) {
                    //console.log('renameNode: invalid unicode char', char);
                    await dialog.alert(`Invalid character: ${char}`);
                    return false;
                }
            }
        }

        const parentDir = this.findParentDirectory(node.handle);
        if (!parentDir) {
            await dialog.alert('Cannot find parent directory.');
            return false;
        }

        // 4. Uniqueness Check
        let conflict = false;
        try {
            for await (const entry of parentDir.values()) {
                if (entry.name === node.name) continue; // self
                if (entry.name.toLowerCase() === finalName.toLowerCase()) {
                    conflict = true;
                    break;
                }
            }
        } catch (e) {
            console.warn('Error checking siblings', e);
            //console.log('renameNode: error checking siblings', e);
        }

        if (conflict) {
            //console.log('renameNode: conflict detected', finalName);
            await dialog.alert(`A ${node.kind} with the name "${finalName}" already exists (case-insensitive). Please use a different name.`);
            return false;
        }

        // 5. Execute Rename
        const handle = node.handle;
        if ('move' in handle) {
            try {
                //console.log('renameNode: calling move()', parentDir, finalName);
                await (handle.move as any)(parentDir, finalName);
                //console.log('renameNode: move() returned');

                // Determine new path to set pending focus
                const parentPath = node.path.substring(0, node.path.lastIndexOf('/'));
                const newPath = parentPath ? `${parentPath}/${finalName}` : finalName;

                await this.refreshTree(focusAfterRename ? newPath : undefined);
                //console.log('renameNode: success', finalName);
                return true;
            } catch (error) {
                console.error('Rename failed:', error);
                await dialog.alert(`Rename failed: ${error}`);
                return false;
            }
        } else {
            await dialog.alert('Your browser does not support renaming items directly (File System Access API "move" method is missing).');
            return false;
        }
    }

    @action
    async toggleDirectory(path: string) {
        if (this._collapsedPaths.has(path)) {
            this._collapsedPaths.delete(path);
        } else {
            this._collapsedPaths.add(path);
        }
        // Trigger generic reaction/persist
        await this.pushDbOperation(setDbValue('collapsedPaths', Array.from(this._collapsedPaths)), 'Failed to persist collapsed paths:');
    }

    isCollapsed(path: string) {
        return this._collapsedPaths.has(path);
    }

    @action
    toggleSearch(e?: React.MouseEvent | KeyboardEvent) {
        if (e) {
            e.stopPropagation();
            e.preventDefault();
        }
        if (this.isSearchVisible) {
            this.closeSearch();
        } else {
            this._isSearchVisible = true;
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

    @action
    handleSearchResultClick(item: FileSystemNodeModel) {
        this.loadFileContentInEditor(item);
        this.closeSearch();
    }

    @action
    handleSearchChange(e: React.ChangeEvent<HTMLInputElement>) {
        this.setSearchQuery(e.target.value);
    }

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


    private async pushDbOperation(op: Promise<void>, message: string) {
        op = op.catch(reason => console.warn(message, reason));
        this.dbOperations.push(op);
        await op.finally(() => this.dbOperations.splice(this.dbOperations.indexOf(op), 1));
    }

    @action
    private setDirty(val: boolean) {
        this._dirty = val;
    }

    private async restoreDirectory() {
        try {
            // Check for skip_restore parameter
            const params = new URLSearchParams(window.location.search);
            if (params.get('skip_restore') === 'true') {
                // console.log('Skipping directory restoration due to skip_restore flag');
                return;
            }

            const handle = await getDbValue('directoryHandle') as FileSystemDirectoryHandle | undefined;
            if (handle) {
                runInAction(() => {
                    // Test support: Hydrate handle if it's a plain object (mock)
                    const hydrator = (window as any).__TEST_hydrateHandle;

                    const hydratedHandle = hydrator ? hydrator(handle) : handle;
                    this._rootNode = new DirectoryNodeModel({
                        name: hydratedHandle.name,
                        path: hydratedHandle.name,
                        kind: 'directory',
                        handle: hydratedHandle,
                        children: []
                    }, true);
                });

                // We cannot query permission immediately often without user gesture if 'prompt' is needed.
                // But we can try querying.
                // rootNode is definitely set above
                const perm = await this.rootNode!.handle.queryPermission({ mode: 'read' });
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

    private async restoreLastFile() {
        try {
            const handle = await getDbValue('lastOpenFile') as FileSystemFileHandle | undefined;
            if (handle) {
                // Verify permission for the file (should be inherited from directory usually, or re-verified)
                const hydrator = (window as any).__TEST_hydrateHandle;
                const hydratedHandle = hydrator ? hydrator(handle) : handle;

                const perm = await hydratedHandle.queryPermission({ mode: 'read' });

                if (perm === 'granted') {
                    const file = await hydratedHandle.getFile();
                    const content = await file.text();

                    runInAction(() => {
                        this._currentFileHandle = hydratedHandle;
                        this._isLoading = true;
                    });

                    editorStore.setContent(content);

                    runInAction(() => {
                        this._dirty = false;
                        this._isLoading = false;
                    });

                    // Sync with tree if it's already loaded
                    // rootNode check
                    if (this.rootNode?.children?.length) {
                        await this.syncSelectedFileWithTree();
                    }
                    this.startAutoSave();
                }
            }
        } catch (error) {
            console.error('Error restoring last file:', error);
        }
    }

    private async syncSelectedFileWithTree() {
        if (!this.currentFileHandle) return;

        const findAndReplaceHandle = async (nodes: FileSystemNodeModel[]) => {
            for (const node of nodes) {
                if (node.kind === 'file') {
                    if (await node.handle.isSameEntry(this.currentFileHandle!)) {
                        runInAction(() => {
                            this._currentFileHandle = node.handle as FileSystemFileHandle;
                            this._highlightedPath = node.path;
                        });
                        return true;
                    }
                } else if (node.kind === 'directory' && node.children) {
                    if (await findAndReplaceHandle(node.children)) return true;
                }
            }
            return false;
        };

        if (this.rootNode?.children) {
            await findAndReplaceHandle(this.rootNode.children);
        }
    }

    private async verifyPermission(handle: FileSystemDirectoryHandle, readWrite: boolean = false) {
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
    private async refreshTree(focusPath?: string) {
        if (!this.rootNode) return;

        // This might trigger a prompt if not granted, so it should ideally be called from a user action 
        // if permission is not 'granted'.
        const hasPerm = await this.verifyPermission(this.rootNode.handle);
        if (!hasPerm) return;

        const tree = await this.readDirectory(this.rootNode.handle);
        runInAction(() => {
            // this._fileTree = tree; // No longer used
            if (this._rootNode) {
                this._rootNode.children = tree;
            }
            this.syncSelectedFileWithTree();

            // Handle pending focus
            if (focusPath) {
                const findNode = (nodes: FileSystemNodeModel[]): FileSystemNodeModel | undefined => {
                    for (const node of nodes) {
                        if (node.path === focusPath) return node;
                        if (node.kind === 'directory' && node.children) {
                            const found = findNode(node.children);
                            if (found) return found;
                        }
                    }
                }
                const nodeToFocus = findNode(this.rootNode?.children ?? []);
                if (nodeToFocus) {
                    nodeToFocus.scheduleEffect(() => {
                        nodeToFocus.treeItemRef.current?.focus();
                    });
                }
            }
        });
    }

    private async readDirectory(dirHandle: FileSystemDirectoryHandle, parentPath: string = ''): Promise<FileSystemNodeModel[]> {
        const models: FileSystemNodeModel[] = [];

        for await (const entry of dirHandle.values()) {
            const currentPath = parentPath ? `${parentPath}/${entry.name}` : entry.name;

            if (entry.kind === 'file') {
                models.push(new FileNodeModel({
                    name: entry.name,
                    path: currentPath,
                    kind: 'file',
                    handle: entry
                }));
            } else if (entry.kind === 'directory') {
                if (entry.name.startsWith('.')) continue;
                const children = await this.readDirectory(entry, currentPath);
                const dirModel = new DirectoryNodeModel({
                    name: entry.name,
                    path: currentPath,
                    kind: 'directory',
                    handle: entry,
                    children: children
                });
                models.push(dirModel);
            }
        }

        return models.sort((a, b) => {
            if (a.kind === b.kind) return a.name.localeCompare(b.name);
            return a.kind === 'directory' ? -1 : 1;
        });
    }

    @action
    private setHighlightedPath(path: string | null) {
        this._highlightedPath = path;
    }

    private async loadFileContentInEditor(node: FileSystemNodeModel) {
        if (node.kind !== 'file') return;


        // Auto-save previous file if dirty
        if (this.currentFileHandle && this.dirty) {
            await this.saveFile();
        }

        const fileHandle = node.handle as FileSystemFileHandle;

        // Persist file handle
        await this.pushDbOperation(setDbValue('lastOpenFile', fileHandle), 'Failed to persist file handle:');

        let content = '';
        try {
            const file = await fileHandle.getFile();

            // Check for binary content
            // Read first 1024 bytes
            const slice = file.slice(0, Math.min(file.size, 1024));
            const buffer = await slice.arrayBuffer();
            const view = new Uint8Array(buffer);

            // Heuristic: check for null bytes or other control characters (except common whitespace)
            // Common text control chars: 9 (TAB), 10 (LF), 13 (CR)
            let isBinary = false;
            for (let i = 0; i < view.length; i++) {
                const byte = view[i];
                if (byte === 0) {
                    isBinary = true;
                    break;
                }
                // We could be stricter, but 0x00 is a very strong indicator of binary.
            }

            if (isBinary) {
                const confirm = await dialog.confirm(
                    `The file '${file.name}' appears to be a binary file. Opening it in the editor might display garbage characters or cause the editor to become unresponsive. Do you want to proceed?`,
                    { title: 'Open Binary File?', yesText: 'Open Anyway', noText: 'Cancel' }
                );
                if (!confirm) return;
            }

            content = await file.text();

            // Detect language
            const ext = file.name.split('.').pop()?.toLowerCase() || '';
            editorStore.setLanguage(ext);

        } catch (e) {
            console.error('Failed to read file:', e);
            await dialog.alert('Failed to read file. It might have been moved or deleted.');
            return;
        }

        runInAction(() => {
            this._isLoading = true;
            this._currentFileHandle = fileHandle;
            this._highlightedPath = node.path;
        });

        editorStore.setContent(content);

        runInAction(() => {
            this._dirty = false;
            this._isLoading = false;
        });

        this.startAutoSave();
    }

    private findNodeByHandle(handle: FileSystemHandle): FileSystemNodeModel | undefined {
        const find = (nodes: FileSystemNodeModel[]): FileSystemNodeModel | undefined => {
            for (const node of nodes) {
                if (node.kind === 'file' && node.handle === handle) return node; // Reference check
                // Fallback to isSameEntry not easy sync. 
                if (node.kind === 'directory' && node.children) {
                    const found = find(node.children);
                    if (found) return found;
                }
            }
        }
        // Try async check if reference fails? No, syncSelectedFileWithTree fixes references.
        return find(this.rootNode?.children ?? []);
    }

    private findParentDirectory(targetHandle: FileSystemHandle): FileSystemDirectoryHandle | null {
        if (!this.rootNode) return null;

        const traverse = (nodes: FileSystemNodeModel[]): FileSystemDirectoryHandle | undefined => {
            // Check if target is a child of any node in this list? 
            // Logic in original was: is `nodes` children of `node`? 
            // Original was iterating nodes to check if THEIR children contain target.

            // Wait, original: `findParentRecursive(this.fileTree, targetHandle)`
            // `for (const node of nodes)`
            // `if (node.kind === 'directory' && node.children)`
            // `if (node.children.some(child => child.handle === target))` -> return node.handle

            for (const node of nodes) {
                if (node.kind === 'directory') {
                    if (node.children) {
                        if (node.children.some(child => child.handle === targetHandle)) { // Equality check on handle reference
                            return node.handle;
                        }
                        const found = traverse(node.children);
                        if (found) return found;
                    }
                }
            }
        };

        // Root check
        if (this.rootNode.children?.some(n => n.handle === targetHandle)) {
            return this.rootNode.handle;
        }

        return traverse(this.rootNode.children ?? []) || null;
    }

    private async restoreCollapsedPaths() {
        try {
            const stored = await getDbValue('collapsedPaths') as Set<string> | string[] | undefined;
            if (stored) {
                runInAction(() => {
                    if (Array.isArray(stored)) {
                        this._collapsedPaths = new Set(stored);
                    } else if (stored instanceof Set) {
                        this._collapsedPaths = stored;
                    }
                });
            }
        } catch (e) {
            console.error('Error restoring collapsed paths:', e);
        }
    }

    @action
    private setSearchQuery(query: string) {
        this._searchQuery = query;
    }

    private getPageSize(): number {
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
    private moveHighlight(delta: number) {
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

    private scrollToResult(result: SearchResultItemModel) {
        this.scheduleEffect(() => {
            result.ref.current?.scrollIntoView({ block: 'nearest' });
        });
    }

    @action
    private openHighlighted() {
        const result = this.searchResults.find(r => r.isHighlighted);
        if (result) {
            this.handleSearchResultClick(result.item);
        }
    }

    @action
    private closeSearch() {
        this._isSearchVisible = false;
        this.setSearchQuery('');
    }
}

export const fileSystemStore = new FileSystemStore();

// Expose for testing/debugging
if (typeof window !== 'undefined' && window.__TEST_ENABLE_GLOBALS) {
    window.__TEST_fileSystemStore = fileSystemStore;
}
