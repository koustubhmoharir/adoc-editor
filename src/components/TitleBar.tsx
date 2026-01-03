import React from 'react';
import { observer } from 'mobx-react-lite';
import { fileSystemStore } from '../store/FileSystemStore';
import { themeStore } from '../store/ThemeStore';
import { editorStore } from '../store/EditorStore';
import * as styles from './TitleBar.css';

export const TitleBar: React.FC = observer(() => {
    const fileName = fileSystemStore.currentFileHandle
        ? fileSystemStore.currentFileHandle.name
        : '';

    return (
        <header className={styles.header}>
            <div className={styles.leftSection}>
                <h3 className={styles.title}>AsciiDoc Editor</h3>
                <button
                    className={styles.newFileButton}
                    onClick={() => fileSystemStore.createNewFile()}
                    title={`New File in ${fileSystemStore.currentDirectoryPath}`}
                >
                    <i className="fa-solid fa-file-circle-plus"></i>
                </button>
            </div>

            <div className={styles.centerSection}>
                <span className={styles.fileName}>{fileName}</span>
                {fileSystemStore.dirty && <span className={styles.dirtyIndicator}>*</span>}
            </div>

            <div className={styles.rightSection}>
                <button
                    className={themeStore.theme === 'light' ? styles.themeButtonDark : styles.themeButtonLight}
                    onClick={() => themeStore.toggleTheme()}
                >
                    {themeStore.theme === 'light' ? <i className="fa-solid fa-moon"></i> : <i className="fa-regular fa-moon"></i>}
                </button>
                <button
                    className={styles.helpButton}
                    onClick={async () => {
                        await fileSystemStore.clearSelection();
                        editorStore.showHelp();
                    }}
                    title="Help"
                >
                    <i className="fa-solid fa-circle-question"></i>
                </button>
            </div>
        </header >
    );
});
