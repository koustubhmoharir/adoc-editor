import React from 'react';
import Editor from './components/Editor';
import { observer } from 'mobx-react-lite';
import { themeStore } from './store/ThemeStore';
import { lightTheme, darkTheme } from './theme.css';
import * as styles from './App.css';

const App: React.FC = observer(() => {
    const themeClass = themeStore.theme === 'light' ? lightTheme : darkTheme;

    return (
        <div className={`${styles.container} ${themeClass}`}>
            <header className={styles.header} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 style={{ margin: 0 }}>AsciiDoc Editor</h3>
                <button onClick={themeStore.toggleTheme}>
                    Switch to {themeStore.theme === 'light' ? 'Dark' : 'Light'} Mode
                </button>
            </header>
            <main className={styles.main}>
                <Editor theme={themeStore.theme === 'light' ? 'vs' : 'vs-dark'} />
            </main>
        </div>
    );
});

export default App;
