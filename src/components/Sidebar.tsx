import React from 'react';
import { observer } from 'mobx-react-lite';
import { fileSystemStore, FileSystemNodeModel } from '../store/FileSystemStore';
import * as styles from './Sidebar.css';
import { useScheduledEffects } from '../hooks/useScheduledEffects';

import { SidebarContextMenu } from './SidebarContextMenu';

const RenameControl: React.FC<{ node: FileSystemNodeModel }> = observer(({ node }) => {
    return (
        <>
            <button key="cancel-rename-button"
                className={styles.cancelButton}
                onClick={(e) => {
                    e.stopPropagation();
                    node.cancelRenaming();
                }}
                onMouseDown={(e) => e.preventDefault()} // Prevent blur on input
                title="Cancel Rename (Esc)"
                data-testid="cancel-rename-button"
            >
                <i className="fas fa-times" />
            </button>

            <input
                ref={node.renameInputRef}
                className={styles.renameInput}
                data-testid="rename-input"
                value={node.renameValue}
                onChange={(e) => node.setRenameValue(e.target.value)}
                onKeyDown={node.handleRenameInputKeyDown}
                onClick={(e) => e.stopPropagation()}
                onBlur={node.handleRenameInputBlur}
            />

            <button key="accept-rename-button"
                ref={node.acceptRenameBtnRef}
                className={styles.acceptButton}
                onClick={(e) => {
                    e.stopPropagation();
                    node.commitRenaming();
                }}
                onMouseDown={(e) => e.preventDefault()} // Prevent blur on input
                title="Accept Rename"
                data-testid="accept-rename-button"
            >
                <i className="fas fa-check" />
            </button>
        </>
    );
});

const FileTreeItem: React.FC<{ node: FileSystemNodeModel }> = observer(({ node }) => {
    // Consume effects after every render
    useScheduledEffects(node);

    const isSelected = fileSystemStore.highlightedPath === node.path;
    const isRenaming = node.isRenaming;
    const isDirectory = node.kind === 'directory';
    const isCollapsed = isDirectory ? fileSystemStore.isCollapsed(node.path) : false;

    const itemContent = (
        <div
            ref={node.treeItemRef}
            className={`${isDirectory ? styles.directoryItem : styles.fileItem} ${isSelected ? styles.selected : ''}`}
            onClick={node.handleClick}
            onDoubleClick={node.handleDoubleClick}
            onContextMenu={node.handleContextMenu}
            onKeyDown={node.handleTreeItemKeyDown}
            tabIndex={isSelected ? 0 : -1} // Enable keyboard focus/events
            data-testid={isDirectory ? "directory-item" : "file-item"}
            data-file-path={!isDirectory ? node.path : undefined}
            data-dir-path={isDirectory ? node.path : undefined}
            data-selected={isSelected}
            title={node.name}
        >
            {isRenaming ? (
                <RenameControl node={node} />
            ) : (
                <>
                    {node.kind === 'directory' ? (
                        <button
                            className={styles.directoryToggleButton}
                            onClick={node.handleToggleClick}
                            title={isCollapsed ? "Expand" : "Collapse"}
                            data-testid="toggle-directory-btn"
                        >
                            <i className={`fas ${isCollapsed ? 'fa-folder' : 'fa-folder-open'} ${styles.folderIcon}`} />
                        </button>
                    ) : (
                        <i className={`fas fa-file-lines ${styles.fileIcon}`} />
                    )}
                    <span className={styles.itemText}>{node.name}</span>
                </>
            )}
        </div>
    );

    if (isDirectory) {
        return (
            <div className={styles.directoryContainer}>
                {itemContent}
                {!isCollapsed && node.children && node.children.map((child, i) => (
                    <FileTreeItem key={i} node={child} />
                ))}
            </div>
        );
    }

    return itemContent;
});

