import React from 'react';
import { observer } from 'mobx-react-lite';
import { fileSystemStore } from '../store/FileSystemStore';
import { themeStore, appName } from '../store/ThemeStore';
import { editorStore } from '../store/EditorStore';
import { dialog } from '../components/Dialog';
import * as styles from './TitleBar.css';

export const TitleBar: React.FC = observer(() => {
    const fileName = fileSystemStore.currentFileHandle
        ? fileSystemStore.currentFileHandle.name
        : '';

    return (
        <header className={styles.header} data-testid="title-bar">
            <div className={styles.leftSection}>
                <h3 className={styles.title}>{appName}</h3>
                <button
                    className={styles.newFileButton}
                    onClick={() => fileSystemStore.createNewFile()}
                    title={`New File in ${fileSystemStore.currentDirectoryPath}`}
                    data-testid="new-file-button-titlebar"
                >
                    <i className="fa-solid fa-file-circle-plus"></i>
                </button>
            </div>

            <div className={styles.centerSection}>
                <span className={styles.fileName} data-testid="current-filename">{fileName}</span>
                {fileSystemStore.dirty && <span className={styles.dirtyIndicator} data-testid="dirty-indicator">*</span>}
            </div>

            <div className={styles.rightSection}>
                <button
                    className={themeStore.theme === 'light' ? styles.themeButtonDark : styles.themeButtonLight}
                    onClick={() => themeStore.toggleTheme()}
                    data-testid="theme-toggle-button"
                >
                    {themeStore.theme === 'light' ? <i className="fa-solid fa-moon"></i> : <i className="fa-regular fa-moon"></i>}
                </button>
                <button
                    className={styles.helpButton}
                    onClick={async () => {
                        const confirmed = await dialog.confirm('Do you want to test the new dialog?', { title: 'Test Dialog', yesText: 'Yes please!', noText: 'No thank you!' });
                        if (confirmed) {
                            await dialog.alert('You clicked OK!', { title: 'Result', icon: 'info' });
                        } else {
                            await dialog.alert('You clicked Cancel!', { title: 'Result', icon: 'warning', okText: 'OK!' });
                        }
                    }}
                    title="Test Dialog"
                    data-testid="dialog-test-button"
                >
                    <i className="fa-solid fa-comment-dots"></i>
                </button>
                <button
                    className={styles.helpButton}
                    onClick={async () => {
                        await fileSystemStore.clearSelection();
                        editorStore.showHelp();
                    }}
                    title="Help"
                    data-testid="help-button"
                >
                    <i className="fa-solid fa-circle-question"></i>
                </button>
            </div>
        </header >
    );
});
