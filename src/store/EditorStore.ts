import { observable, action, runInAction } from "mobx";
import * as monaco from 'monaco-editor';
import { registerAsciiDoc } from '../languages/asciidoc';
import { registerToml } from '../languages/toml';
import { fileSystemStore } from './FileSystemStore';

// MARKER: WELCOME_CONTENT_START
const WELCOME_CONTENT = `
= ADoc Editor

Welcome to the ADoc Editor!

== Features

* Syntax highlighting
* File system integration
* Auto-save functionality

Click the "Help" icon in the title bar to see this message again.

`;
// MARKER: WELCOME_CONTENT_END

export class EditorStore {

    constructor() { }

    private _editor: monaco.editor.IStandaloneCodeEditor | null = null;
    get editor() { return this._editor; }

    @observable private accessor _savedAltVersionId: number | undefined = undefined;
    @observable private accessor _currentAltVersionId: number | undefined = undefined;

    get dirty() { return this._savedAltVersionId !== this._currentAltVersionId; }

    private _disposers: (() => void)[] = [];

    // Language state
    @observable private accessor _currentLanguage: string = 'plaintext';
    get currentLanguage() { return this._currentLanguage; }

    getContent() { return this._editor?.getValue() ?? ''; }

    async saveContent(writable: FileSystemWritableFileStream) {
        if (!this._editor) return;
        const model = this._editor.getModel();
        if (!model) return;
        const content = this._editor.getValue();
        const altVerId = model.getAlternativeVersionId()
        await writable.write(content);
        await writable.close();
        runInAction(() => {
            this._savedAltVersionId = altVerId;
        });
    }

    @action
    loadContent(newContent: string) {
        if (!this._editor) return;
        const model = this._editor.getModel();
        if (!model) return;
        this._editor.setValue(newContent);
        this._savedAltVersionId = this._currentAltVersionId;
    }

    @action
    markNotDirty() {
        this._savedAltVersionId = this._currentAltVersionId;
    }

    @action
    showHelp() {
        this.loadContent(WELCOME_CONTENT);
    }

    @action
    setLanguageId(langId: string) {
        if (!this._editor) return;
        const model = this._editor.getModel();
        if (model) {
            monaco.editor.setModelLanguage(model, langId);
        }
    }

    get availableLanguages() {
        return monaco.languages.getLanguages();
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
            '.yml': 'yaml',
            '.toml': 'toml'
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

        this.setLanguageId(langId);
    }

    @action
    focusEditor() {
        this._editor?.focus();
    }

    @action
    initialize(container: HTMLDivElement) {
        registerAsciiDoc();
        registerToml();

        this._editor = monaco.editor.create(container, {
            value: WELCOME_CONTENT,
            language: 'asciidoc',
            automaticLayout: true,
            minimap: { enabled: false },
            wordWrap: 'on'
        });

        // Sync content changes
        const model = this._editor.getModel();
        if (model) {
            const contentDisposable = model.onDidChangeContent(action(() => {
                this._currentAltVersionId = model.getAlternativeVersionId();
            }));
            this._disposers.push(() => contentDisposable.dispose());

            // Sync language changes
            const langDisposable = model.onDidChangeLanguage(() => {
                runInAction(() => {
                    this._currentLanguage = model.getLanguageId();
                });
            });
            this._disposers.push(() => langDisposable.dispose());

            // Initial sync
            runInAction(() => {
                this._currentLanguage = model.getLanguageId();
            });
        }

        // Handle Escape to focus sidebar
        // PRECONDITION: Only if other widgets are NOT visible
        this._editor.addCommand(monaco.KeyCode.Escape, () => {
            fileSystemStore.focusCurrentFileInSidebar();
        }, '!findWidgetVisible && !suggestWidgetVisible && !parameterHintsVisible && !referenceSearchVisible && !renameInputVisible');

        // Handle Ctrl+S to save
        this._editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
            fileSystemStore.saveFile();
        });
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
