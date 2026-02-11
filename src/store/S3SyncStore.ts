import { action, observable, runInAction } from "mobx";
import { DirectoryNodeModel } from "./FileSystemModels";
import { S3Store } from "./S3Store";
import { S3SyncDiffStore } from "./S3SyncDiffStore";
import { FileSyncStatus, scanAndCalculateStatus, directoryPath, fileName, LocalFileRecord, getFileHandle, updateDirectoryUuidMap, saveBaseRecord, getDirectoryHandle } from "./S3SyncLogic";
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

    @observable accessor _selectedItem: FileSyncStatus | null = null;
    get selectedItem() { return this._selectedItem; }

    @observable accessor _syncStatusItems: FileSyncStatus[] | undefined = undefined;
    get syncStatusItems() { return this._syncStatusItems; }

    @action.bound
    async setSelectedItem(item: FileSyncStatus | null) {
        this._selectedItem = item;
        await this.diffStore.loadContent(item);
    }

    /**
     * Start the sync process - scans files and calculates status
     */
    async startSync() {
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
