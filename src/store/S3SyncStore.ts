import { action, observable, runInAction } from "mobx";
import { DirectoryNodeModel } from "./FileSystemModels";
import { S3Store } from "./S3Store";
import { S3SyncDiffStore } from "./S3SyncDiffStore";
import { FileSyncStatus, S3VersionRecord, scanAndCalculateStatus, directoryPath, fileName, LocalFileRecord, getFileHandle, updateDirectoryUuidMap, saveBaseRecord, getDirectoryHandle, SyncMode, SyncContentAction, SyncPathAction, executeSyncItem, flushPendingChanges, PendingChanges } from "./S3SyncLogic";
import { traceLog } from "../utils/trace";
import { dialog } from "../components/Dialog";

/**
 * Main store for S3 sync mode, holding all related state.
 * Created when entering sync mode and disposed when exiting.
 */
export class S3SyncStore {
    constructor(node: DirectoryNodeModel, s3Store: S3Store) {
        this.directoryNode = node;
        this.s3Store = s3Store;
        this.diffStore = new S3SyncDiffStore(this);
    }

    readonly directoryNode: DirectoryNodeModel;
    readonly s3Store: S3Store;
    readonly diffStore: S3SyncDiffStore;

    @observable private accessor _selectedItem: FileSyncStatus | null = null;
    get selectedItem() { return this._selectedItem; }

    @observable private accessor _syncStatusItems: FileSyncStatus[] | undefined = undefined;
    get syncStatusItems() { return this._syncStatusItems; }

    @observable accessor syncMode: SyncMode = SyncMode.Sync;

    @observable private accessor _isSyncing: boolean = false;
    get isSyncing() { return this._isSyncing; }

    @observable private accessor _cancelRequested: boolean = false;
    get cancelRequested() { return this._cancelRequested; }

    @observable.ref private accessor _syncProgress: Readonly<{ current: number; total: number; currentPath: string }> | null = null;
    get syncProgress() { return this._syncProgress; }

    @action.bound
    setSyncMode(mode: SyncMode) {
        this.syncMode = mode;
        if (this._syncStatusItems) {
            for (const item of this._syncStatusItems) {
                item.isChecked = true;
                item.updateActions(mode);
            }
        }
    }

    @action.bound
    async setSelectedItem(item: FileSyncStatus | null) {
        this._selectedItem = item;
        await this.diffStore.loadContent(item);
    }

    /**
     * Start the sync process - scans files and calculates status
     */
    async calculateStatus() {
        const s3Client = await this.s3Store.ensureClient();
        if (!s3Client) return;
        const settings = this.s3Store.settings;
        try {
            const statusItems = await scanAndCalculateStatus(this.directoryNode, s3Client, settings);
            const prefix = settings.prefix || '';

            runInAction(() => {
                statusItems.sort((a, b) => a.relativePath(prefix).localeCompare(b.relativePath(prefix)));
                this._syncStatusItems = statusItems;
                traceLog(`Sync status calculation complete. Found ${statusItems.length} items.`);
            });
        } catch (e) {
            console.error("Sync failed", e);
            runInAction(() => {
                traceLog(`Sync failed: ${e}`);
            });
        }
    }

