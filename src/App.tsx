import React from 'react';
import Editor from './components/Editor';

const App: React.FC = () => {
    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
            <header style={{ padding: '10px', background: '#333', color: '#fff' }}>
                <h3>AsciiDoc Editor</h3>
            </header>
            <main style={{ flex: 1, overflow: 'hidden' }}>
                <Editor />
            </main>
        </div>
    );
};

export default App;
