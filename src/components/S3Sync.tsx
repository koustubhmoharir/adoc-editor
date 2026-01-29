import { observer } from 'mobx-react-lite';
import { S3SyncTitleBar } from './S3SyncTitleBar';
import { S3SyncSidebar } from './S3SyncSidebar';
import { S3SyncDiffEditor } from './S3SyncDiffEditor';
import * as styles from './S3Sync.css';
import { S3SyncStore } from '../store/S3SyncStore';

export const S3Sync = observer(({ store }: { store: S3SyncStore }) => {
    return (
        <>
            <S3SyncTitleBar />
            <div className={styles.container}>
                <S3SyncSidebar store={store} />
                <S3SyncDiffEditor diffStore={store.diffStore} />
            </div>
        </>
    );
});
