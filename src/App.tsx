import React from 'react';
import Editor from './components/Editor';
import { TitleBar } from './components/TitleBar';
import { Sidebar } from './components/Sidebar';
import { TokensSidebar } from './components/TokensSidebar';
import { observer } from 'mobx-react-lite';
import { themeStore } from './store/ThemeStore';
import { lightTheme, darkTheme } from './theme.css';
import * as styles from './App.css';

const App: React.FC = observer(() => {
    const themeClass = themeStore.theme === 'light' ? lightTheme : darkTheme;

    return (
        <div className={`${styles.container} ${themeClass}`}>
            <TitleBar />
            <div className={styles.workspace}>
                <Sidebar />
                <main className={styles.main}>
                    <Editor theme={themeStore.theme === 'light' ? 'vs' : 'vs-dark'} />
                </main>
                <TokensSidebar />
            </div>
        </div>
    );
});

export default App;
