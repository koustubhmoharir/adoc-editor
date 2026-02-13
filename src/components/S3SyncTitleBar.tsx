import { observer } from 'mobx-react-lite';
import { themeStore, appName } from '../store/ThemeStore';
import { appStore } from '../store/AppStore';
import * as styles from './S3SyncTitleBar.css';

import { SyncMode } from '../store/S3SyncLogic';
import { S3SyncStore } from '../store/S3SyncStore';

export const S3SyncTitleBar = observer(({ store }: { store: S3SyncStore }) => {
    const directoryNode = store.directoryNode;
    const s3Store = store.s3Store;

    const directoryPath = directoryNode?.name || '';
    const bucket = s3Store.settings.bucket || '';
    const prefix = s3Store.settings.prefix || '';

    const isSyncing = store.isSyncing;
    const cancelRequested = store.cancelRequested;
    const progress = store.syncProgress;
    const hasItems = (store.syncStatusItems?.length ?? 0) > 0;

    return (
        <header className={styles.header} data-testid="s3sync-title-bar">
            <div className={styles.leftSection}>
                <h3 className={styles.title}>{appName}</h3>
                <div className={styles.modeSelector}>
                    <select
                        className={styles.modeSelect}
                        value={store.syncMode}
                        onChange={(e) => store.setSyncMode(e.target.value as SyncMode)}
                        disabled={isSyncing}
                    >
                        <option value={SyncMode.Sync}>Sync</option>
                        <option value={SyncMode.MirrorLocal}>Mirror Local</option>
                        <option value={SyncMode.MirrorRemote}>Mirror Remote</option>
                    </select>
                </div>
                {isSyncing ?
                    <>
                        <button
                            className={styles.goButton}
                            onClick={store.requestCancel}
                            disabled={cancelRequested}
                            data-testid="sync-cancel-button"
                        >
                            {cancelRequested ? 'Finishing...' : 'Cancel'}
                        </button>
                        {progress &&
                            <span>
                                <span className={styles.syncInfoLabel}>Syncing {progress.current}/{progress.total}:</span>
                                <span className={styles.syncInfoValue}>{progress.currentPath}</span>
                                {progress.concurrencyErrors > 0 &&
                                    <span className={styles.syncInfoLabel}> ({progress.concurrencyErrors} conflict{progress.concurrencyErrors > 1 ? 's' : ''})</span>
                                }
                            </span>
                        }
                    </>
                    :
                    <button
                        className={styles.goButton}
                        onClick={store.executeSyncGo}
                        disabled={!hasItems}
                        data-testid="sync-go-button"
                    >
                        Go
                    </button>
                }
            </div>

            <div className={styles.centerSection}>
                <div className={styles.syncInfo}>
                    <span>
                        <span className={styles.syncInfoLabel}>Directory:</span>
                        <span className={styles.syncInfoValue}>{directoryPath}</span>
                    </span>
                    <span>
                        <span className={styles.syncInfoLabel}>Bucket:</span>
                        <span className={styles.syncInfoValue}>{bucket}</span>
                    </span>
                    {prefix && (
                        <span>
                            <span className={styles.syncInfoLabel}>Prefix:</span>
                            <span className={styles.syncInfoValue}>{prefix}</span>
                        </span>
                    )}
                </div>
            </div>

            <div className={styles.rightSection}>
                <button
                    className={styles.exitButton}
                    onClick={appStore.exitS3SyncMode}
                    disabled={isSyncing}
                    data-testid="exit-sync-button"
                >
                    <i className="fa-solid fa-xmark" />
                    Exit Sync
                </button>
                <button
                    className={themeStore.theme === 'light' ? styles.themeButtonDark : styles.themeButtonLight}
                    onClick={themeStore.toggleTheme}
                    data-testid="theme-toggle-button"
                >
                    {themeStore.theme === 'light' ? <i className="fa-solid fa-moon" /> : <i className="fa-regular fa-moon" />}
                </button>
            </div>
        </header>
    );
});
