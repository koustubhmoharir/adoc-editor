import React from 'react';
import { observer } from 'mobx-react-lite';
import { fileSystemStore, FileNodeModel } from '../store/FileSystemStore';
import * as styles from './Sidebar.css';
import { useScheduledEffects } from '../hooks/useScheduledEffects';

const FileTreeItem: React.FC<{ node: FileNodeModel }> = observer(({ node }) => {
    const isSelected = fileSystemStore.currentFileHandle === node.handle;
    const isRenaming = node.isRenaming;

    // Consume effects after every render
    useScheduledEffects(node);

    if (node.kind === 'file') {
        return (
            <div
                ref={node.treeItemRef}
                className={`${styles.fileItem} ${isSelected ? styles.selected : ''}`}
                onClick={() => {
                    if (!isRenaming) fileSystemStore.selectFile(node);
                }}
                onKeyDown={(e) => node.handleTreeItemKeyDown(e)}
                tabIndex={isSelected ? 0 : -1} // Enable keyboard focus/events
                data-testid="file-item"
                data-file-path={node.path}
            >
                {isSelected ? (
                    isRenaming ?
                        <button key="accept-rename-button"
                            className={styles.acceptButton}
                            onClick={(e) => {
                                e.stopPropagation();
                                node.commitRenaming();
                            }}
                            title="Accept Rename"
                            data-testid="accept-rename-button"
                        >
                            <i className="fas fa-check" />
                        </button>
                        :
                        <button key="rename-button"
                            className={styles.renameButton}
                            onClick={(e) => {
                                e.stopPropagation();
                                node.startRenaming();
                            }}
                            title="Rename (F2)"
                            data-testid="rename-button"
                        >
                            <i className="fas fa-pencil" />
                        </button>) :
                    <i className={`fas fa-file-lines ${styles.icon} ${styles.fileIcon}`} />
                }

                {isRenaming ? (
                    <input
                        ref={node.renameInputRef}
                        className={styles.renameInput}
                        data-testid="rename-input"
                        value={node.renameValue}
                        onChange={(e) => node.setRenameValue(e.target.value)}
                        onKeyDown={(e) => node.handleRenameInputKeyDown(e)}
                        onClick={(e) => e.stopPropagation()}
                        onBlur={() => {
                            node.handleRenameInputBlur();
                        }}
                    />
                ) : (
                    <span>{node.name}</span>
                )}

                {isRenaming ? null : isSelected && (
                    <button
                        className={styles.deleteButton}
                        onClick={(e) => {
                            e.stopPropagation();
                            node.delete();
                        }}
                        title="Delete (Del)"
                        data-testid="delete-button"
                    >
                        <i className="fas fa-trash-alt" />
                    </button>
                )}
            </div>
        );
    }

    const isCollapsed = fileSystemStore.isCollapsed(node.path);

    const toggle = (e: React.MouseEvent) => {
        e.stopPropagation();
        fileSystemStore.toggleDirectory(node.path);
    };

    return (
        <div className={styles.directoryContainer}>
            <div
                className={styles.directoryItem}
                onClick={toggle}
                data-testid="directory-item"
                data-dir-path={node.path}
            >
                <i className={`fas ${isCollapsed ? 'fa-folder' : 'fa-folder-open'} ${styles.icon} ${styles.folderIcon}`} />
                <span>{node.name}</span>
                <button
                    className={styles.newFileButton}
                    onClick={(e) => {
                        e.stopPropagation();
                        fileSystemStore.createNewFile(node.handle as FileSystemDirectoryHandle);
                    }}
                    title={`New File in ${fileSystemStore.directoryHandle?.name}/${node.path}`}
                    data-testid="new-file-button-nested"
                >
                    <i className="fas fa-file-circle-plus" />
                </button>
            </div>
            {!isCollapsed && node.children && node.children.map((child, i) => (
                <FileTreeItem key={i} node={child} />
            ))}
        </div>
    );
});

