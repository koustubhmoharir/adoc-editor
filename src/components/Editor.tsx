import { useEffect, useRef } from 'react';
import { observer } from 'mobx-react-lite';
import { editorStore } from '../store/EditorStore';
import * as monaco from 'monaco-editor';

import { StatusBar } from './StatusBar';

if (window.__TEST_ENABLE_GLOBALS) {
    window.__TEST_monaco = monaco;
}

const Editor = observer(() => {
    const editorRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (editorRef.current) {
            editorStore.initialize(editorRef.current);
        }

        return () => {
            editorStore.dispose();
        };
    }, []);

    return (
        <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
            <div ref={editorRef} style={{ flex: 1, overflow: 'hidden' }} data-testid="editor-container" />
            <StatusBar />
        </div>
    );
});

export default Editor;
