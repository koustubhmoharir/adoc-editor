import { observable, action, runInAction, computed } from "mobx";
import { get as getDbValue, set as setDbValue, clear as clearAllDbValues } from 'idb-keyval';
import { Fzf } from 'fzf';
import { editorStore } from './EditorStore';
import { createRef } from "react";
import { EffectAwareModel } from "./EffectAwareModel";
import { dialog } from "../components/Dialog";

interface FSHandleTypes {
    file: FileSystemFileHandle;
    directory: FileSystemDirectoryHandle;
}

// type FSHandleType<Kind extends 'file' | 'directory'> = Kind extends 'file' ? FileSystemFileHandle : Kind extends 'directory' ? FileSystemDirectoryHandle : FileSystemFileHandle | FileSystemDirectoryHandle;

export interface FileSystemNodeDataBase<Kind extends 'file' | 'directory' = 'file' | 'directory'> {
    kind: Kind;
    name: string;
    path: string;
    handle?: FSHandleTypes[Kind];
}

export type FileNodeData = FileSystemNodeDataBase<'file'>;

export interface DirectoryNodeData extends FileSystemNodeDataBase<'directory'> {
    children?: FileSystemNodeModel[];
}

export abstract class FileSystemNodeModelBase<Kind extends 'file' | 'directory' = 'file' | 'directory'> extends EffectAwareModel {

    constructor(data: FileSystemNodeDataBase<Kind>, parent: DirectoryNodeModel | null) {
        super();
        this.kind = data.kind;
        this._name = data.name;
        this._path = data.path;
        this._handle = data.handle;
        this.parent = parent;
    }

    readonly kind: Kind;
    isFile(): this is FileNodeModel { return this.kind === 'file'; }
    isDirectory(): this is DirectoryNodeModel { return this.kind === 'directory'; }

    @observable private accessor _path: string;
    get path() { return this._path; }

    @observable protected accessor _handle: FSHandleTypes[Kind] | undefined;
    get handle() {
        if (!this._handle) throw new Error("Accessing handle of a ghost node");
        return this._handle;
    }

    // Derived property to check if it's a ghost node
    get isCreating() { return this._handle === undefined; }

    readonly parent: DirectoryNodeModel | null;
    get isRoot() { return this.parent == null; }

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

