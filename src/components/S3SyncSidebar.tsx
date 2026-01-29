import React from 'react';
import { observer } from 'mobx-react-lite';
import { appStore } from '../store/AppStore';
import { FileSyncStatus, FileStatus, SyncAction } from '../store/S3SyncLogic';
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

export const S3SyncSidebar: React.FC = observer(() => {
    const syncStore = appStore.activeSyncStore;
    const statusItems = syncStore?.syncStatusItems;
    const prefix = syncStore?.settings.prefix || '';

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
                    const relativePath = item.relativePath(prefix);
                    const status = getStatusIcon(item);
                    const actionLabel = getActionLabel(item);

                    return (
                        <div
                            key={index}
                            className={styles.item}
                            data-testid="s3sync-item"
                            data-item-path={relativePath}
                            title={relativePath}
                        >
                            <i className={`${status.icon} ${styles.statusIcon} ${status.className}`} title={status.title} />
                            <span className={styles.itemPath}>{relativePath}</span>
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
