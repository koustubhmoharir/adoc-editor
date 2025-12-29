import React from 'react';
import Editor from './components/Editor';
import * as styles from './App.css';

const App: React.FC = () => {
    return (
        <div className={styles.container}>
            <header className={styles.header}>
                <h3>AsciiDoc Editor</h3>
            </header>
            <main className={styles.main}>
                <Editor />
            </main>
        </div>
    );
};

export default App;
