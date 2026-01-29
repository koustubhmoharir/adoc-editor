import React, { useEffect, useRef } from 'react';
import { observer } from 'mobx-react-lite';
import * as monaco from 'monaco-editor';
import { themeStore } from '../store/ThemeStore';
import { appStore } from '../store/AppStore';
import { S3SyncInfoBar } from './S3SyncInfoBar';
import { ResizeHandle } from './ResizeHandle';
import * as styles from './S3SyncDiffEditor.css';

export const S3SyncDiffEditor: React.FC = observer(() => {
    const singleEditorRef = useRef<HTMLDivElement>(null);
    const diffEditorRef = useRef<HTMLDivElement>(null);
    const singleEditorInstance = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
    const diffEditorInstance = useRef<monaco.editor.IDiffEditor | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    const theme = themeStore.theme === 'light' ? 'vs' : 'vs-dark';
    const diffStore = appStore.activeSyncStore?.diffStore;
    const showSinglePane = diffStore?.showSinglePane ?? false;
    const showDiffPane = diffStore?.showDiffPane ?? false;
    const isLoading = diffStore?.isLoading ?? false;

    // Initialize single editor
    useEffect(() => {
        if (singleEditorRef.current && !singleEditorInstance.current) {
            singleEditorInstance.current = monaco.editor.create(singleEditorRef.current, {
                value: '',
                theme,
                readOnly: true,
                automaticLayout: true,
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
            });
        }
        return () => {
            singleEditorInstance.current?.dispose();
            singleEditorInstance.current = null;
        };
    }, []);

    // Initialize diff editor
    useEffect(() => {
        if (diffEditorRef.current && !diffEditorInstance.current) {
            diffEditorInstance.current = monaco.editor.createDiffEditor(diffEditorRef.current, {
                theme,
                automaticLayout: true,
                readOnly: false,
                renderSideBySide: true,
                originalEditable: false,
            });
        }
        return () => {
            diffEditorInstance.current?.dispose();
            diffEditorInstance.current = null;
        };
    }, []);

    // Update theme
    useEffect(() => {
        monaco.editor.setTheme(theme);
    }, [theme]);

    // Update single editor content
    useEffect(() => {
        if (singleEditorInstance.current && showSinglePane && diffStore) {
            const content = diffStore.singlePaneContent || '';
            singleEditorInstance.current.setValue(content);
        }
    }, [diffStore?.singlePaneContent, showSinglePane]);

    // Update diff editor content
    useEffect(() => {
        if (diffEditorInstance.current && showDiffPane && diffStore) {
            const originalContent = diffStore.diffOriginalContent || '';
            const modifiedContent = diffStore.diffModifiedContent || '';

            const originalModel = monaco.editor.createModel(originalContent, 'plaintext');
            const modifiedModel = monaco.editor.createModel(modifiedContent, 'plaintext');

            diffEditorInstance.current.setModel({
                original: originalModel,
                modified: modifiedModel,
            });

            // Make modified side editable if it's local
            const modifiedEditor = diffEditorInstance.current.getModifiedEditor();
            modifiedEditor.updateOptions({ readOnly: !diffStore.isDiffModifiedEditable });

            // Listen for changes to sync back to store
            if (diffStore.isDiffModifiedEditable) {
                const disposable = modifiedEditor.onDidChangeModelContent(() => {
                    const content = modifiedEditor.getValue();
                    diffStore.updateLocalContent(content);
                });
                return () => disposable.dispose();
            }
        }
    }, [diffStore?.diffOriginalContent, diffStore?.diffModifiedContent, showDiffPane, diffStore?.isDiffModifiedEditable]);

    const handleResize = (delta: number) => {
        if (!containerRef.current || !diffStore) return;
        const containerHeight = containerRef.current.clientHeight;
        const currentPercent = diffStore.singlePaneHeight;
        const deltaPercent = (delta / containerHeight) * 100;
        diffStore.setSinglePaneHeight(currentPercent + deltaPercent);
    };

    // No selection
    if (!showSinglePane && !showDiffPane) {
        return (
            <div className={styles.container} data-testid="s3sync-diff-editor">
                <S3SyncInfoBar />
                <div className={styles.placeholder}>
                    <i className={`fa-solid fa-code-compare ${styles.placeholderIcon}`} />
                    <span>Select a file to view diff</span>
                </div>
            </div>
        );
    }

    // Loading
    if (isLoading) {
        return (
            <div className={styles.container} data-testid="s3sync-diff-editor">
                <S3SyncInfoBar />
                <div className={styles.loadingState}>
                    <i className="fa-solid fa-spinner fa-spin" />
                    <span>Loading content...</span>
                </div>
            </div>
        );
    }

    // 3-way view: both panes
    if (showSinglePane && showDiffPane && diffStore) {
        return (
            <div className={styles.container} ref={containerRef} data-testid="s3sync-diff-editor">
                <S3SyncInfoBar />
                <div
                    className={styles.singlePane}
                    style={{ height: `${diffStore.singlePaneHeight}%`, flexShrink: 0 }}
                >
                    <span className={styles.paneLabel}>Base</span>
                    <div ref={singleEditorRef} style={{ width: '100%', height: '100%' }} />
                </div>
                <ResizeHandle direction="horizontal" onResize={handleResize} />
                <div className={styles.diffPane} style={{ flex: 1 }}>
                    <span className={styles.paneLabel}>Remote ↔ Local</span>
                    <div ref={diffEditorRef} style={{ width: '100%', height: '100%' }} />
                </div>
            </div>
        );
    }

    // Single pane only
    if (showSinglePane) {
        return (
            <div className={styles.container} data-testid="s3sync-diff-editor">
                <S3SyncInfoBar />
                <div className={styles.editorPane}>
                    <div ref={singleEditorRef} style={{ width: '100%', height: '100%' }} />
                </div>
            </div>
        );
    }

    // Diff pane only
    return (
        <div className={styles.container} data-testid="s3sync-diff-editor">
            <S3SyncInfoBar />
            <div className={styles.editorPane}>
                <div ref={diffEditorRef} style={{ width: '100%', height: '100%' }} />
            </div>
        </div>
    );
});
