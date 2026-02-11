import { observer } from 'mobx-react-lite';
import { S3SyncDiffStore } from '../store/S3SyncDiffStore';
import { DiffViewMode, FileStatus } from '../store/S3SyncLogic';
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
        case 'single-base': return 'Base';
        case 'single-local': return 'Local';
        case 'single-remote': return 'Remote';
        default: return 'None';
    }
}

export const S3SyncInfoBar = observer(({ store }: { store: S3SyncDiffStore; }) => {
    const currentView = store.currentView;

    const syncItem = store.syncItem;
    if (!syncItem || !currentView) return null;

    const availableViews = syncItem.availableDiffViews;

    return (
        <div className={styles.container} data-testid="s3sync-infobar">
            <span>View</span>
            <button className={styles.viewButton} data-testid="diff-view-button">
                <span>{getViewLabel(currentView)}</span>
                <i className="fa-solid fa-chevron-down" />
                <ButtonMenu testid="diff-view-menu">
                    <div className={styles.viewMenu}>
                        {availableViews.map((view) => (
                            <button
                                key={view}
                                className={`${styles.viewMenuItem} ${view === currentView ? styles.viewMenuItemActive : ''}`}
                                onClick={() => store.setView(view)}
                                data-testid={`diff-view-option-${view}`}
                            >
                                {getViewLabel(view)}
                            </button>
                        ))}
                    </div>
                </ButtonMenu>
            </button>
            {syncItem.localStatus !== FileStatus.None ?
                <div className={styles.statusGroup}>
                    <span className={styles.statusLabel}>Local:</span>
                    <span className={styles.statusValue}>{getStatusLabel(syncItem.localStatus)}</span>
                    {syncItem.localStatus === FileStatus.New ?
                        <button>Delete</button> : null
                    }
                    {syncItem.localStatus === FileStatus.Deleted ?
                        <button>Restore</button> : null
                    }
                    {syncItem.localStatus === FileStatus.Changed ?
                        <button>Revert</button> : null
                    }
                    {syncItem.localMoved ?
                        <>
                            <span>{syncItem.localMoveDesc}</span>
                            <button>Undo</button>
                        </>
                    : null
                    }
                </div>
                : null
            }
            {syncItem.remoteStatus !== FileStatus.None ?
                <div className={styles.statusGroup}>
                    <span className={styles.statusLabel}>Remote:</span>
                    <span className={styles.statusValue}>{getStatusLabel(syncItem.remoteStatus)}</span>
                    {syncItem.remoteMoved?
                        <span>{syncItem.remoteMoveDesc}</span>
                        : null
                    }
                </div>
                : null
            }
        </div>
    );
});