    @action.bound
    async executeSyncGo() {
        if (!this._syncStatusItems || this._isSyncing) return;

        const prefix = this.s3Store.settings.prefix;

        // Filter checked items with actionable content or path actions
        const items = this._syncStatusItems.filter(item =>
            item.isChecked && (
                item.contentAction !== SyncContentAction.None ||
                item.pathAction !== SyncPathAction.None
            )
        );

        if (items.length === 0) {
            await dialog.alert('No actionable items selected.');
            return;
        }

        // Validate: block if any checked item has unresolved conflict
        const unresolvedConflicts = items.filter(item =>
            (item.isContentConflict && item.contentAction === SyncContentAction.None) ||
            (item.isPathConflict && item.pathAction === SyncPathAction.None)
        );
        if (unresolvedConflicts.length > 0) {
            const paths = unresolvedConflicts.map(i => i.relativePath(prefix)).join('\n');
            await dialog.alert(`The following items have unresolved conflicts. Please set their actions before syncing:\n${paths}`);
            return;
        }

        const s3Client = await this.s3Store.ensureClient();
        if (!s3Client) return;

        const rootHandle = this.directoryNode.handle;
        const settings = this.s3Store.settings;
        const pending: PendingChanges = {
            baseRecords: new Map(),
            baseFileWrites: new Map(),
            baseFileDeletes: [],
            uuidChanges: new Map(),
        };

        runInAction(() => {
            this._isSyncing = true;
            this._cancelRequested = false;
            this._syncProgress = { current: 0, total: items.length, currentPath: '' };
        });

        const getRemoteContent = (remote: S3VersionRecord) =>
            this.s3Store.getObjectContent(rootHandle, remote, { cachedOnly: false });

        let syncedCount = 0;
        try {
            for (let i = 0; i < items.length; i++) {
                if (this._cancelRequested) {
                    traceLog(`Sync cancelled after ${syncedCount} items.`);
                    break;
                }

                const item = items[i];
                const itemPath = item.relativePath(prefix);

                runInAction(() => {
                    this._syncProgress = { current: i + 1, total: items.length, currentPath: itemPath };
                });

                try {
                    await executeSyncItem(item, s3Client, rootHandle, settings, pending, getRemoteContent);
                    syncedCount++;
                } catch (e) {
                    console.error(`Sync failed for ${itemPath}:`, e);
                    const shouldContinue = await dialog.confirm(
                        `Sync failed for '${itemPath}':\n${e}\n\nContinue with remaining items?`
                    );
                    if (!shouldContinue) {
                        break;
                    }
                }
            }
        } finally {
            // Flush metadata for everything that was synced
            if (syncedCount > 0 || pending.baseRecords.size > 0) {
                try {
                    traceLog('Flushing pending metadata changes...');
                    await flushPendingChanges(rootHandle, pending);
                } catch (e) {
                    console.error('Failed to flush pending changes:', e);
                    await dialog.alert(`Failed to save sync metadata: ${e}`);
                }
            }

            runInAction(() => {
                this._isSyncing = false;
                this._cancelRequested = false;
                this._syncProgress = null;
            });

            traceLog(`Sync complete. ${syncedCount}/${items.length} items synced.`);
        }
    }

    @action.bound
    requestCancel() {
        this._cancelRequested = true;
    }

    private async updateItemStatus(item: FileSyncStatus, newLocal: LocalFileRecord | null) {
        const prefix = this.s3Store.settings.prefix || '';

        const newSyncItem = await FileSyncStatus.create(item.base, newLocal, item.remote, prefix);

        await runInAction(async () => {
            if (this._syncStatusItems) {
                const index = this._syncStatusItems.indexOf(item);
                if (index !== -1) {
                    this._syncStatusItems[index] = newSyncItem;
                }
            }
            if (this._selectedItem === item) {
                await this.setSelectedItem(newSyncItem);
            }
        });
    }

    @action.bound
    async deleteLocalFile(item: FileSyncStatus) {
        if (!item.local) return;

        const confirmed = await dialog.confirm(`Are you sure you want to delete '${item.local?.handle.name}'?`);
        if (!confirmed) return;

        const prefix = this.s3Store.settings.prefix || '';
        const relPath = item.relativePath(prefix);

        const parent = directoryPath(relPath);
        const name = fileName(relPath);

        let parentHandle = await getDirectoryHandle(this.directoryNode.handle, parent);
        if (!parentHandle) {
            console.error("Could not find parent directory for deletion");
            return;
        }

        try {
            await parentHandle.removeEntry(name);
        } catch (e) {
            console.error("Failed to delete file", e);
            await dialog.alert("Failed to delete file: " + e);
        }
        await this.updateItemStatus(item, null);
    }

