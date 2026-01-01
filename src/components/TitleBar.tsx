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
            </div>

            <div className={styles.centerSection}>
                <span className={styles.fileName}>{fileName}</span>
                {fileSystemStore.dirty && <span className={styles.dirtyIndicator}>*</span>}
            </div>

            <div className={styles.rightSection}>
                <button
                    className={styles.button}
                    onClick={async () => {
                        await fileSystemStore.clearSelection();
                        editorStore.showHelp();
                    }}
                    title="Help"
                >
                    Help
                </button>
                <button className={styles.button} onClick={() => themeStore.toggleTheme()}>
                    {themeStore.theme === 'light' ? '🌙' : '☀️'}
                </button>
            </div>
        </header >
    );
});
