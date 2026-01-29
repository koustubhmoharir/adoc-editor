import React from 'react';
import { observer } from 'mobx-react-lite';
import { themeStore } from './store/ThemeStore';
import { appStore } from './store/AppStore';
import { lightTheme, darkTheme } from './theme.css';
import * as styles from './App.css';

import { Workspace } from './components/Workspace';
import { S3Sync } from './components/S3Sync';
import { NativeDialog } from './components/Dialog';

const App: React.FC = observer(() => {
    const themeClass = themeStore.theme === 'light' ? lightTheme : darkTheme;

    return (
        <div className={`${styles.container} ${themeClass}`}>
            {appStore.mode === 'editor' ? <Workspace /> : <S3Sync store={appStore.activeSyncStore!}/>}
            <NativeDialog />
        </div>
    );
});

export default App;