    @action.bound
    async restoreLocalFile(item: FileSyncStatus) {
        if (!item.base) return;

        const prefix = this.s3Store.settings.prefix;
        // It is possible that base path and local path are different
        const localRelPath = item.relativePath(prefix);
        const baseRelPath = item.base.key.substring(prefix.length);
        const basePath = `.s3/b/${baseRelPath}`;
        const localName = fileName(localRelPath);
        const localDirPath = directoryPath(localRelPath);

        try {
            const root = this.directoryNode.handle;
            // Get base file handle
            const baseHandle = await getFileHandle(root, basePath);
            if (!baseHandle) {
                await dialog.alert("Could not find base file to restore from.");
                return;
            }

            const file = await baseHandle.getFile();

            // Get/Create target parent directory
            const parentHandle = await getDirectoryHandle(root, localDirPath, { create: true });

            if (!parentHandle) {
                await dialog.alert("Could not create directory to restore file.");
                return;
            }

            // Create/Overwrite target file
            const targetHandle = await parentHandle.getFileHandle(localName, { create: true });
            const writable = await targetHandle.createWritable();
            await file.stream().pipeTo(writable);

            // Update UUID map in target directory
            await updateDirectoryUuidMap(parentHandle, { [localName]: item.base.uuid });

            // Get new file stats
            const newFile = await targetHandle.getFile();
            const lastModifiedLocal = new Date(newFile.lastModified).toISOString();

            // Update base record metadata
            item.base.lastModifiedLocal = lastModifiedLocal;
            await saveBaseRecord(this.directoryNode, baseRelPath, { lastModifiedLocal: lastModifiedLocal });

            // Construct Local Record
            const newLocal: LocalFileRecord = {
                uuid: item.base.uuid,
                key: item.local?.key ?? item.base.key,
                contentLength: newFile.size,
                lastModified: lastModifiedLocal,
                handle: targetHandle,
                sha256: item.base.sha256 // Assume match since we just copied it
            };

            await this.updateItemStatus(item, newLocal);

        } catch (e) {
            console.error("Failed to restore file", e);
            await dialog.alert("Failed to restore file: " + e);
        }
    }

    @action.bound
    async revertLocalFile(item: FileSyncStatus) {
        if (!item.base) return;

        const confirmed = await dialog.confirm(`Are you sure you want to revert '${item.relativePath(this.s3Store.settings.prefix || '')}' to its base version? This will discard local changes.`);
        if (!confirmed) return;

        return this.restoreLocalFile(item);
    }

    @action.bound
    async undoLocalMove(item: FileSyncStatus) {
        if (!item.local || !item.base) return;
        if (!item.localMoved) return;

        const prefix = this.s3Store.settings.prefix;
        const oldRelPath = item.local.key.substring(prefix.length); // Current path
        const newRelPath = item.base.key.substring(prefix.length); // Original (base) path
        const oldName = fileName(oldRelPath);
        const newName = fileName(newRelPath);
        const oldParentPath = directoryPath(oldRelPath);
        const newParentPath = directoryPath(newRelPath);

        const root = this.directoryNode.handle;
        const oldParentHandle = await getDirectoryHandle(root, oldParentPath);

        // 1. Ensure target directory (base path) exists
        const targetDir = await getDirectoryHandle(root, newParentPath, { create: true });

        if (!oldParentHandle || !targetDir) {
            await dialog.alert("Could not access directory.");
            return;
        }
        try {
            // 2. Move file
            const handle = item.local.handle as any;
            if (typeof handle.move === 'function') {
                await handle.move(targetDir, newName);
            } else {
                await dialog.alert("your browser does not support moving files. Please use Chrome or Edge.");
                return;
            }

            // 3. Update UUID maps
            if (oldParentPath === newParentPath) {
                // Rename in same directory
                await updateDirectoryUuidMap(oldParentHandle, {
                    [oldName]: null,
                    [newName]: item.base.uuid
                });
            } else {
                // Move to different directory
                await updateDirectoryUuidMap(oldParentHandle, { [oldName]: null });
                await updateDirectoryUuidMap(targetDir, { [newName]: item.base.uuid });
            }

            // 4. Update Status
            // Get new file stats from the *same* handle (it points to the moved file now)
            const file = await item.local.handle.getFile();

            const newLocal: LocalFileRecord = {
                uuid: item.base.uuid,
                key: item.base.key,
                contentLength: file.size,
                lastModified: new Date(file.lastModified).toISOString(),
                handle: item.local.handle,
                sha256: item.local.sha256 // undo move just moves the file. The content is preserved (so sha256 of local is same as old local).
            };

            // Update base record metadata
            item.base.lastModifiedLocal = newLocal.lastModified;
            await saveBaseRecord(this.directoryNode, newRelPath, { lastModifiedLocal: newLocal.lastModified });

            await this.updateItemStatus(item, newLocal);

        } catch (e) {
            console.error("Failed to undo move", e);
            await dialog.alert("Failed to undo move: " + e);
        }

    }
}
