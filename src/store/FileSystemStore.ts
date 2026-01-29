import { observable, action, runInAction, computed } from "mobx";
import { get as getDbValue, set as setDbValue, clear as clearAllDbValues } from 'idb-keyval';
import { Fzf } from 'fzf';
import { editorStore } from './EditorStore';
import { createRef } from "react";
import { EffectAwareModel } from "./EffectAwareModel";
import { dialog } from "../components/Dialog";
import { shouldIgnoreDirectory, shouldIgnoreFile, generateDefaultIgnoreFileContent, resetPatternCache } from '../file_system/IgnoreSettings';
import { DirectoryNodeModel, ExternalFileModel, FileModel, FileNodeModel, FileSystemNodeModel, FileSystemNodeModelBase, SearchResultItemModel } from "./FileSystemModels";
import { traceLog } from "../utils/trace";
import { S3Store } from "./S3Store";

class FileSystemStore extends EffectAwareModel {

    constructor() {
        super();
        this.restoreDirectory();

        // Save on close/refresh
        window.addEventListener('beforeunload', (e) => {
            if (this.dirty) {
                if (this.currentFileNode?.kind === 'file') {
                    this.saveFile(); // Attempt to save (best effort)
                }
                else if (this.currentFileNode?.kind === 'external_file') {
                    // No auto-save. User should save or discard explicitly
                    e.preventDefault();
                    e.returnValue = true;
                }
            }
        });

        // Global Keyboard Shortcuts
        window.addEventListener('keydown', this.handleGlobalKeyDown);
    }

    @action.bound
    markDirty() {
        if (!this.isLoading && this.currentFileHandle) {
            this._dirty = true;
        }
    }

    @observable private accessor _currentFileNode: FileModel | null = null;
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

    @observable accessor s3Stores: Map<string, S3Store> = new Map();

    private saveInterval: number | null = null;

    private loadTimeout: number | null = null;
    private dbOperations: Promise<void>[] = [];

    readonly contextMenuRef = createRef<HTMLDivElement>();

    readonly searchInputRef = createRef<HTMLInputElement>();

    @computed
    get visibleNodes(): FileSystemNodeModel[] {
        const result: FileSystemNodeModel[] = [];
        if (!this.rootNode) return result;
        const traverse = (nodes: FileSystemNodeModel[]) => {
            for (const node of nodes) {
                result.push(node);
                if (node.kind === 'directory' && !this.isCollapsed(node.path) && node.children) {
                    traverse(node.children);
                }
            }
        };
        traverse([this.rootNode]);
        return result;
    }

    @action
    async confirmUnsavedChanges(): Promise<boolean> {
        if (!this.dirty || !this.currentFileNode) return true;

        if (this.currentFileNode.kind === 'external_file') {
            const result = await dialog.confirm(
                `You have unsaved changes in the external file '${this.currentFileNode.name}'. Do you want to save them?`,
                {
                    title: 'Unsaved External File',
                    showCancel: true,
                    yesText: 'Save',
                    noText: 'Discard',
                    cancelText: 'Cancel'
                }
            );

            if (result === true) {
                await this.saveFile();
                return true;
            } else if (result === false) {
                // Discarding
                runInAction(() => {
                    this._dirty = false;
                });
                return true;
            } else {
                // Cancel
                return false;
            }
        }

        return true;
    }

    @action
    async handleFileNameClick() {
        if (!this.currentFileNode) return;
        if (this.currentFileNode.kind === 'external_file') {
            await this.openExternalFile({ revealCurrent: true });
        }
        else {
            await this.focusCurrentFileInSidebar();
        }
    }

    @action
    async openExternalFile(options?: { revealCurrent?: boolean }) {
        // It is expected that the user will use this to open external files.
        // But if it is used to open a file that is already a file node in the sidebar, that should be handled gracefully too.

        const pickerOptions: OpenFilePickerOptions = {};
        if (options?.revealCurrent && this.currentFileHandle) {
            pickerOptions.startIn = this.currentFileHandle;
        }

        const handle = await pickSingleFile(pickerOptions);
        if (!handle) {
            return;
        }
        // We call confirmUnsavedChanges after the user has picked a file.
        // If the user cancels the file pick operation, there is no reason to prompt.
        if (!await this.confirmUnsavedChanges()) return;

        // Check if this file is already in our workspace
        const existingNode = await this.findNodeByHandle(handle);
        if (existingNode && existingNode.kind === 'file') {
            // It's in the workspace, just select it
            this.selectNode(existingNode, { loadContent: 'focus' });
            return;
        }

        // External file
        const externalModel = new ExternalFileModel(handle, handle.name);
        await this.openFileInEditor(externalModel, { focusNode: false, updateHighlight: true });
    }

