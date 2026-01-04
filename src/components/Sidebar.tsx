import React from 'react';
import { observer } from 'mobx-react-lite';
import { fileSystemStore, FileNode } from '../store/FileSystemStore';
import * as styles from './Sidebar.css';

interface SidebarContextType {
    renamingPath: string | null;
    renameValue: string;
    setRenameValue: (val: string) => void;
    startRenaming: (node: FileNode) => void;
    commitRenaming: (node: FileNode) => void;
    cancelRenaming: () => void;
    handleDelete: (node: FileNode) => void;
    handleRenameKeyDown: (e: React.KeyboardEvent, node: FileNode) => void;
    renameInputRef: React.RefObject<HTMLInputElement>;
}

const SidebarContext = React.createContext<SidebarContextType | null>(null);

const FileTreeItem: React.FC<{ node: FileNode; level?: number }> = observer(({ node, level = 0 }) => {
    const context = React.useContext(SidebarContext);
    if (!context) throw new Error("FileTreeItem must be rendered within SidebarContext");

    const {
        renamingPath,
        renameValue,
        setRenameValue,
        startRenaming,
        commitRenaming,
        cancelRenaming,
        handleDelete,
        handleRenameKeyDown,
        renameInputRef
    } = context;

    const isSelected = fileSystemStore.currentFileHandle === node.handle;
    const isRenaming = renamingPath === node.path;

    // Simple indentation style
    const paddingLeft = `${level * 12 + 8}px`;

    if (node.kind === 'file') {
        return (
            <div
                className={`${styles.fileItem} ${isSelected ? styles.selected : ''}`}
                style={{ paddingLeft }}
                onClick={() => {
                    if (!isRenaming) fileSystemStore.selectFile(node);
                }}
                onKeyDown={(e) => {
                    if (isSelected && !isRenaming) {
                        if (e.key === 'F2') {
                            e.preventDefault();
                            startRenaming(node);
                        } else if (e.key === 'Delete') {
                            e.preventDefault();
                            handleDelete(node);
                        }
                    }
                }}
                tabIndex={isSelected ? 0 : -1} // Enable keyboard focus/events
            >
                <i className={`fas fa-file ${styles.icon} ${styles.fileIcon}`} />

                {isRenaming ? (
                    <input
                        ref={renameInputRef}
                        className={styles.renameInput}
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => handleRenameKeyDown(e, node)}
                        onClick={(e) => e.stopPropagation()}
                        onBlur={() => {
                            // Optional: commit on blur or cancel? 
                            // Standard behavior is usually commit or stay. 
                            // Let's cancel for safety or maybe nothing to avoid accidental cancels on window switch.
                            // Users often expect click-outside to commit, but let's stick to explicit action first.
                        }}
                    />
                ) : (
                    <span>{node.name}</span>
                )}

                {isRenaming ? (
                    <button
                        className={styles.acceptButton}
                        onClick={(e) => {
                            e.stopPropagation();
                            commitRenaming(node);
                        }}
                        title="Accept Rename"
                    >
                        <i className="fas fa-check" />
                    </button>
                ) : isSelected && (
                    <>
                        <button
                            className={styles.renameButton}
                            onClick={(e) => {
                                e.stopPropagation();
                                startRenaming(node);
                            }}
                            title="Rename (F2)"
                        >
                            <i className="fas fa-edit" />
                        </button>
                        <button
                            className={styles.deleteButton}
                            onClick={(e) => {
                                e.stopPropagation();
                                handleDelete(node);
                            }}
                            title="Delete (Del)"
                        >
                            <i className="fas fa-trash-alt" />
                        </button>
                    </>
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
        <div>
            <div
                className={styles.directoryItem}
                style={{ paddingLeft }}
                onClick={toggle}
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
                >
                    <i className="fas fa-file-circle-plus" />
                </button>
            </div>
            {!isCollapsed && node.children && node.children.map((child, i) => (
                <FileTreeItem key={i} node={child} level={level + 1} />
            ))}
        </div>
    );
});

export const Sidebar: React.FC = observer(() => {
    const hasDirectory = !!fileSystemStore.directoryHandle;

    // Renaming state
    const [renamingPath, setRenamingPath] = React.useState<string | null>(null);
    const [renameValue, setRenameValue] = React.useState('');
    const renameInputRef = React.useRef<HTMLInputElement>(null);

    React.useEffect(() => {
        if (renamingPath && renameInputRef.current) {
            renameInputRef.current.focus();
            // Select name part excluding extension
            const dotIndex = renameValue.lastIndexOf('.');
            if (dotIndex > 0) {
                renameInputRef.current.setSelectionRange(0, dotIndex);
            } else {
                renameInputRef.current.select();
            }
        }
    }, [renamingPath]);

    const startRenaming = (node: FileNode) => {
        setRenamingPath(node.path);
        setRenameValue(node.name);
    };

    const cancelRenaming = () => {
        setRenamingPath(null);
        setRenameValue('');
    };

    const commitRenaming = async (node: FileNode) => {
        if (!renameValue || renameValue === node.name) {
            cancelRenaming();
            return;
        }
        await fileSystemStore.renameFile(node, renameValue);
        cancelRenaming();
    };

    const handleDelete = async (node: FileNode) => {
        if (confirm(`Are you sure you want to delete '${node.name}'?`)) {
            await fileSystemStore.deleteFile(node);
        }
    };

    const handleRenameKeyDown = (e: React.KeyboardEvent, node: FileNode) => {
        if (e.key === 'Enter') {
            e.stopPropagation();
            commitRenaming(node);
        } else if (e.key === 'Escape') {
            e.stopPropagation();
            cancelRenaming();
        }
    };

    // Global keyboard handler for F2/Del if sidebar focused or generally?
    // Requirement says "Pressing F2 should also trigger the rename". 
    // Usually implies if file is selected (which implies sidebar focus or global if file is active).
    // Let's rely on the div tabIndex/focus first, but add a global effect if that's insufficient.
    // Ideally, if a file is open and I hit F2, I might expect rename.
    // Editor might capture keys.
    // Let's attach a listener to window for F2/Del ONLY if not editing text? 
    // Or just rely on sidebar item focus? 
    // Sidebar items are divs. Let's make them focusable when selected (added tabIndex above).
    // Also need to ensure when a file is selected via store, the sidebar item gets focus? 
    // Or just add a global listener that checks store.currentFileHandle.

    React.useEffect(() => {
        const handleGlobalKeyDown = (e: KeyboardEvent) => {
            // If we are renaming, input handles keys.
            if (renamingPath) return;

            // If editor has focus, maybe we shouldn't trigger delete? 
            // F2 usually triggers rename even from editor.
            // Delete might act on text in editor.

            const isEditorFocused = document.activeElement?.classList.contains('monaco-editor') || document.activeElement?.closest('.monaco-editor');
            // Or check if activeElement is input/textarea
            const isInputFocused = document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement;

            if (fileSystemStore.currentFileHandle) {
                if (e.key === 'F2') {
                    // Try to find the node for currentFileHandle
                    const node = fileSystemStore.allFiles.find(n => n.handle === fileSystemStore.currentFileHandle);
                    if (node) {
                        e.preventDefault();
                        startRenaming(node);
                    }
                } else if (e.key === 'Delete') {
                    if (!isInputFocused && !isEditorFocused) { // Only delete file if not typing
                        const node = fileSystemStore.allFiles.find(n => n.handle === fileSystemStore.currentFileHandle);
                        if (node) {
                            e.preventDefault();
                            handleDelete(node);
                        }
                    }
                }
            }
        };

        window.addEventListener('keydown', handleGlobalKeyDown);
        return () => window.removeEventListener('keydown', handleGlobalKeyDown);
    }, [renamingPath]); // Re-bind if renaming state changes? Actually dependency on renamingPath is needed to avoid stale closure if we check it.

    const contextValue: SidebarContextType = {
        renamingPath,
        renameValue,
        setRenameValue,
        startRenaming,
        commitRenaming,
        cancelRenaming,
        handleDelete,
        handleRenameKeyDown,
        renameInputRef
    };

    return (
        <SidebarContext.Provider value={contextValue}>
            <div className={styles.sidebar}>
                {hasDirectory && (
                    <div
                        className={styles.header}
                        title={fileSystemStore.directoryHandle?.name}
                        onClick={() => fileSystemStore.openDirectory()}
                    >
                        <i className={`fas fa-folder-open ${styles.icon} ${styles.folderIcon}`} />
                        <span className={styles.headerText}>{fileSystemStore.directoryHandle?.name}</span>

                        <button
                            className={styles.searchToggleButton}
                            onClick={(e) => fileSystemStore.toggleSearch(e)}
                            title="Search files"
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
                        />
                        {/* Always show the button, acting as Clear or Close */}
                        <button
                            className={styles.clearButton}
                            onClick={(e) => fileSystemStore.handleClearButtonClick(e)}
                            title={fileSystemStore.searchQuery ? "Clear search" : "Close search"}
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
        </SidebarContext.Provider>
    );
});
