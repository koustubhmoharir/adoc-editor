import { useEffect, useRef } from 'react';
import { observer } from 'mobx-react-lite';
import { S3SyncInfoBar } from './S3SyncInfoBar';
import { ResizeHandle } from './ResizeHandle';
import * as styles from './S3SyncDiffEditor.css';
import { S3SyncDiffStore } from '../store/S3SyncDiffStore';

export const S3SyncDiffEditor = observer(({ store }: { store: S3SyncDiffStore; }) => {
    const containerRef = useRef<HTMLDivElement>(null);

    const showSinglePane = store.showSinglePane;
    const showDiffPane = store.showDiffPane;
    const isLoading = store.isLoading;

    // Cleanup on unmount
    useEffect(() => {
        return () => store.dispose();
    }, [store]);

    // No selection
    if (!showSinglePane && !showDiffPane) {
        return (
            <div className={styles.container} data-testid="s3sync-diff-editor">
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
                <div className={styles.loadingState}>
                    <i className="fa-solid fa-spinner fa-spin" />
                    <span>Loading content...</span>
                </div>
            </div>
        );
    }

    const handleResize = (delta: number) => {
        if (!containerRef.current) return;
        const containerHeight = containerRef.current.clientHeight;
        const currentPercent = store.singlePaneHeight;
        const deltaPercent = (delta / containerHeight) * 100;
        store.setSinglePaneHeight(currentPercent + deltaPercent);
    };

    return (
        <div className={styles.container} ref={containerRef} data-testid="s3sync-diff-editor">
            <S3SyncInfoBar store={store} />
            {showSinglePane &&
                <div
                    className={styles.singlePane}
                    style={{ height: `${store.singlePaneHeight}%`, flexShrink: 0 }}
                >
                    <span className={styles.paneLabel}>Base</span>
                    <div ref={store.singleEditorRef} style={{ width: '100%', height: '100%' }} />
                </div>
            }
            {showSinglePane && showDiffPane &&
                <ResizeHandle direction="horizontal" onResize={handleResize!} />
            }
            {showDiffPane &&
                <div className={styles.diffPane} style={{ flex: 1 }}>
                    <span className={styles.paneLabel}>Remote ↔ Local</span>
                    <div ref={store.diffEditorRef} style={{ width: '100%', height: '100%' }} />
                </div>
            }
        </div>
    );
});
