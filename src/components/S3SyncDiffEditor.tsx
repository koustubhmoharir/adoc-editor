import { useEffect, useRef } from 'react';
import { observer } from 'mobx-react-lite';
import { S3SyncInfoBar } from './S3SyncInfoBar';
import { ResizeHandle } from './ResizeHandle';
import * as styles from './S3SyncDiffEditor.css';
import { S3SyncDiffStore } from '../store/S3SyncDiffStore';
import { useScheduledEffects } from '../hooks/useScheduledEffects';

export const S3SyncDiffEditor = observer(({ store }: { store: S3SyncDiffStore; }) => {
    const containerRef = useRef<HTMLDivElement>(null);

    const isLoading = store.isLoading;

    // Cleanup on unmount
    useEffect(() => {
        return () => store.dispose();
    }, [store]);
    useScheduledEffects(store);

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

    // No selection
    if (!store.singlePaneDetails && !store.diffPaneDetails) {
        return (
            <div className={styles.container} data-testid="s3sync-diff-editor">
                <div className={styles.placeholder}>
                    <i className={`fa-solid fa-code-compare ${styles.placeholderIcon}`} />
                    <span>Select a file to view diff</span>
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

    const renderPaneContent = (details: Readonly<{
        isBinary: boolean;
        loadBinary: () => void;
        download?: () => void;
    }>, ref: React.RefObject<HTMLDivElement | null>) => {

        if (details.download) {
            return (
                <div className={styles.placeholder} data-testid="remote-not-downloaded-msg">
                    <i className={`fa-solid fa-cloud-arrow-down ${styles.placeholderIcon}`} />
                    <span>Remote content not downloaded.</span>
                    {store.syncItem?.remote?.contentLength !== undefined && <span>Size: {store.syncItem.remote.contentLength} bytes</span>}
                    <button className={styles.actionButton} onClick={details.download} data-testid="download-remote-btn">Download</button>
                </div>
            );
        }

        if (details.isBinary) {
            return (
                <div className={styles.placeholder} data-testid="binary-message">
                    <i className={`fa-solid fa-file-binary ${styles.placeholderIcon}`} />
                    <span>This file is binary.</span>
                    <button className={styles.actionButton} onClick={details.loadBinary} data-testid="show-binary-text-btn">Show as text</button>
                </div>
            );
        }

        return <div ref={ref} style={{ width: '100%', height: '100%' }} />;
    };

    return (
        <div className={styles.container} ref={containerRef} data-testid="s3sync-diff-editor">
            <S3SyncInfoBar store={store} />
            {store.singlePaneDetails &&
                <div
                    className={styles.singlePane}
                    style={{ height: store.diffPaneDetails ? `${store.singlePaneHeight}%` : undefined, flexGrow: store.diffPaneDetails ? undefined : 1, flexShrink: 0 }}
                >
                    {renderPaneContent(store.singlePaneDetails, store.singleEditorRef)}
                </div>
            }
            {store.singlePaneDetails && store.diffPaneDetails &&
                <ResizeHandle direction="horizontal" onResize={handleResize!} />
            }
            {store.diffPaneDetails &&
                <div className={styles.diffPane} style={{ flex: 1 }}>
                    {renderPaneContent(store.diffPaneDetails, store.diffEditorRef)}
                </div>
            }
        </div>
    );
});