const SidebarHeader: React.FC = observer(() => {
    const rootNode = fileSystemStore.rootNode;
    if (!rootNode) return null;

    return (
        <div
            className={styles.header}
            ref={rootNode.treeItemRef}
            title={rootNode.name}
            onClick={() => fileSystemStore.openDirectory()}
            onContextMenu={rootNode.handleContextMenu}
            data-testid="sidebar-header"
        >
            <i className={`fas fa-folder-open ${styles.rootFolderIcon}`} />
            <span className={`${styles.headerText} ${styles.itemText}`}>{rootNode.name}</span>

            <button
                className={styles.searchToggleButton}
                onClick={(e) => fileSystemStore.toggleSearch(e)}
                title="Search files"
                data-testid="search-toggle-button"
            >
                <i className="fas fa-search" />
            </button>
        </div>
    );
});

const SidebarSearch: React.FC = observer(() => {
    if (!fileSystemStore.isSearchVisible) return null;

    return (
        <div className={styles.searchContainer}>
            <input
                ref={fileSystemStore.searchInputRef}
                className={styles.searchInput}
                value={fileSystemStore.searchQuery}
                onChange={fileSystemStore.handleSearchChange}
                onKeyDown={fileSystemStore.handleSearchKeyDown}
                placeholder="Search files..."
                autoFocus
                data-testid="search-input"
            />
            <button
                className={styles.clearButton}
                onClick={fileSystemStore.handleClearButtonClick}
                title={fileSystemStore.searchQuery ? "Clear search" : "Close search"}
                data-testid="clear-search-button"
            >
                <i className={`fas ${fileSystemStore.searchQuery ? 'fa-times' : 'fa-times'}`} />
            </button>
        </div>
    );
});

const SidebarSearchResults: React.FC = observer(() => {
    if (fileSystemStore.searchResults.length === 0) {
        return <div className={styles.emptyState}>No matches</div>;
    }

    return (
        <>
            {fileSystemStore.searchResults.map((model) => {
                const item = model.item;
                return (
                    <div
                        key={item.path}
                        ref={model.ref}
                        className={`${styles.searchResultItem} ${model.isHighlighted ? styles.highlighted : ''}`}
                        onClick={() => fileSystemStore.handleSearchResultClick(item)}
                        onContextMenu={item.handleContextMenu}
                        data-testid="search-result-item"
                        data-file-path={item.path}
                        data-highlighted={model.isHighlighted}
                    >
                        <span className={`${styles.resultName} ${styles.itemText}`}>{item.name}</span>
                        <span className={styles.resultPath} title={item.path}>{item.path.substring(0, item.path.length - item.name.length - 1)}</span>
                    </div>
                );
            })}
        </>
    );
});

const SidebarTree: React.FC = observer(() => {
    const rootNode = fileSystemStore.rootNode;
    if (!rootNode) return null;

    if (rootNode.children?.length === 0) {
        return <div className={styles.emptyState}>Empty folder</div>;
    }

    return (
        <>
            {rootNode.children?.map((node: FileSystemNodeModel, i: number) => (
                <FileTreeItem key={i} node={node} />
            ))}
        </>
    );
});

const SidebarEmptyState: React.FC = observer(() => {
    return (
        <div className={styles.emptyState}>
            <div>No folder opened</div>
            <button
                className={styles.actionButton}
                onClick={fileSystemStore.openDirectory}
                data-testid="open-directory-button"
            >
                Open Directory
            </button>
        </div>
    );
});

export const Sidebar: React.FC = observer(() => {
    // Consume store effects
    useScheduledEffects(fileSystemStore);
    const rootNode = fileSystemStore.rootNode;

    return (
        <>
            <div
                className={styles.sidebar}
                style={{ width: `${fileSystemStore.sidebarWidth}px`, flexShrink: 0 }}
                data-testid="sidebar"
            >
                <SidebarContextMenu />

                {rootNode ?
                    <>
                        <SidebarHeader />
                        <SidebarSearch />
                        <div className={styles.treeContainer}>
                            {fileSystemStore.searchQuery ? (
                                <SidebarSearchResults />
                            ) : (
                                <SidebarTree />
                            )}
                        </div>
                    </> :

                    <SidebarEmptyState />
                }
            </div>
            <div
                className={styles.resizeHandle}
                onMouseDown={fileSystemStore.handleSidebarResizeStart}
                data-testid="sidebar-resize-handle"
            />
        </>
    );
});
