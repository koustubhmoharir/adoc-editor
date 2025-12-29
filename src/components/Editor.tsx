import React, { useEffect, useRef } from 'react';
import * as monaco from 'monaco-editor';
import { observer } from 'mobx-react-lite';
import { editorStore } from '../store/EditorStore';
import { registerAsciiDoc } from '../utils/asciidocMode';

const Editor: React.FC = observer(() => {
    const editorRef = useRef<HTMLDivElement>(null);
    const monacoRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);

    useEffect(() => {
        if (!editorRef.current) return;

        registerAsciiDoc();

        monacoRef.current = monaco.editor.create(editorRef.current, {
            value: editorStore.content,
            language: 'asciidoc',
            theme: 'vs-dark',
            automaticLayout: true,
            minimap: { enabled: false }
        });

        const model = monacoRef.current.getModel();
        model?.onDidChangeContent(() => {
            editorStore.setContent(model.getValue());
        });

        return () => {
            monacoRef.current?.dispose();
        };
    }, []);

    return (
        <div ref={editorRef} style={{ width: '100%', height: '100%' }} />
    );
});

export default Editor;
