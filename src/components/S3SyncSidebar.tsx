import { observer } from 'mobx-react-lite';
import { FileSyncStatus, FileStatus, SyncAction } from '../store/S3SyncLogic';
import { S3SyncStore } from '../store/S3SyncStore';
import * as styles from './S3SyncSidebar.css';

function getStatusIcon(item: FileSyncStatus): { icon: string; className: string; title: string } {
    if (item.isContentConflict || item.isPathConflict) {
        return { icon: 'fa-solid fa-exclamation-triangle', className: styles.statusConflict, title: 'Conflict' };
    }
    if (item.isWarning) {
        return { icon: 'fa-solid fa-exclamation-circle', className: styles.statusWarning, title: 'Warning' };
    }

    // Check for new files
    if (item.localStatus === FileStatus.New && !item.remote) {
        return { icon: 'fa-solid fa-plus', className: styles.statusNew, title: 'New (local)' };
    }
    if (item.remoteStatus === FileStatus.New && !item.local) {
        return { icon: 'fa-solid fa-cloud-arrow-down', className: styles.statusNew, title: 'New (remote)' };
    }

    // Check for deletions
    if (item.localStatus === FileStatus.Deleted) {
        return { icon: 'fa-solid fa-trash', className: styles.statusDeleted, title: 'Deleted (local)' };
    }
    if (item.remoteStatus === FileStatus.Deleted) {
        return { icon: 'fa-solid fa-cloud-xmark', className: styles.statusDeleted, title: 'Deleted (remote)' };
    }

    // Check for changes
    if (item.localStatus === FileStatus.Changed) {
        return { icon: 'fa-solid fa-pen', className: styles.statusChanged, title: 'Modified (local)' };
    }
    if (item.remoteStatus === FileStatus.Changed) {
        return { icon: 'fa-solid fa-cloud', className: styles.statusChanged, title: 'Modified (remote)' };
    }

    // Unchanged
    if (item.localStatus === FileStatus.Unchanged && item.remoteStatus === FileStatus.Unchanged) {
        return { icon: 'fa-solid fa-check', className: styles.statusUnchanged, title: 'Unchanged' };
    }

    return { icon: 'fa-solid fa-question', className: styles.statusWarning, title: 'Unknown' };
}

function getActionLabel(item: FileSyncStatus): string | null {
    if (item.recommendedContentAction === SyncAction.CopyLocalToRemote) {
        return '↑ Upload';
    }
    if (item.recommendedContentAction === SyncAction.CopyRemoteToLocal) {
        return '↓ Download';
    }
    if (item.recommendedContentAction === SyncAction.DeleteLocal) {
        return '× Delete Local';
    }
    if (item.recommendedContentAction === SyncAction.DeleteRemote) {
        return '× Delete Remote';
    }
    return null;
}

export const S3SyncSidebar = observer(({ store }: { store: S3SyncStore }) => {
    const statusItems = store.syncStatusItems;
    const selectedItem = store.selectedItem;
    const prefix = store.s3Store.settings.prefix || '';

    return (
        <div className={styles.sidebar} data-testid="s3sync-sidebar">
            <div className={styles.header}>
                Sync Status
            </div>
            <div className={styles.itemList}>
                {!statusItems && (
                    <div className={styles.loadingState}>
                        <i className="fa-solid fa-spinner fa-spin" />
                        <span>Scanning files...</span>
                    </div>
                )}
                {statusItems && statusItems.length === 0 && (
                    <div className={styles.emptyState}>
                        All files are in sync
                    </div>
                )}
                {(statusItems || []).map((item, index) => {
                    const fileName = item.fileName(prefix);
                    const directoryPath = item.directoryPath(prefix);
                    const status = getStatusIcon(item);
                    const actionLabel = getActionLabel(item);
                    const isSelected = item === selectedItem;

                    return (
                        <div
                            key={index}
                            className={`${styles.item} ${isSelected ? styles.itemSelected : ''}`}
                            onClick={() => store.setSelectedItem(item)}
                            data-testid="s3sync-item"
                            data-item-path={item.relativePath(prefix)}
                            data-selected={isSelected}
                            title={item.relativePath(prefix)}
                        >
                            <i className={`${status.icon} ${styles.statusIcon} ${status.className}`} title={status.title} />
                            <div className={styles.itemContent}>
                                <span className={styles.itemFileName}>{fileName}</span>
                                {directoryPath && (
                                    <span className={styles.itemDirectory}>{directoryPath}</span>
                                )}
                            </div>
                            {actionLabel && (
                                <span className={styles.statusBadge}>{actionLabel}</span>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
});
