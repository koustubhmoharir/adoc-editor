import React from 'react';
import { observer } from 'mobx-react-lite';
import { S3SyncTitleBar } from './S3SyncTitleBar';
import { S3SyncSidebar } from './S3SyncSidebar';
import { S3SyncDiffEditor } from './S3SyncDiffEditor';
import * as styles from './S3Sync.css';

export const S3Sync: React.FC = observer(() => {
    return (
        <>
            <S3SyncTitleBar />
            <div className={styles.container}>
                <S3SyncSidebar />
                <S3SyncDiffEditor />
            </div>
        </>
    );
});
