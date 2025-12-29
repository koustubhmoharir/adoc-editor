import React, { useEffect, useRef } from 'react';
import * as monaco from 'monaco-editor';
import { observer } from 'mobx-react-lite';
import { reaction } from 'mobx';
import { editorStore } from '../store/EditorStore';
import { themeStore } from '../store/ThemeStore';
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
            theme: themeStore.theme === 'light' ? 'vs' : 'vs-dark',
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

    useEffect(() => {
        if (!monacoRef.current) return;

        // values from store might have changed while component was unmounted
        const updateTheme = (theme: string) => {
            monaco.editor.setTheme(theme === 'light' ? 'vs' : 'vs-dark');
        }

        // specific initialization
        updateTheme(themeStore.theme);

        // React to future changes
        const dispose = reaction(
            () => themeStore.theme,
            (theme) => updateTheme(theme)
        );

        return () => dispose();
    }, []);

    return (
        <div ref={editorRef} style={{ width: '100%', height: '100%' }} />
    );
});

export default Editor;
