import React from 'react';
import { observer } from 'mobx-react-lite';
import { fileSystemStore } from '../store/FileSystemStore';
import { themeStore, appName } from '../store/ThemeStore';

import * as styles from './TitleBar.css';

export const TitleBar: React.FC = observer(() => {
    const fileName = fileSystemStore.currentFileNode?.name || '';
    const isExternal = fileSystemStore.currentFileNode?.kind === 'external_file';
    let fileTooltip: string | undefined = fileSystemStore.currentFileNode?.path || '';
    if (fileName === fileTooltip) fileTooltip = undefined;

    // Check if external - path might be just name
    if (isExternal) {
        fileTooltip = "External file - Auto-save disabled";
    }

    return (
        <header className={styles.header} data-testid="title-bar">
            <div className={styles.leftSection}>
                <h3 className={styles.title}>{appName}</h3>
                <button
                    className={styles.pickDirButton}
                    onClick={(e) => {
                        e.stopPropagation();
                        fileSystemStore.openDirectory();
                    }}
                    title="Open Directory"
                    data-testid="open-directory-button"
                >
                    <i className="fas fa-folder-tree" />
                </button>
                <button
                    className={styles.pickButton}
                    onClick={(e) => {
                        e.stopPropagation();
                        fileSystemStore.openExternalFile();
                    }}
                    title="Open File"
                    data-testid="open-file-button"
                >
                    <i className="fa-solid fa-folder-open" />
                </button>
                <button
                    className={styles.searchFilesButton}
                    onClick={(e) => {
                        e.stopPropagation();
                        fileSystemStore.toggleSearch(e);
                    }}
                    title="Search files (Ctrl + `)"
                    data-testid="search-toggle-button"
                >
                    <i className="fas fa-search" />
                </button>
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
                {isExternal && (
                    <span
                        className={styles.warningIcon}
                        title="External file - Auto-save disabled"
                        data-testid="external-file-warning"
                    >
                        <i className="fa-solid fa-triangle-exclamation"></i>
                    </span>
                )}
                <span
                    className={`${styles.fileName} ${isExternal ? styles.fileNameClickable : ''}`}
                    data-testid="current-filename"
                    title={fileTooltip}
                    onClick={(e) => { e.stopPropagation(); fileSystemStore.handleFileNameClick(); }}
                    style={{ cursor: 'pointer' }}
                >
                    {fileName}
                </span>
                {fileSystemStore.dirty && <span className={styles.dirtyIndicator} data-testid="dirty-indicator">*</span>}

                {isExternal && (
                    <>
                        <button
                            className={styles.actionButton}
                            onClick={(e) => {
                                e.stopPropagation();
                                fileSystemStore.saveFile();
                            }}
                            title="Save"
                            data-testid="external-save-button"
                        >
                            <i className="fa-solid fa-floppy-disk"></i>
                        </button>
                        <button
                            className={styles.actionButton}
                            onClick={(e) => {
                                e.stopPropagation();
                                fileSystemStore.closeExternalFile();
                            }}
                            title="Close"
                            data-testid="external-close-button"
                        >
                            <i className="fa-solid fa-xmark"></i>
                        </button>
                    </>
                )}
            </div>

            <div className={styles.rightSection}>
                <button
                    className={themeStore.theme === 'light' ? styles.themeButtonDark : styles.themeButtonLight}
                    onClick={themeStore.toggleTheme}
                    data-testid="theme-toggle-button"
                >
                    {themeStore.theme === 'light' ? <i className="fa-solid fa-moon"></i> : <i className="fa-regular fa-moon"></i>}
                </button>
                <button
                    className={styles.helpButton}
                    onClick={fileSystemStore.showHelp}
                    title="Help"
                    data-testid="help-button"
                >
                    <i className="fa-solid fa-circle-question"></i>
                </button>
            </div>
        </header >
    );
});
