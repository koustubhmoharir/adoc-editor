import React from 'react';
import { observer } from 'mobx-react-lite';
import { appStore } from '../store/AppStore';
import { DiffViewMode } from '../store/S3SyncDiffStore';
import { FileStatus } from '../store/S3SyncLogic';
import { ButtonMenu } from './Popovers';
import * as styles from './S3SyncInfoBar.css';

function getStatusLabel(status: FileStatus): string {
    switch (status) {
        case FileStatus.New: return 'New';
        case FileStatus.Changed: return 'Modified';
        case FileStatus.Unchanged: return 'Unchanged';
        case FileStatus.Deleted: return 'Deleted';
        default: return 'Unknown';
    }
}

function getViewLabel(view: DiffViewMode): string {
    switch (view) {
        case 'base-local': return 'Base ↔ Local';
        case 'base-remote': return 'Base ↔ Remote';
        case 'remote-local': return 'Remote ↔ Local';
        case '3way': return '3-Way';
        case 'single-base': return 'Base Only';
        case 'single-local': return 'Local Only';
        case 'single-remote': return 'Remote Only';
        default: return 'None';
    }
}

export const S3SyncInfoBar: React.FC = observer(() => {
    const syncStore = appStore.activeSyncStore;
    const s3Store = syncStore?.s3Store;
    const diffStore = syncStore?.diffStore;
    const selectedItem = s3Store?.selectedItem;
    const currentView = diffStore?.currentView;

    if (!selectedItem) {
        return (
            <div className={styles.container} data-testid="s3sync-infobar">
                <span className={styles.emptyState}>Select a file to view details</span>
            </div>
        );
    }

    const availableViews = selectedItem.availableDiffViews as DiffViewMode[];

    return (
        <div className={styles.container} data-testid="s3sync-infobar">
            <div className={styles.statusGroup}>
                <span className={styles.statusLabel}>Local:</span>
                <span className={styles.statusValue}>{getStatusLabel(selectedItem.localStatus)}</span>
            </div>
            <div className={styles.statusGroup}>
                <span className={styles.statusLabel}>Remote:</span>
                <span className={styles.statusValue}>{getStatusLabel(selectedItem.remoteStatus)}</span>
            </div>
            <div className={styles.spacer} />
            {diffStore && availableViews.length > 0 && (
                <button className={styles.viewButton} data-testid="diff-view-button">
                    <span>{currentView ? getViewLabel(currentView) : 'View'}</span>
                    <i className="fa-solid fa-chevron-down" />
                    <ButtonMenu testid="diff-view-menu">
                        <div className={styles.viewMenu}>
                            {availableViews.map((view) => (
                                <button
                                    key={view}
                                    className={`${styles.viewMenuItem} ${view === currentView ? styles.viewMenuItemActive : ''}`}
                                    onClick={() => diffStore.setView(view)}
                                    data-testid={`diff-view-option-${view}`}
                                >
                                    {getViewLabel(view)}
                                </button>
                            ))}
                        </div>
                    </ButtonMenu>
                </button>
            )}
        </div>
    );
});
