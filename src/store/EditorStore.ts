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

    constructor() {}
    
    @observable private accessor _content: string = WELCOME_CONTENT;
    get content() { return this._content; }

    private _editor: monaco.editor.IStandaloneCodeEditor | null = null;
    get editor() { return this._editor; }

    private _disposers: (() => void)[] = [];

    focusCurrentFileItem: (() => void) | undefined = undefined;
    setDirty: (() => void) | undefined = undefined;

    @action
    setContent(newContent: string) {
        if (this._content !== newContent) {
            this._content = newContent;
            if (this._editor && this._editor.getValue() !== newContent) {
                this._editor.setValue(newContent);
            }
            this.setDirty?.();
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
    setLanguage(extensionOrFilename: string) {
        if (!this._editor) return;

        // Monaco's setModelLanguage needs an ID.
        let langId = 'plaintext';
        const ext = extensionOrFilename.startsWith('.') ? extensionOrFilename : '.' + extensionOrFilename;

        // Basic mapping for common types
        const map: Record<string, string> = {
            '.js': 'javascript',
            '.ts': 'typescript',
            '.jsx': 'javascript',
            '.tsx': 'typescript',
            '.html': 'html',
            '.css': 'css',
            '.json': 'json',
            '.md': 'markdown',
            '.adoc': 'asciidoc',
            '.xml': 'xml',
            '.py': 'python',
            '.java': 'java',
            '.c': 'c',
            '.cpp': 'cpp',
            '.go': 'go',
            '.rs': 'rust',
            '.sql': 'sql',
            '.sh': 'shell',
            '.yaml': 'yaml',
            '.yml': 'yaml'
        };

        if (map[ext]) {
            langId = map[ext];
        } else {
            // Fallback: try to find in registered languages
            const languages = monaco.languages.getLanguages();
            for (const lang of languages) {
                if (lang.extensions?.includes(ext)) {
                    langId = lang.id;
                    break;
                }
            }
        }

        const model = this._editor.getModel();
        if (model) {
            monaco.editor.setModelLanguage(model, langId);
        }
    }

    @action
    focusEditor() {
        this._editor?.focus();
    }

    @action
    initialize(container: HTMLDivElement, initialTheme: string) {
        registerAsciiDoc();

        this._editor = monaco.editor.create(container, {
            value: this._content,
            language: 'asciidoc',
            theme: initialTheme,
            automaticLayout: true,
            minimap: { enabled: false }
        });

        // Sync content changes
        const model = this._editor.getModel();
        if (model) {
            const contentDisposable = model.onDidChangeContent(() => {
                const value = model.getValue();
                if (value !== this._content) {
                    this.setContent(value);
                }
            });
            this._disposers.push(() => contentDisposable.dispose());
        }

        // Handle Escape to focus sidebar
        // PRECONDITION: Only if other widgets are NOT visible
        this._editor.addCommand(monaco.KeyCode.Escape, () => {
            this.focusCurrentFileItem?.();
        }, '!findWidgetVisible && !suggestWidgetVisible && !parameterHintsVisible && !referenceSearchVisible && !renameInputVisible');
    }

    @action
    dispose() {
        this._disposers.forEach(dispose => dispose());
        this._disposers = [];
        if (this._editor) {
            this._editor.dispose();
            this._editor = null;
        }
    }
}

export const editorStore = new EditorStore();

// Expose for testing/debugging
if (typeof window !== 'undefined' && (window as any).__TEST_ENABLE_GLOBALS) {
    (window as any).__TEST_editorStore = editorStore;
}
