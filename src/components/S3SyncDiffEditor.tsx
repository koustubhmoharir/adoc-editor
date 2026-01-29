import React from 'react';
import { observer } from 'mobx-react-lite';
import * as styles from './S3SyncDiffEditor.css';

export const S3SyncDiffEditor: React.FC = observer(() => {
    return (
        <div className={styles.container} data-testid="s3sync-diff-editor">
            <div className={styles.placeholder}>
                <i className={`fa-solid fa-code-compare ${styles.icon}`} />
                <span>Select a file to view diff</span>
            </div>
        </div>
    );
});
