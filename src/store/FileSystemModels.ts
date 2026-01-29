import { observable, action, runInAction } from "mobx";
import { createRef } from "react";
import { EffectAwareModel } from "./EffectAwareModel";
import { dialog } from "../components/Dialog";
import { CompiledIgnoreSettings, DEFAULT_COMPILED_SETTINGS, mergeSettings } from '../file_system/IgnoreSettings';
import { fileSystemStore } from "./FileSystemStore";
import { areSettingsEqual, defaultS3SyncContent, parseS3SyncSettings } from "../file_system/S3SyncSettings";
import { parse as parseToml } from 'smol-toml';
import { S3Store } from "./S3Store";
import { traceLog } from "../utils/trace";

interface FSHandleTypes {
    file: FileSystemFileHandle;
    directory: FileSystemDirectoryHandle;
}

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
                    if (this.isFile() && this.copySource) {
                        // Attempt to focus source
                        fileSystemStore.selectNode(this.copySource, { loadContent: 'show' });
                        this.copySource.scheduleFocusTreeItem();
                    }
                    else {
                        fileSystemStore.selectNode(this.parent, { loadContent: 'show' });
                        this.parent.scheduleFocusTreeItem();
                    }
                }
            }
        } else {
            // Just cancelled rename of existing item -> restore focus to self
            fileSystemStore.selectNode(this, { loadContent: 'show' });
            this.scheduleFocusTreeItem();
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
    async handleContextMenu(e: React.MouseEvent) {
        e.preventDefault();
        e.stopPropagation();

        // We don't check unsaved changes on external files if this is for a directory.
        // Focusing a directory does not touch the editor.
        // The menu item handlers for a directory should be guarded with confirmUnsavedChanges where appropriate.
        if (this.kind === 'file') {
            if (!(await fileSystemStore.confirmUnsavedChanges())) {
                return;
            }
        }

        runInAction(() => {
            if (!this.isRoot && fileSystemStore.highlightedPath !== this.path) {
                fileSystemStore.selectNode(this, { loadContent: 'show' });
            }

            fileSystemStore.openContextMenu(this);
        });
    }

    @action.bound
    async handleClick(e: React.MouseEvent) {
        e.stopPropagation();
        if (!this.isRenaming) {
            if (this.kind === 'file') {
                if (!(await fileSystemStore.confirmUnsavedChanges())) {
                    return;
                }
            }
            fileSystemStore.selectNode(this, { loadContent: 'show' });
        }
    }

    @action.bound
    async handleDoubleClick(e: React.MouseEvent) {
        e.stopPropagation();
        if (!this.isRenaming) {
            if (this.kind === 'directory') {
                fileSystemStore.toggleDirectory(this.path);
            } else {
                if (!(await fileSystemStore.confirmUnsavedChanges())) {
                    return;
                }
                fileSystemStore.selectNode(this, { loadContent: 'focus' });
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
                        const sourceFile = await self.copySource.handle.getFile();
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
            const focusTarget = this.kind === 'file' ? 'editor' : 'sidebar';
            await fileSystemStore.refresh(this.parent?.isRoot ? undefined : this.parent, this._path, true, focusTarget);

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
                await fileSystemStore.refresh(parentNode?.isRoot ? undefined : parentNode as DirectoryNodeModel, newPath, false, 'sidebar');
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

    // Temporary storage for the model to copy from when creating a duplicate
    copySource?: FileNodeModel;

    @action
    handleSpecificKey(e: React.KeyboardEvent | KeyboardEvent) {
        if (e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            // We don't need to check unsaved external file because this item should never have been focused if unsaved external file is present
            fileSystemStore.selectNode(this, { loadContent: 'focus' });
        }
    }
}

export class DirectoryNodeModel extends FileSystemNodeModelBase<'directory'> {

    constructor(data: DirectoryNodeData, parent: DirectoryNodeModel | null) {
        super(data, parent);
        this.children = data.children;
    }
    @observable accessor children: FileSystemNodeModel[] | undefined;
    effIgnoreSettings: CompiledIgnoreSettings = DEFAULT_COMPILED_SETTINGS;
    @observable accessor hasS3SyncConfig: boolean = false;

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
            fileSystemStore.selectNode(this, { loadContent: 'show' });
        }
        fileSystemStore.toggleDirectory(this.path);
    }

    @action.bound
    async editS3SyncFile() {
        if (!await fileSystemStore.confirmUnsavedChanges()) {
            return;
        }
        try {
            // Check/Create .adoc-editor folder
            let configDir;
            try {
                configDir = await this.handle.getDirectoryHandle('.adoc-editor');
            } catch {
                configDir = await this.handle.getDirectoryHandle('.adoc-editor', { create: true });
            }

            let fileHandle;
            try {
                fileHandle = await configDir.getFileHandle('s3sync.toml');
            } catch {
                fileHandle = await configDir.getFileHandle('s3sync.toml', { create: true });
                const writable = await fileHandle.createWritable();
                await writable.write(defaultS3SyncContent());
                await writable.close();
            }

            // Open as external file
            const externalModel = new ExternalFileModel(fileHandle, 's3sync.toml');
            await fileSystemStore.openFileInEditor(externalModel, { focusNode: false, updateHighlight: true });

        } catch (error) {
            console.error('Failed to edit s3sync.toml', error);
            await dialog.alert(`Failed to edit s3sync.toml: ${error}`);
        }
    }

    async readSettings() {
        // 1. Calculate Settings
        let ignoreSettings = this.isRoot ? DEFAULT_COMPILED_SETTINGS : (this.parent?.effIgnoreSettings || DEFAULT_COMPILED_SETTINGS);

        let configDir: FileSystemDirectoryHandle | undefined = undefined;
        try {
            configDir = await this.handle.getDirectoryHandle('.adoc-editor');
        } catch (e) {
            // Ignore missing config
        }
        if (configDir) {
            ignoreSettings = await parseIgnoreSettings(configDir, ignoreSettings);

            const s3Stores = fileSystemStore.s3Stores;
            await this.loadS3SyncSettings(configDir, s3Stores);
        }

        this.effIgnoreSettings = ignoreSettings;
    }

    private async loadS3SyncSettings(configDir: FileSystemDirectoryHandle, s3Stores: Map<string, S3Store>) {
        try {
            const configFile = await configDir.getFileHandle('s3sync.toml');
            const file = await configFile.getFile();
            const content = await file.text();

            const settings = parseS3SyncSettings(content);

            runInAction(() => {
                this.hasS3SyncConfig = true;

                let existingStore = s3Stores.get(this.path);

                // If store exists, check if settings changed
                if (existingStore) {
                    if (!areSettingsEqual(existingStore.settings, settings)) {
                        existingStore.cleanup();
                        const newStore = new S3Store(settings);
                        s3Stores.set(this.path, newStore);
                        traceLog(`Re-configured S3Store for ${this.path}`);
                    }
                } else {
                    const newStore = new S3Store(settings);
                    s3Stores.set(this.path, newStore);
                    traceLog(`Created S3Store for ${this.path}`);
                }
            });

        } catch (e) {
            // No config found or error reading it
            runInAction(() => {
                this.hasS3SyncConfig = false;
                if (s3Stores.has(this.path)) {
                    s3Stores.get(this.path)?.cleanup();
                    s3Stores.delete(this.path);
                    console.log(`Removed S3Store for ${this.path}`);
                }
            });
        }
    }

    @action.bound
    async syncDirectory() {
        let configDir: FileSystemDirectoryHandle | undefined = undefined;
        try {
            configDir = await this.handle.getDirectoryHandle('.adoc-editor');
        } catch (e) {
            return;
        }
        const s3Stores = fileSystemStore.s3Stores;
        await this.loadS3SyncSettings(configDir, s3Stores);

        const store = s3Stores.get(this.path);
        if (!store) {
            // Should not happen if hasS3SyncConfig is true
            await dialog.alert("No valid S3 configuration found.");
            return;
        }
        // Refresh to ensure tree is up-to-date for scanning
        await fileSystemStore.refresh(this);
        await store.sync(this);
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

export class ExternalFileModel {
    constructor(
        public readonly handle: FileSystemFileHandle,
        public readonly name: string
    ) { }

    readonly kind = 'external_file';

    get path() { return this.name; }
}

export type FileModel = FileNodeModel | ExternalFileModel;

async function parseIgnoreSettings(configDir: FileSystemDirectoryHandle, baseIgnoreSettings: CompiledIgnoreSettings) {
    try {
        const configFile = await configDir.getFileHandle('ignore.toml');
        const file = await configFile.getFile();
        const text = await file.text();
        const localSettings = parseToml(text);
        baseIgnoreSettings = mergeSettings(baseIgnoreSettings, localSettings as any);
    } catch (e) {
        // Ignore missing config
    }
    return baseIgnoreSettings;
}
