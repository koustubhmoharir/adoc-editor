import React, { useEffect, useRef } from 'react';
import { observer } from 'mobx-react-lite';
import { editorStore } from '../store/EditorStore';
import * as monaco from 'monaco-editor';

// @ts-ignore
if ((window as any).__ENABLE_TEST_GLOBALS__) {
    // @ts-ignore
    window.__TEST_monaco = monaco;
}

interface EditorProps {
    theme: string;
}

const Editor: React.FC<EditorProps> = observer(({ theme }) => {
    const editorRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (editorRef.current) {
            editorStore.initialize(editorRef.current, theme);
        }

        return () => {
            editorStore.dispose();
        };
    }, []);

    useEffect(() => {
        editorStore.setTheme(theme);
    }, [theme]);

    return (
        <div ref={editorRef} style={{ width: '100%', height: '100%' }} />
    );
});

export default Editor;