    @action
    async closeExternalFile() {
        if (!await this.confirmUnsavedChanges()) return;

        // Clearing selection
        await this.clearSelection();
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
        if (!await this.confirmUnsavedChanges()) {
            return;
        }
        const handle = await pickDirectory();
        if (!handle) {
            return;
        }

        await this.pushDbOperation(setDbValue('directoryHandle', handle), 'Failed to persist directory handle:');
        
        const rootHandle = this._rootNode?.handle;
        if (!rootHandle || !await rootHandle.isSameEntry(handle)) {
            runInAction(() => {
                resetPatternCache();
                this._rootNode = new DirectoryNodeModel({
                    name: handle.name,
                    path: '',
                    kind: 'directory',
                    handle: handle,
                    children: []
                }, null);
                this.cleanupS3Stores();
            });
        }
        await this.refresh();
    }

    @action
    async clearDirectory() {
        this._rootNode = null;
        this._currentFileNode = null;
        resetPatternCache();
        this._dirty = false;
        this._isLoading = false;
        this.cleanupS3Stores();
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
    async selectNode(node: FileSystemNodeModelBase, { loadContent, checkExternalUnsaved = false }: { loadContent: 'focus' | 'show' | 'delay'; checkExternalUnsaved?: boolean; }) {
        if (node.kind === 'file' && checkExternalUnsaved) {
            // Guard against losing external file changes only if intended target is a file
            // Selecting a directory is safe
            if (!await this.confirmUnsavedChanges()) return;
        }
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
                    this.openFileInEditor(node, { focusNode: false, updateHighlight: true });
                }, 750);
            } else {
                this.openFileInEditor(node, { focusNode: false, updateHighlight: true }).then(() => {
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
            this.selectNode(visible[0], { loadContent: 'delay', checkExternalUnsaved: true });
            return;
        }

        if (currentIndex === -1) return;

        const currentNode = visible[currentIndex];

        if (direction === 'up') {
            if (currentIndex > 0) {
                this.selectNode(visible[currentIndex - 1], { loadContent: 'delay', checkExternalUnsaved: true });
            }
        } else if (direction === 'down') {
            if (currentIndex < visible.length - 1) {
                this.selectNode(visible[currentIndex + 1], { loadContent: 'delay', checkExternalUnsaved: true });
            }
        } else if (direction === 'left') {
            if (currentNode.kind === 'directory' && !this.isCollapsed(currentNode.path)) {
                // Collapse
                this.toggleDirectory(currentNode.path);
            } else {
                // Move to parent
                const lastSlash = currentNode.path.lastIndexOf('/');
                if (lastSlash !== -1) {
                    const parentPath = currentNode.path.substring(0, lastSlash);
                    const parentNode = visible.find(n => n.path === parentPath);
                    if (parentNode) {
                        this.selectNode(parentNode, { loadContent: 'delay' });
                    }
                } else {
                    // Use parent logic if no slash? It implies it's a child of root (since path = name)
                    // Or if parent is root
                    if (currentNode.parent && currentNode.parent.isRoot) {
                        this.selectNode(currentNode.parent, { loadContent: 'delay' });
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
                        this.selectNode(visible[currentIndex + 1], { loadContent: 'delay', checkExternalUnsaved: true });
                    }
                }
            }
        }
    }

    @action.bound
    async focusCurrentFileInSidebar() {
        const node = this.currentFileNode;
        if (!node) return;

        if (node instanceof ExternalFileModel) return; // Cannot focus external file in sidebar

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

    @action.bound
    async showHelp() {
        if (!await this.confirmUnsavedChanges()) {
            return;
        }
        await this.clearSelection();
    }

    async clearSelection() {
        if (this.currentFileNode?.kind === 'file' && this.dirty) {
            await this.saveFile();
        }

        // Clear persisted handle
        await this.pushDbOperation(setDbValue('lastOpenFile', null), 'failed to clear lastOpenFile');

        runInAction(() => {
            this._currentFileNode = null;
            this._dirty = false;
            this._highlightedPath = null;
        });

        editorStore.showHelp();

        if (this.saveInterval) {
            clearInterval(this.saveInterval);
            this.saveInterval = null;
        }
    }

    async saveFile() {
        if (!this.currentFileHandle) return;

        // For external files, we might not have permission persisted? 
        // FileSystemAccessAPI typically grants permission on open.

        try {
            const writable = await this.currentFileHandle.createWritable();
            await writable.write(editorStore.content);
            await writable.close();
            runInAction(() => {
                this._dirty = false;
            });
            traceLog('Saved file:', this.currentFileHandle.name);
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

            // Disable auto-save for external files
            if (this.currentFileNode instanceof ExternalFileModel) return;

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
    @action
    async editIgnoreFile(directory: DirectoryNodeModel) {
        if (!await this.confirmUnsavedChanges()) {
            return;
        }
        try {
            // Check/Create .adoc-editor folder
            let configDir;
            try {
                configDir = await directory.handle.getDirectoryHandle('.adoc-editor');
            } catch {
                configDir = await directory.handle.getDirectoryHandle('.adoc-editor', { create: true });
            }

            let fileHandle;
            // Check if ignore.toml exists
            try {
                fileHandle = await configDir.getFileHandle('ignore.toml');
            } catch {
                // Ignore doesn't exist, create it
                fileHandle = await configDir.getFileHandle('ignore.toml', { create: true });
                const writable = await fileHandle.createWritable();
                await writable.write(generateDefaultIgnoreFileContent());
                await writable.close();
            }

            // Open as external file
            const externalModel = new ExternalFileModel(fileHandle, 'ignore.toml');
            await this.openFileInEditor(externalModel, { focusNode: false, updateHighlight: true });

        } catch (error) {
            console.error('Failed to edit ignore.toml', error);
        }
    }

    @action
    async createNewFile(parentNode?: DirectoryNodeModel) {
        if (!this.rootNode) {
            await dialog.alert('Please open a directory first.');
            return;
        }
        if (!await this.confirmUnsavedChanges()) {
            return;
        }

        // 1. Determine target directory
        let targetNode: DirectoryNodeModel | null = parentNode || null;

        if (!targetNode) {
            if (this.currentFileNode instanceof FileNodeModel && this.currentFileNode.parent) {
                targetNode = this.currentFileNode.parent;
            } else if (this.rootNode) {
                targetNode = this.rootNode;
            }
        }
        const targetDir = targetNode?.handle || null;

        if (!targetDir || !targetNode) return;

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
            const path = targetNode.isRoot ? filename : targetNode.path + '/' + filename;
            const ghostNode = new FileNodeModel({
                kind: 'file',
                name: filename,
                path: path,
                handle: undefined
            }, targetNode);

            // 5. Add to parent children
            runInAction(() => {
                if (!targetNode!.children) targetNode!.children = [];
                // Reassign to trigger observer
                targetNode!.children = [ghostNode, ...targetNode!.children];

                // Expand parent lineage
                let curr: DirectoryNodeModel | null = targetNode;
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

            ghostNode.copySource = node; // Set source for copying

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

    async createNewDirectory(parentNode?: DirectoryNodeModel) {
        if (!this.rootNode) {
            await dialog.alert('Please open a directory first.');
            return;
        }

        // 1. Determine target directory
        let targetNode: DirectoryNodeModel | null = parentNode || null;

        if (!targetNode) {
            // If we are selecting a directory, create inside it (if permitted?)
            if (this.currentFileNode) {
                if (this.currentFileNode instanceof FileNodeModel && this.currentFileNode.parent) {
                    targetNode = this.currentFileNode.parent;
                }
            } else if (this.highlightedPath) {
                const nodes = this.visibleNodes;
                const highlighted = nodes.find(n => n.path === this.highlightedPath);
                if (highlighted) {
                    if (highlighted.kind === 'directory') {
                        targetNode = highlighted as DirectoryNodeModel;
                    } else {
                        targetNode = highlighted.parent;
                    }
                }
            }

        }
        if (!targetNode) {
            targetNode = this.rootNode;
        }

        const targetDir = targetNode?.handle || null;
        if (!targetDir || !targetNode) return;

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
            const path = targetNode.isRoot ? dirname : targetNode.path + '/' + dirname;
            const ghostNode = new DirectoryNodeModel({
                kind: 'directory',
                name: dirname,
                path: path,
                handle: undefined,
                children: []
            }, targetNode);

            // 4. Add to parent
            runInAction(() => {
                // Expand parent if needed (delete from collapsed)
                this._collapsedPaths.delete(targetNode!.path);

                if (!targetNode!.children) targetNode!.children = [];
                // Reassign to trigger observer
                targetNode!.children = [ghostNode, ...targetNode!.children];

                // Expand parent lineage
                let curr: DirectoryNodeModel | null = targetNode;
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

    async findSiblingFile(node: FileNodeModel, siblingName: string): Promise<FileSystemFileHandle | null> {
        if (node && node.parent) {
            try {
                return await node.parent.handle.getFileHandle(siblingName);
            } catch (e) {
                return null;
            }
        }
        return null; // If node is root (impossible for file?) or no parent
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
                } else if (node.kind === 'directory' && !(this.currentFileNode instanceof ExternalFileModel)) {
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
            await this.refresh(parent?.isRoot ? undefined : parent, parent?.isRoot ? undefined : parent.path, false, 'sidebar');
        } catch (error) {
            console.error('Error deleting node:', error);
            await dialog.alert(`Failed to delete ${node.kind}: ${error}`);
        }
    }

    @action
    async handleF5() {
        // If an external file is open, a file node in the sidebar cannot be currently highlighted
        // It is possible for a directory to be highlighted though.
        // Refreshing any directory without opening an internal file will not lead to a loss of data in an unsaved external file
        // So there is no need to prompt with confirmUnsavedChanges.
        if (this.highlightedPath) {
            const nodes = this.visibleNodes;
            const highlighted = nodes.find(n => n.path === this.highlightedPath);
            if (highlighted?.kind === 'directory') {
                await this.refresh(highlighted, highlighted.path, false, 'none');
                return;
            }
        }
        await this.refresh(undefined, undefined, false, 'none');
    }

    @action
    async refresh(node?: DirectoryNodeModel, focusPath?: string, openFile: boolean = false, focusTarget: 'sidebar' | 'editor' | 'none' = 'none') {
        // Default to root if no node provided
        const targetNode = node || this.rootNode;
        if (!targetNode) return;

        // Verify permission if root (needed?) or simple check
        // For subdirectories, permission is inherited usually.
        const hasPerm = await this.verifyPermission(targetNode.handle);

        if (!hasPerm) return;

        const tree = await this.readDirectory(targetNode);

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
            runInAction(() => {
                this._highlightedPath = nodeToFocus.path;
            });

            if (focusTarget === 'sidebar') {
                if (nodeToFocus.kind === 'directory' || !openFile) {
                    nodeToFocus.scheduleFocusTreeItem();
                } else {
                    // If it's a file and we are opening it, usually editor gets focus unless we explicitly want sidebar
                    nodeToFocus.scheduleFocusTreeItem();
                }
            }

            if (openFile && nodeToFocus.kind === 'file') {
                // Only focus tree item if specifically requested for sidebar
                const focusNode = focusTarget === 'sidebar';
                await this.openFileInEditor(nodeToFocus, { focusNode, updateHighlight: true });

                if (focusTarget === 'editor') {
                    editorStore.focusEditor();
                }
            } else if (focusTarget === 'editor' && nodeToFocus.kind === 'file') {
                // Ensure editor is focused even if not 'opening' (already open?)
                // Pass false to focusNode because we handle editor focus explicitly
                await this.openFileInEditor(nodeToFocus, { focusNode: false, updateHighlight: true });
                editorStore.focusEditor();
            }
        }

        if (this.currentFileNode) {
            // We need to do this because the existing currentFileNode may now no longer be in the tree
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
                    await this.openFileInEditor(fileNode as FileNodeModel, { focusNode: false, updateHighlight: !focusPath });
                }
            }
        }
    }

    @action
    async toggleDirectory(path: string) {
        // Toggling doesn't change file, but if it did... 
        // Actually, toggleDirectory is just expand/collapse. It doesn't select.
        // So this is safe. 
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
    async handleSearchResultClick(item: FileSystemNodeModel) {
        if (!await this.confirmUnsavedChanges()) return;

        // 1. Expand all parents
        let parent = item.parent;
        while (parent && !parent.isRoot) {
            this._collapsedPaths.delete(parent.path);
            parent = parent.parent;
        }

        // 2. Highlight item
        this._highlightedPath = item.path;

        // 3. Scroll into view
        item.scheduleEffect(() => {
            item.treeItemRef.current?.scrollIntoView({ block: 'nearest' });
        });

        if (item.kind === 'file') {
            this.openFileInEditor(item, { focusNode: false, updateHighlight: true }).then(() => {
                editorStore.focusEditor();
            });
        }
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
                traceLog('Skipping directory restoration due to skip_restore flag');
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
                    resetPatternCache();
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

                        // Detect and set language
                        const ext = file.name.split('.').pop()?.toLowerCase() || '';
                        editorStore.setLanguage(ext);
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

    private async readDirectory(dirNode: DirectoryNodeModel): Promise<FileSystemNodeModel[]> {
        const models: FileSystemNodeModel[] = [];
        const parentPath = dirNode.isRoot ? '' : dirNode.path;

        
        await dirNode.readSettings();

        for await (const entry of dirNode.handle.values()) {
            const currentPath = parentPath ? `${parentPath}/${entry.name}` : entry.name;

            if (entry.kind === 'file') {
                if (shouldIgnoreFile(entry.name, dirNode.effIgnoreSettings)) continue;

                models.push(new FileNodeModel({
                    name: entry.name,
                    path: currentPath,
                    kind: 'file',
                    handle: entry
                }, dirNode));
            } else if (entry.kind === 'directory') {
                if (shouldIgnoreDirectory(entry.name, dirNode.effIgnoreSettings)) continue;

                // Create directory model first
                const dirModel = new DirectoryNodeModel({
                    name: entry.name,
                    path: currentPath,
                    kind: 'directory',
                    handle: entry,
                    children: [] // Will set children after
                }, dirNode);

                const children = await this.readDirectory(dirModel);
                dirModel.children = children;

                models.push(dirModel);
            }
        }

        return models.sort((a, b) => {
            if (a.kind === b.kind) return a.name.localeCompare(b.name);
            return a.kind === 'directory' ? -1 : 1;
        });
    }

    async openFileInEditor(node: FileModel, { focusNode, updateHighlight }: { focusNode: boolean; updateHighlight: boolean }) {
        if (node.kind !== 'file' && node.kind !== 'external_file') return;
        // Auto-save previous file if dirty (Internal only)
        if (this.currentFileHandle && this.dirty && !(this.currentFileNode instanceof ExternalFileModel)) {
            await this.saveFile();
        }

        const fileHandle = node.handle;

        // Persist file handle only if internal
        if (node instanceof FileNodeModel) {
            await this.pushDbOperation(setDbValue('lastOpenFile', fileHandle), 'Failed to persist file handle:');
        }

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
        if (focusNode && node instanceof FileNodeModel) {
            node.scheduleFocusTreeItem();
        }
        this.startAutoSave();
    }

    @action
    private loadFileInEditor(node: FileModel, content: string, updateHighlight: boolean = true) {
        this._currentFileNode = node;
        if (updateHighlight) {
            if (node instanceof FileNodeModel) {
                this._highlightedPath = node.path;
            } else {
                this._highlightedPath = null;
            }
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
        // Ctrl + S - Save
        if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
            e.preventDefault();
            this.saveFile();
            return;
        }

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

    @action
    cleanupS3Stores() {
        this.s3Stores.forEach(store => store.cleanup());
        this.s3Stores.clear();
    }
}

async function pickDirectory() {
    try {
        const handle = await window.showDirectoryPicker();
        return handle;
    }
    catch (e) {
        if ((e as any).name !== 'AbortError') {
            console.error('Error opening directory:', e);
        }
        return null;
    }
}

async function pickSingleFile(options?: OpenFilePickerOptions) {
    try {
        const [handle] = await window.showOpenFilePicker(options);
        return handle;
    }
    catch (e) {
        if ((e as any).name !== 'AbortError') {
            console.error('Error opening file:', e);
        }
        return null;
    }
}

export const fileSystemStore = new FileSystemStore();

// Expose for testing/debugging
if (typeof window !== 'undefined' && window.__TEST_ENABLE_GLOBALS) {
    window.__TEST_fileSystemStore = fileSystemStore;
}