        if (this.isCreating) {
            // Remove self from parent
            if (this.parent) {
                const children = this.parent.children || [];
                const idx = children.indexOf(this as any);
                if (idx !== -1) {
                    children.splice(idx, 1);
                    this.parent.children = [...children]; // Trigger observer update if needed

                    // Revert highlight and focus to parent OR source if it was a duplicate
                    let handled = false;
                    if (this.isFile() && this.copySource) {
                        // Attempt to focus source
                        fileSystemStore.focusNodeByHandle(this.copySource);
                        handled = true;
                    }

                    if (!handled) {
                        fileSystemStore.selectNode(this.parent, 'show');
                    }
                }
            }
        } else {
        }
    }

    scheduleFocusTreeItem() {
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
            if (!this.renameValue || (this.renameValue === this.name && !this.isCreating)) {
                this.cancelRenaming();
                return;
            }

            if (this.isCreating) {
                const success = await this.createRealNode(this.renameValue);
                if (!success) {
                    this.renameInputRef.current?.focus();
                }
            } else {
                const success = await this.rename(this.renameValue);
                // If rename is successful, the store refreshes the tree, so this model instance might be discarded.
                if (!success) {
                    this.renameInputRef.current?.focus();
                }
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

    @action.bound
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

    @action.bound
    handleRenameInputBlur(_e: React.FocusEvent) {
        // If the window loses focus (e.g. alt-tab), we want to KEEP renaming state.
        // If the click is inside the app but outside input, we want to COMMIT.
        // We do NOT want to restore focus to the tree item, because the user likely clicked something else.
        if (document.hasFocus() && !dialog.isOpen) {
            this.commitRenaming();
        }
    }

    @action.bound
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

    @action.bound
    handleClick(e: React.MouseEvent) {
        e.stopPropagation();
        if (!this.isRenaming) {
            fileSystemStore.selectNode(this, 'show');
        }
    }

    @action.bound
    handleDoubleClick(e: React.MouseEvent) {
        e.stopPropagation();
        if (!this.isRenaming) {
            if (this.kind === 'directory') {
                fileSystemStore.toggleDirectory(this.path);
            } else {
                fileSystemStore.selectNode(this, 'focus');
            }
        }
    }

    abstract handleSpecificKey(e: React.KeyboardEvent | KeyboardEvent): void;

    @action
    private async createRealNode(finalName: string): Promise<boolean> {
        if (!this.parent) return false;

        // Validation (reuse logic?)
        // Simply check if name is valid and unique in parent

        try {
            // 1. Validation similar to rename
            if (!finalName || /^[\.]+$/.test(finalName)) {
                // Invalid name for creation -> keep editing? or cancel? 
                // If creation, maybe we should alert and let user try again.
                return false;
            }

            // Check existence
            try {
                await this.parent.handle.getFileHandle(finalName);
                if (this.kind === 'file') {
                    await dialog.alert(`File '${finalName}' already exists.`);
                    return false;
                }
            } catch (e) {
                // Good, logic continues
            }
            try {
                await this.parent.handle.getDirectoryHandle(finalName);
                if (this.kind === 'directory') {
                    await dialog.alert(`Directory '${finalName}' already exists.`);
                    return false;
                }
            } catch (e) { /* Good */ }

            // 2. Create
            let self: FileSystemNodeModelBase = this; // TypeScript hack to get type assertion functions below to work
            if (self.isFile()) {
                self._handle = await this.parent.handle.getFileHandle(finalName, { create: true });

                // If this is a duplicate operation, copy content
                if (self.copySource) {
                    try {
                        const sourceFile = await self.copySource.getFile();
                        // Check for binary? For now just copy blob/text
                        // stream() is robust for large files
                        const writable = await self._handle.createWritable();
                        await writable.write(await sourceFile.text());
                        await writable.close();
                    } catch (err) {
                        console.error("Failed to copy content", err);
                        await dialog.alert(`Failed to copy content from source file: ${err}`);
                    }
                    self.copySource = undefined;
                }

            } else if (self.isDirectory()) {
                self._handle = await this.parent.handle.getDirectoryHandle(finalName, { create: true });
            }

            this._name = finalName;
            // Update path - although refreshTree will fix it, we want local consistency
            if (this.parent && this.parent.isRoot) {
                this._path = finalName;
            } else if (this.parent) {
                this._path = this.parent.path + '/' + finalName;
            }

            // 3. Finish
            this._isRenaming = false;

            // Refresh tree to ensure sync and proper sorting
            await fileSystemStore.refresh(this.parent?.isRoot ? undefined : this.parent, this._path, true);

            return true;
        } catch (e) {
            console.error("Creation failed", e);
            await dialog.alert(`Creation failed: ${e}`);
            return false;
        }
    }

    @action
    private async rename(newName: string): Promise<boolean> {
        if (this.isRoot) return false;

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
        if (!finalName || /^[\.]+$/.test(finalName)) {
            this.cancelRenaming();
            return true;
        }

        // 3. Validation
        const unsafeAsciiRegex = /[<>:"/\\|?*]/;
        const printableAsciiRegex = /^[\x20-\x7E]$/;
        const unicodeWordRegex = /^[\p{L}\p{N}]$/u;

        for (const char of finalName) {
            if (this.name.includes(char)) continue;

            if (printableAsciiRegex.test(char)) {
                if (unsafeAsciiRegex.test(char)) {
                    await dialog.alert(`Invalid character: ${char}`);
                    return false;
                }
            } else {
                if (!unicodeWordRegex.test(char)) {
                    await dialog.alert(`Invalid character: ${char}`);
                    return false;
                }
            }
        }

        const parentDir = this.parent?.handle;
        if (!parentDir) {
            await dialog.alert('Cannot find parent directory.');
            return false;
        }

        // 4. Uniqueness Check
        let conflict = false;
        try {
            for await (const entry of parentDir.values()) {
                if (entry.name === this.name) continue; // self
                if (entry.name.toLowerCase() === finalName.toLowerCase()) {
                    conflict = true;
                    break;
                }
            }
        } catch (e) {
            console.warn('Error checking siblings', e);
        }

        if (conflict) {
            await dialog.alert(`A ${this.kind} with the name "${finalName}" already exists (case-insensitive). Please use a different name.`);
            return false;
        }

        // 5. Execute Rename
        const handle = this.handle;
        if ('move' in handle) {
            try {
                await (handle.move as any)(parentDir, finalName);

                // Determine new path to set pending focus
                const parentPath = this.path.substring(0, this.path.lastIndexOf('/'));
                const newPath = parentPath ? `${parentPath}/${finalName}` : finalName;

                // Refresh the parent directory
                const parentNode = this.parent;
                await fileSystemStore.refresh(parentNode?.isRoot ? undefined : parentNode as DirectoryNodeModel, newPath);
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
}

export class FileNodeModel extends FileSystemNodeModelBase<'file'> {
    constructor(data: FileNodeData, parent: DirectoryNodeModel) {
        super(data, parent);
    }

    // Temporary storage for the handle to copy from when creating a duplicate
    copySource?: FileSystemFileHandle;

    @action
    handleSpecificKey(e: React.KeyboardEvent | KeyboardEvent) {
        if (e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            fileSystemStore.selectNode(this, 'focus');
        }
    }
}

export class DirectoryNodeModel extends FileSystemNodeModelBase<'directory'> {

    constructor(data: DirectoryNodeData, parent: DirectoryNodeModel | null) {
        super(data, parent);
        this.children = data.children;
    }
    @observable accessor children: FileSystemNodeModel[] | undefined;

    @action
    handleSpecificKey(e: React.KeyboardEvent | KeyboardEvent) {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            e.stopPropagation();
            fileSystemStore.toggleDirectory(this.path);
        }
    }

    @action.bound
    handleToggleClick(e: React.MouseEvent) {
        e.stopPropagation();
        // If not selected, select it as well? User request says: "Clicking it should toggle and select (if not already selected)."
        if (fileSystemStore.highlightedPath !== this.path) {
            fileSystemStore.selectNode(this, 'show');
        }
        fileSystemStore.toggleDirectory(this.path);
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
        editorStore.setDirty = action(() => {
            if (!this.isLoading && this.currentFileHandle) {
                this._dirty = true;
            }
        });

        // Save on close/refresh
        window.addEventListener('beforeunload', () => {
            if (this.dirty && this.currentFileHandle) {
                this.saveFile(); // Attempt to save (best effort)
            }
        });

        // Global Keyboard Shortcuts
        // Global Keyboard Shortcuts
        window.addEventListener('keydown', this.handleGlobalKeyDown);
    }

    @observable private accessor _currentFileNode: FileNodeModel | null = null;
    get currentFileNode() { return this._currentFileNode; }
    get currentFileHandle() { return this._currentFileNode?.handle ?? null; }

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

    @observable private accessor _sidebarWidth: number = 250;
    get sidebarWidth() { return this._sidebarWidth; }

    @action
    setSidebarWidth(width: number) {
        this._sidebarWidth = width;
    }

    @action.bound
    handleSidebarResizeStart(e: React.MouseEvent) {
        e.preventDefault();
        const startX = e.clientX;
        const startWidth = this.sidebarWidth;

        const handleMouseMove = action((mmE: MouseEvent) => {
            const delta = mmE.clientX - startX;
            const newWidth = Math.max(150, startWidth + delta);
            this.setSidebarWidth(newWidth);
        });

        const handleMouseUp = () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };

        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);
    }

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

    @action.bound
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
                }, null);
            });
            await this.pushDbOperation(setDbValue('directoryHandle', handle), 'Failed to persist directory handle:');
            await this.refresh();
        } catch (error) {
            console.error('Error opening directory:', error);
        }
    }

    @action
    async clearDirectory() {
        this._rootNode = null;
        this._currentFileNode = null;
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
        this._highlightedPath = node.path;

        if (loadContent !== 'focus') {
            node.scheduleFocusTreeItem();
        }

        if (this.loadTimeout) {
            window.clearTimeout(this.loadTimeout);
            this.loadTimeout = null;
        }

        if (node instanceof FileNodeModel) {
            if (loadContent === 'delay') {
                // Debounce load
                this.loadTimeout = window.setTimeout(() => {
                    this.openFileInEditor(node, false);
                }, 750);
            } else {
                this.openFileInEditor(node, false).then(() => {
                    if (loadContent === 'focus') {
                        editorStore.focusEditor();
                    }
                });
            }
        }
    }

    // Handlers moved to Node models


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
        const node = this.currentFileNode;
        if (!node) return;

        // Expand all parents
        const parts = node.path.split('/');
        parts.pop(); // Remove file itself

        let currentPath = '';
        runInAction(() => {
            this._highlightedPath = node.path;
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
            this._currentFileNode = null;
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
        if (!this.currentFileNode) return this.rootNode.name;

        const path = this.currentFileNode.path;
        const lastSlash = path.lastIndexOf('/');

        if (lastSlash === -1) {
            return this.rootNode.name;
        }

        const relativeDir = path.substring(0, lastSlash);
        return `${this.rootNode.name}/${relativeDir}`;
    }

    async createNewFile(parentDirectory?: FileSystemDirectoryHandle) {
        if (!this.rootNode) {
            await dialog.alert('Please open a directory first.');
            return;
        }

        // 1. Determine target directory
        let targetDir: FileSystemDirectoryHandle | null | undefined = parentDirectory;
        let parentNode: DirectoryNodeModel | null = null;

        if (!targetDir) {
            if (this.currentFileNode && this.currentFileNode.parent) {
                targetDir = this.currentFileNode.parent.handle;
                parentNode = this.currentFileNode.parent;
            }
            if (!targetDir && this.rootNode) {
                targetDir = this.rootNode.handle;
                parentNode = this.rootNode;
            }
        } else {
            // Find model for this directory handle
            parentNode = await this.findNodeByHandle(targetDir) as DirectoryNodeModel;
        }

        if (!targetDir || !parentNode) return;

        // 2. Auto-save current file
        if (this.dirty) {
            await this.saveFile();
        }

        try {
            // 3. Find unique filename
            let index = 1;
            // Determine extension
            let ext = '.adoc';
            if (this.currentFileHandle) {
                const parts = this.currentFileHandle.name.split('.');
                if (parts.length > 1) ext = '.' + parts.pop();
            }

            let filename = `new-${index}${ext}`;
            while (true) {
                try {
                    await targetDir.getFileHandle(filename);
                    // If successful, file exists
                    index++;
                    filename = `new-${index}${ext}`;
                } catch (e) {
                    // File does not exist (or other error), so we can use this name
                    break;
                }
            }

            // 4. Create Ghost Node
            const path = parentNode.isRoot ? filename : parentNode.path + '/' + filename;
            const ghostNode = new FileNodeModel({
                kind: 'file',
                name: filename,
                path: path,
                handle: undefined
            }, parentNode);

            // 5. Add to parent children
            runInAction(() => {
                if (!parentNode!.children) parentNode!.children = [];
                // Reassign to trigger observer
                parentNode!.children = [ghostNode, ...parentNode!.children];

                // Expand parent lineage
                let curr: DirectoryNodeModel | null = parentNode;
                while (curr && !curr.isRoot) {
                    this._collapsedPaths.delete(curr.path);
                    curr = curr.parent;
                }

                // Highlight the new ghost node
                this._highlightedPath = ghostNode.path;
            });

            // 6. Start renaming
            ghostNode.startRenaming();

            // Scroll to it
            ghostNode.scheduleEffect(() => {
                ghostNode.treeItemRef.current?.scrollIntoView({ block: 'nearest' });
            });

        } catch (error) {
            console.error('Error creating new file:', error);
            await dialog.alert('Failed to create new file.');
        }
    }

    async duplicateNode(node: FileNodeModel) {
        if (!node.parent) {
            await dialog.alert('Cannot duplicate root or orphaned node.');
            return;
        }

        const parentDir = node.parent.handle;
        if (!parentDir) return;

        // Auto-save if needed (though we copy FROM disk usually)
        if (this.dirty && this.currentFileNode === node) {
            await this.saveFile();
        }

        try {
            // 1. Find unique filename
            const originalName = node.name;
            const lastDot = originalName.lastIndexOf('.');
            let namePart = originalName;
            let extPart = '';
            if (lastDot > 0) {
                namePart = originalName.substring(0, lastDot);
                extPart = originalName.substring(lastDot);
            }

            // Start from 2
            let index = 2;
            let newName = `${namePart}-${index}${extPart}`;

            // Check existence in parent's loaded children if possible, or verify against disk
            // Verifying against disk is safer
            while (true) {
                try {
                    await parentDir.getFileHandle(newName);
                    // Exists
                    index++;
                    newName = `${namePart}-${index}${extPart}`;
                } catch (e) {
                    // Does not exist
                    break;
                }
            }

            // 2. Create Ghost Node
            const path = node.parent.isRoot ? newName : node.parent.path + '/' + newName;

            const ghostNode = new FileNodeModel({
                kind: 'file',
                name: newName,
                path: path,
                handle: undefined
            }, node.parent);

            ghostNode.copySource = node.handle; // Set source for copying

            // 3. Add to parent children
            runInAction(() => {
                const parentNode = node.parent!;
                if (!parentNode.children) parentNode.children = [];

                // Insert after the original node if possible? Or at top?
                // Standard behavior often places it next to original or sorted. 
                // Since our list is sorted by name usually, inserting at top or pushing might be resorted later.
                // Let's put it at top for visibility as per "New File" logic, or tries to find index.
                // "New File" puts at top. Let's do that for consistency with ghost nodes.
                parentNode.children = [ghostNode, ...parentNode.children];

                // Highlight
                this._highlightedPath = ghostNode.path;
            });

            // 4. Start renaming
            ghostNode.startRenaming();

            // Scroll
            ghostNode.scheduleEffect(() => {
                ghostNode.treeItemRef.current?.scrollIntoView({ block: 'nearest' });
            });

        } catch (err) {
            console.error('Error duplicating file:', err);
            await dialog.alert('Failed to duplicate file.');
        }
    }

    async createNewDirectory(parentDirectory?: FileSystemDirectoryHandle) {
        if (!this.rootNode) {
            await dialog.alert('Please open a directory first.');
            return;
        }

        // 1. Determine target directory
        let targetDir: FileSystemDirectoryHandle | null | undefined = parentDirectory;
        let parentNode: DirectoryNodeModel | null = null;

        if (!targetDir) {
            // If we are selecting a directory, create inside it (if permitted?)
            // Logic for new directory usually: if directory selected, create inside? 
            // If file selected, create in same folder.

            // Current logic uses parent of current file, or root.
            if (this.currentFileNode) {
                if (this.currentFileNode.parent) {
                    targetDir = this.currentFileNode.parent.handle;
                    parentNode = this.currentFileNode.parent;
                }
            } else if (this.highlightedPath) {
                // If directory is highlighted, create inside? 
                // The requirements are not super specific on "where", but "New Directory" usually works in current context.
                // Let's stick to existing logic for consistency or improve.
                const nodes = this.visibleNodes;
                const highlighted = nodes.find(n => n.path === this.highlightedPath);
                if (highlighted) {
                    if (highlighted.kind === 'directory') {
                        targetDir = highlighted.handle; // Create INSIDE the highlighted directory
                        parentNode = highlighted as DirectoryNodeModel;
                    } else {
                        targetDir = highlighted.parent?.handle;
                        parentNode = highlighted.parent;
                    }
                }
            }

            if (!targetDir && this.rootNode) {
                targetDir = this.rootNode.handle;
                parentNode = this.rootNode;
            }
        } else {
            parentNode = await this.findNodeByHandle(targetDir) as DirectoryNodeModel;
        }

        if (!targetDir || !parentNode) return;

        try {
            // 2. Find unique name
            let index = 1;
            let dirname = `new-folder-${index}`;
            while (index < 1000) {
                try {
                    await targetDir.getDirectoryHandle(dirname);
                    // If successful, exists
                    index++;
                    dirname = `new-folder-${index}`;
                } catch (e) {
                    break;
                }
            }

            if (index >= 1000) {
                await dialog.alert('Could not find a unique name for new directory.');
                return;
            }

            // 3. Create Ghost Node
            const path = parentNode.isRoot ? dirname : parentNode.path + '/' + dirname;
            const ghostNode = new DirectoryNodeModel({
                kind: 'directory',
                name: dirname,
                path: path,
                handle: undefined,
                children: []
            }, parentNode);

            // 4. Add to parent
            runInAction(() => {
                // Expand parent if needed (delete from collapsed)
                this._collapsedPaths.delete(parentNode!.path);

                if (!parentNode!.children) parentNode!.children = [];
                // Reassign to trigger observer
                parentNode!.children = [ghostNode, ...parentNode!.children];

                // Expand parent lineage
                let curr: DirectoryNodeModel | null = parentNode;
                while (curr && !curr.isRoot) {
                    this._collapsedPaths.delete(curr.path);
                    curr = curr.parent;
                }

                // Highlight the new ghost node
                this._highlightedPath = ghostNode.path;
            });

            // 5. Start renaming
            ghostNode.startRenaming();

            ghostNode.scheduleEffect(() => {
                ghostNode.treeItemRef.current?.scrollIntoView({ block: 'nearest' });
            });

        } catch (error) {
            console.error('Error creating new directory:', error);
            await dialog.alert('Failed to create new directory.');
        }
    }

    async findSiblingFile(handle: FileSystemFileHandle, siblingName: string): Promise<FileSystemFileHandle | null> {
        const node = await this.findNodeByHandle(handle);
        if (node && node.parent) {
            try {
                return await node.parent.handle.getFileHandle(siblingName);
            } catch (e) {
                return null;
            }
        }
        return null;
    }

    async deleteNode(node: FileSystemNodeModelBase) {
        const parentDir = node.parent?.handle;
        if (!parentDir) {
            if (node.isRoot) {
                await dialog.alert('Cannot delete root directory.');
                return;
            }
            await dialog.alert('Cannot search parent directory needed for deletion.');
            return;
        }

        try {
            // Clear selection if deleted file was active (or if active file was inside deleted directory)
            // If we delete a directory, we need to check if currentFileHandle is inside it.
            if (this.currentFileNode) {
                // If deleted node is file and matches
                if (node === this.currentFileNode) {
                    await this.clearSelection();
                } else if (node.kind === 'directory') {
                    // Check if current file is child of deleted directory
                    // We can check path prefix?
                    if (this.highlightedPath && this.highlightedPath.startsWith(node.path + '/')) {
                        await this.clearSelection();
                    }
                }
            }
            await parentDir.removeEntry(node.name, { recursive: node.kind === 'directory' });

            // Refresh the parent directory
            const parent = node.parent;
            await this.refresh(parent?.isRoot ? undefined : parent, parent?.isRoot ? undefined : parent.path);
        } catch (error) {
            console.error('Error deleting node:', error);
            await dialog.alert(`Failed to delete ${node.kind}: ${error}`);
        }
    }

    @action
    async handleF5() {
        if (this.highlightedPath) {
            const nodes = this.visibleNodes;
            const highlighted = nodes.find(n => n.path === this.highlightedPath);
            if (highlighted?.kind === 'directory') {
                await this.refresh(highlighted, highlighted.path);
                return;
            }
        }
        await this.refresh();
    }

    @action
    async refresh(node?: DirectoryNodeModel, focusPath?: string, openFile: boolean = false) {
        // Default to root if no node provided
        const targetNode = node || this.rootNode;
        if (!targetNode) return;

        // Verify permission if root (needed?) or simple check
        // For root, we generally already checked, but let's be safe.
        // For subdirectories, permission is inherited usually.
        const hasPerm = await this.verifyPermission(targetNode.handle);
        if (!hasPerm) return;

        const pathBase = targetNode.isRoot ? '' : targetNode.path;
        const tree = await this.readDirectory(targetNode.handle, targetNode, pathBase);

        runInAction(() => {
            targetNode.children = tree;
        });

        // Handle pending focus - RECURSIVE search from targetNode
        let nodeToFocus: FileSystemNodeModel | undefined = undefined;
        if (focusPath) {
            const findNode = (n: FileSystemNodeModel): FileSystemNodeModel | undefined => {
                if (n.path === focusPath) return n;
                if (n.kind === 'directory' && n.children) {
                    for (const cn of n.children) {
                        const found = findNode(cn);
                        if (found) return found;
                    }
                }
            }
            nodeToFocus = findNode(targetNode);
        }
        if (nodeToFocus) {
            if (nodeToFocus.kind === 'directory') {
                runInAction(() => {
                    this._highlightedPath = nodeToFocus.path;
                });
                nodeToFocus.scheduleFocusTreeItem();
            }
            else if (openFile && nodeToFocus.kind === 'file') {
                await this.openFileInEditor(nodeToFocus, true);
            }
        }

        if (this.currentFileHandle) {
            const fileNode = await this.findNodeByHandle(this.currentFileHandle);
            if (fileNode) {
                // Ensure we only reload/re-bind if the file is actually within the scope of what we refreshed.
                // If we refreshed a subdirectory, and the file is outside, we shouldn't touch it.
                const isRelevant = targetNode.isRoot || fileNode.path.startsWith(targetNode.path + '/');
                if (isRelevant) {
                    runInAction(() => {
                        this._currentFileNode = fileNode as FileNodeModel;
                        // Only move highlight if we didn't explicitly focus something else
                        if (!focusPath) {
                            this._highlightedPath = fileNode.path;
                        }
                    });
                    // Always reload content but DON'T override highlight if we are focusing a specific path (e.g. directory refresh)
                    await this.openFileInEditor(fileNode, false, !focusPath);
                }
            }
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

    @action.bound
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
        this.openFileInEditor(item, false).then(() => {
            editorStore.focusEditor();
        });
        this.closeSearch();
    }

    @action.bound
    handleSearchChange(e: React.ChangeEvent<HTMLInputElement>) {
        this.setSearchQuery(e.target.value);
    }

    @action.bound
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
                    }, null);
                });

                // We cannot query permission immediately often without user gesture if 'prompt' is needed.
                // But we can try querying.
                // rootNode is definitely set above
                const perm = await this.rootNode!.handle.queryPermission({ mode: 'read' });
                if (perm === 'granted') {
                    await this.refresh();
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

                    const node = await this.findNodeByHandle(hydratedHandle);

                    // Sync with tree if it's already loaded
                    // rootNode check
                    if (node?.kind === 'file') {
                        runInAction(() => {
                            this._currentFileNode = node as FileNodeModel;
                        });
                        this.loadFileInEditor(node, content);
                    }
                    this.startAutoSave();
                }
            }
        } catch (error) {
            console.error('Error restoring last file:', error);
        }
    }

    private async findNodeByHandle(handle: FileSystemHandle | null) {
        if (!handle) return null;

        if (this.currentFileNode && await this.currentFileNode.handle.isSameEntry(handle)) {
            return this.currentFileNode;
        }

        if (this.rootNode && await this.rootNode.handle.isSameEntry(handle)) {
            return this.rootNode;
        }

        const findRecursive = async (nodes: FileSystemNodeModel[]): Promise<FileSystemNodeModel | null> => {
            for (const node of nodes) {
                if (node.isCreating) continue;
                if (await node.handle.isSameEntry(handle)) {
                    return node;
                }
                if (node.kind === 'directory' && node.children) {
                    const foundNode = await findRecursive(node.children);
                    if (foundNode) return foundNode;
                }
            }
            return null;
        };

        if (this.rootNode?.children) {
            return await findRecursive(this.rootNode.children);
        }
        return null;
    }



    async focusNodeByHandle(handle: FileSystemHandle) {
        const node = await this.findNodeByHandle(handle);
        if (node) {
            this.selectNode(node, 'show');
        } else {
            // Fallback to root or something?
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

    private async readDirectory(dirHandle: FileSystemDirectoryHandle, parent: DirectoryNodeModel, parentPath: string = ''): Promise<FileSystemNodeModel[]> {
        const models: FileSystemNodeModel[] = [];

        for await (const entry of dirHandle.values()) {
            const currentPath = parentPath ? `${parentPath}/${entry.name}` : entry.name;

            if (entry.kind === 'file') {
                models.push(new FileNodeModel({
                    name: entry.name,
                    path: currentPath,
                    kind: 'file',
                    handle: entry
                }, parent));
            } else if (entry.kind === 'directory') {
                if (entry.name.startsWith('.')) continue;

                // Create directory model first
                const dirModel = new DirectoryNodeModel({
                    name: entry.name,
                    path: currentPath,
                    kind: 'directory',
                    handle: entry,
                    children: [] // Will set children after
                }, parent);

                const children = await this.readDirectory(entry, dirModel, currentPath);
                dirModel.children = children;

                models.push(dirModel);
            }
        }

        return models.sort((a, b) => {
            if (a.kind === b.kind) return a.name.localeCompare(b.name);
            return a.kind === 'directory' ? -1 : 1;
        });
    }

    private async openFileInEditor(node: FileSystemNodeModel, focusNode: boolean, updateHighlight: boolean = true) {
        if (node.kind !== 'file') return;
        // Auto-save previous file if dirty
        if (this.currentFileHandle && this.dirty) {
            await this.saveFile();
        }

        const fileHandle = node.handle;

        // Persist file handle
        await this.pushDbOperation(setDbValue('lastOpenFile', fileHandle), 'Failed to persist file handle:');

        let content = '';
        try {
            const file = await fileHandle.getFile();

            // Check for binary content
            const slice = file.slice(0, Math.min(file.size, 1024));
            const buffer = await slice.arrayBuffer();
            const view = new Uint8Array(buffer);

            let isBinary = false;
            for (let i = 0; i < view.length; i++) {
                const byte = view[i];
                if (byte === 0) {
                    isBinary = true;
                    break;
                }
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

        // Update Store State
        this.loadFileInEditor(node, content, updateHighlight);
        if (focusNode) {
            node.scheduleFocusTreeItem();
        }
        this.startAutoSave();
    }

    @action
    private loadFileInEditor(node: FileNodeModel, content: string, updateHighlight: boolean = true) {
        this._currentFileNode = node;
        if (updateHighlight) {
            this._highlightedPath = node.path;
        }
        this._isLoading = true;
        editorStore.setContent(content);
        this._dirty = false;
        this._isLoading = false;
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

    private handleGlobalKeyDown = (e: KeyboardEvent) => {
        // F5 - Refresh
        if (e.key === 'F5') {
            e.preventDefault();
            this.handleF5();
            return;
        }

        // Ctrl + Backtick - Search
        if ((e.ctrlKey || e.metaKey) && (e.code === 'Backquote' || e.key === '`')) {
            e.preventDefault();
            e.stopPropagation();
            this.toggleSearch();
        }
    }
}

export const fileSystemStore = new FileSystemStore();

// Expose for testing/debugging
if (typeof window !== 'undefined' && window.__TEST_ENABLE_GLOBALS) {
    window.__TEST_fileSystemStore = fileSystemStore;
}