export const Sidebar: React.FC = observer(() => {
    // Consume store effects
    useScheduledEffects(fileSystemStore);

    const hasDirectory = !!fileSystemStore.directoryHandle;

    return (
        <div className={styles.sidebar}>
            {hasDirectory && (
                <div
                    className={styles.header}
                    title={fileSystemStore.directoryHandle?.name}
                    onClick={() => fileSystemStore.openDirectory()}
                    data-testid="sidebar-header"
                >
                    <i className={`fas fa-folder-open ${styles.icon} ${styles.folderIcon}`} />
                    <span className={styles.headerText}>{fileSystemStore.directoryHandle?.name}</span>

                    <button
                        className={styles.searchToggleButton}
                        onClick={(e) => fileSystemStore.toggleSearch(e)}
                        title="Search files"
                        data-testid="search-toggle-button"
                    >
                        <i className="fas fa-search" />
                    </button>

                    <button
                        className={styles.newFileButton}
                        onClick={(e) => {
                            e.stopPropagation();
                            fileSystemStore.createNewFile(fileSystemStore.directoryHandle!);
                        }}
                        title={`New File in ${fileSystemStore.directoryHandle?.name}`}
                        data-testid="new-file-button-sidebar"
                    >
                        <i className="fas fa-file-circle-plus" />
                    </button>
                </div>
            )}

            {fileSystemStore.isSearchVisible && (
                <div className={styles.searchContainer}>
                    <input
                        ref={fileSystemStore.searchInputRef}
                        className={styles.searchInput}
                        value={fileSystemStore.searchQuery}
                        onChange={(e) => fileSystemStore.handleSearchChange(e)}
                        onKeyDown={(e) => fileSystemStore.handleSearchKeyDown(e)}
                        placeholder="Search files..."
                        autoFocus
                        data-testid="search-input"
                    />
                    <button
                        className={styles.clearButton}
                        onClick={(e) => fileSystemStore.handleClearButtonClick(e)}
                        title={fileSystemStore.searchQuery ? "Clear search" : "Close search"}
                        data-testid="clear-search-button"
                    >
                        <i className={`fas ${fileSystemStore.searchQuery ? 'fa-times' : 'fa-times'}`} />
                    </button>
                </div>
            )}

            {!hasDirectory ? (
                <div className={styles.emptyState}>
                    <div>No folder opened</div>
                    <button
                        className={styles.actionButton}
                        onClick={() => fileSystemStore.openDirectory()}
                        data-testid="open-folder-button"
                    >
                        Open Folder
                    </button>
                </div>
            ) : (
                <div className={styles.treeContainer}>
                    {fileSystemStore.searchQuery ? (
                        // Flat List View
                        fileSystemStore.searchResults.length === 0 ? (
                            <div className={styles.emptyState}>No matches</div>
                        ) : (
                            fileSystemStore.searchResults.map((model) => {
                                const item = model.item;
                                return (
                                    <div
                                        key={item.path}
                                        ref={model.ref}
                                        className={`${styles.searchResultItem} ${model.isHighlighted ? styles.highlighted : ''}`}
                                        onClick={() => fileSystemStore.handleSearchResultClick(item)}
                                        data-testid="search-result-item"
                                        data-file-path={item.path}
                                    >
                                        <span className={styles.resultName}>{item.name}</span>
                                        <span className={styles.resultPath} title={item.path}>{item.path.substring(0, item.path.length - item.name.length - 1)}</span>
                                    </div>
                                );
                            })
                        )
                    ) : (
                        // Tree View
                        fileSystemStore.fileTree.length === 0 ? (
                            <div className={styles.emptyState}>Empty folder</div>
                        ) : (
                            fileSystemStore.fileTree.map((node, i) => (
                                <FileTreeItem key={i} node={node} />
                            ))
                        )
                    )}
                </div>
            )}
        </div>
    );
});
