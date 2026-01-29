import { observable, action } from 'mobx';
import { S3Store } from './S3Store';
import { DirectoryNodeModel } from './FileSystemModels';
import { fileSystemStore } from './FileSystemStore';

export type AppMode = 'editor' | 's3sync';

export class AppStore {
    @observable accessor mode: AppMode = 'editor';
    @observable accessor activeSyncDirectoryNode: DirectoryNodeModel | null = null;
    @observable accessor activeSyncStore: S3Store | null = null;

    @action.bound
    async enterS3SyncMode(node: DirectoryNodeModel, s3Store: S3Store) {
        this.activeSyncDirectoryNode = node;
        this.activeSyncStore = s3Store;
        this.mode = 's3sync';
        await s3Store.sync(node);
    }

    @action.bound
    async exitS3SyncMode() {
        this.mode = 'editor';
        const node = this.activeSyncDirectoryNode;
        if (node) {
            this.activeSyncDirectoryNode = null;
            this.activeSyncStore = null;
            await fileSystemStore.refresh(node, node.path);
        }
    }
}

export const appStore = new AppStore();
