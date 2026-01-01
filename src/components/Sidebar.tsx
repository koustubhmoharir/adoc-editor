import React from 'react';
import { observer } from 'mobx-react-lite';
import { fileSystemStore, FileNode } from '../store/FileSystemStore';
import * as styles from './Sidebar.css';

const FileTreeItem: React.FC<{ node: FileNode; level?: number }> = observer(({ node, level = 0 }) => {
    const isSelected = fileSystemStore.currentFileHandle === node.handle;

    // Simple indentation style
    const paddingLeft = `${level * 12 + 8}px`;

    if (node.kind === 'file') {
        return (
            <div
                className={`${styles.fileItem} ${isSelected ? styles.selected : ''}`}
                style={{ paddingLeft }}
                onClick={() => fileSystemStore.selectFile(node)}
            >
                <span className={styles.icon}>📄</span>
                {node.name}
            </div>
        );
    }

    return (
        <div>
            <div className={styles.directoryItem} style={{ paddingLeft }}>
                <span className={styles.icon}>📁</span>
                {node.name}
            </div>
            {node.children && node.children.map((child, i) => (
                <FileTreeItem key={i} node={child} level={level + 1} />
            ))}
        </div>
    );
});

export const Sidebar: React.FC = observer(() => {
    const hasDirectory = !!fileSystemStore.directoryHandle;

    return (
        <div className={styles.sidebar}>
            {hasDirectory && (
                <div
                    className={styles.header}
                    title={fileSystemStore.directoryHandle?.name}
                    onClick={() => fileSystemStore.openDirectory()}
                >
                    {fileSystemStore.directoryHandle?.name}
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
                    {fileSystemStore.fileTree.length === 0 ? (
                        <div className={styles.emptyState}>Empty folder</div>
                    ) : (
                        fileSystemStore.fileTree.map((node, i) => (
                            <FileTreeItem key={i} node={node} />
                        ))
                    )}
                </div>
            )}
        </div>
    );
});
