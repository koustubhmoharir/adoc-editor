import { observable, action } from "mobx";
import * as monaco from 'monaco-editor';
import { registerAsciiDoc } from '../utils/asciidocMode';

class EditorStore {
    @observable accessor content: string = "= Hello AsciiDoc\n\n* List item 1\n* List item 2\n\n[source,javascript]\n----\nconsole.log('Hello');\n----";
    editor: monaco.editor.IStandaloneCodeEditor | null = null;
    disposers: (() => void)[] = [];

    @action
    setContent(newContent: string) {
        this.content = newContent;
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
