import { observable, action } from 'mobx';
import { S3SyncStore } from './S3SyncStore';
import { S3Store } from './S3Store';
import { DirectoryNodeModel } from './FileSystemModels';
import { fileSystemStore } from './FileSystemStore';

export type AppMode = 'editor' | 's3sync';

export class AppStore {
    @observable accessor mode: AppMode = 'editor';
    @observable accessor activeSyncStore: S3SyncStore | null = null;

    @action.bound
    async enterS3SyncMode(node: DirectoryNodeModel, s3Store: S3Store) {
        const syncStore = new S3SyncStore(node, s3Store);
        this.activeSyncStore = syncStore;
        this.mode = 's3sync';
        await syncStore.calculateStatus();
    }

    @action.bound
    async exitS3SyncMode() {
        this.mode = 'editor';
        const syncStore = this.activeSyncStore;
        if (syncStore) {
            const node = syncStore.directoryNode;
            this.activeSyncStore = null;
            await fileSystemStore.refresh(node, node.path);
        }
    }
}

export const appStore = new AppStore();
