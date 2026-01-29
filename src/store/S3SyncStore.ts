import { DirectoryNodeModel } from "./FileSystemModels";
import { S3Store } from "./S3Store";
import { S3SyncDiffStore } from "./S3SyncDiffStore";

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

    /**
     * Start the sync process - scans files and calculates status
     */
    async startSync() {
        await this.s3Store.sync(this.directoryNode);
    }
}
