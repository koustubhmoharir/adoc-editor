import React from 'react';
import { observer } from 'mobx-react-lite';
import { themeStore, appName } from '../store/ThemeStore';
import { appStore } from '../store/AppStore';
import * as styles from './S3SyncTitleBar.css';

export const S3SyncTitleBar: React.FC = observer(() => {
    const syncStore = appStore.activeSyncStore;
    const directoryNode = syncStore?.directoryNode;
    const s3Store = syncStore?.s3Store;

    const directoryPath = directoryNode?.name || '';
    const bucket = s3Store?.settings.bucket || '';
    const prefix = s3Store?.settings.prefix || '';


    return (
        <header className={styles.header} data-testid="s3sync-title-bar">
            <div className={styles.leftSection}>
                <h3 className={styles.title}>{appName}</h3>
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
