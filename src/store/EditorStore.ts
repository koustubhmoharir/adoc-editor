import { observable, action } from "mobx";
import * as monaco from 'monaco-editor';
import { registerAsciiDoc } from '../utils/asciidocMode';

// MARKER: WELCOME_CONTENT_START
const WELCOME_CONTENT = `
= AsciiDoc Editor

Welcome to the AsciiDoc Editor!

== Features

* Syntax highlighting
* File system integration
* Auto-save functionality

Click the "Help" icon in the title bar to see this message again.

`;
// MARKER: WELCOME_CONTENT_END

export class EditorStore {
    @observable accessor content: string = WELCOME_CONTENT;
    editor: monaco.editor.IStandaloneCodeEditor | null = null;
    disposers: (() => void)[] = [];

    @action
    setContent(newContent: string) {
        if (this.content !== newContent) {
            this.content = newContent;
            if (this.editor && this.editor.getValue() !== newContent) {
                this.editor.setValue(newContent);
            }
        }
    }

    @action
    showHelp() {
        this.setContent(WELCOME_CONTENT);
    }

    @action
    setTheme(theme: string) {
        monaco.editor.setTheme(theme);
    }

    @action
    initialize(container: HTMLDivElement, initialTheme: string) {
        registerAsciiDoc();

        this.editor = monaco.editor.create(container, {
            value: this.content,
            language: 'asciidoc',
            theme: initialTheme,
            automaticLayout: true,
            minimap: { enabled: false }
        });

        // Sync content changes
        const model = this.editor.getModel();
        if (model) {
            const contentDisposable = model.onDidChangeContent(() => {
                const value = model.getValue();
                if (value !== this.content) {
                    this.setContent(value);
                }
            });
            this.disposers.push(() => contentDisposable.dispose());
        }
    }

    @action
    dispose() {
        this.disposers.forEach(dispose => dispose());
        this.disposers = [];
        if (this.editor) {
            this.editor.dispose();
            this.editor = null;
        }
    }
}

export const editorStore = new EditorStore();

// Expose for testing/debugging
if (typeof window !== 'undefined' && (window as any).__ENABLE_TEST_GLOBALS__) {
    (window as any).__TEST_editorStore = editorStore;
}
