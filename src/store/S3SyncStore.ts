import { action, observable, runInAction } from "mobx";
import { DirectoryNodeModel } from "./FileSystemModels";
import { S3Store } from "./S3Store";
import { S3SyncDiffStore } from "./S3SyncDiffStore";
import { FileSyncStatus, scanAndCalculateStatus } from "./S3SyncLogic";
import { traceLog } from "../utils/trace";

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
}
