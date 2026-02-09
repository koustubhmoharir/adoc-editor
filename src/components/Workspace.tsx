import React from 'react';
import { observer } from 'mobx-react-lite';
import Editor from './Editor';
import { TitleBar } from './TitleBar';
import { Sidebar } from './Sidebar';
import { TokensSidebar } from './TokensSidebar';
import * as styles from './Workspace.css';

export const Workspace: React.FC = observer(() => {
    return (
        <>
            <TitleBar />
            <div className={styles.workspace}>
                <Sidebar />
                <main className={styles.main}>
                    <Editor />
                </main>
                <TokensSidebar />
            </div>
        </>
    );
});
