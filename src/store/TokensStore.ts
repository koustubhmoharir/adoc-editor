import { observable, action, computed, reaction, runInAction } from 'mobx';
import * as monaco from 'monaco-editor';
import { createRef } from 'react';
import { editorStore } from './EditorStore';
import { fileSystemStore } from './FileSystemStore';

export interface TokenInfo {
    line: number;
    type: string;
    text: string;
    startColumn: number;
    endColumn: number;
}

export interface TokenCheck {
    line: number;
    tokenContent: string;
    tokenTypes: string[];
}

export interface Expectation {
    checks: TokenCheck[];
}

class TokensStore {
    @observable accessor tokens: TokenInfo[] = [];
    @observable accessor activeTokenIndex: number | null = null;
    @observable accessor expectations: Expectation | null = null;
    listRef = createRef<HTMLDivElement>();

    private disposables: monaco.IDisposable[] = [];
    private editorDisposables: monaco.IDisposable[] = [];

    constructor() {
    }

    @computed
    get checkedTokenIndices(): Set<number> {
        if (!this.expectations || this.tokens.length === 0) return new Set<number>();

        const matched = new Set<number>();
        const checks = this.expectations.checks;

        const checksByLine = new Map<number, TokenCheck[]>();
        checks.forEach(c => {
            if (!checksByLine.has(c.line)) checksByLine.set(c.line, []);
            checksByLine.get(c.line)!.push(c);
        });

        const tokensByLine = new Map<number, { token: TokenInfo, index: number }[]>();
        this.tokens.forEach((t, i) => {
            const l = t.line - 1;
            if (!tokensByLine.has(l)) tokensByLine.set(l, []);
            tokensByLine.get(l)!.push({ token: t, index: i });
        });

        checksByLine.forEach((lineChecks, lineNum) => {
            const lineTokens = tokensByLine.get(lineNum);
            if (!lineTokens) {
                return;
            }

            let tokenCursor = 0;
            lineChecks.forEach(check => {
                while (tokenCursor < lineTokens.length) {
                    const { token, index } = lineTokens[tokenCursor];
                    tokenCursor++;

                    if (token.text === check.tokenContent) {
                        matched.add(index);
                        // Check strictly one match per check? Yes, consistent with sequential verification.
                        break;
                    }
                }
            });
        });

        return matched;
    }

    @action
    initialize() {
        // Initial load
        this.loadExpectations();

        // Wait for editor to be ready if needed, or just update if it is
        if (editorStore.editor) {
            this.updateTokens();
            this.setupEditorListeners(editorStore.editor);
        }

        // React to editor changes if the editor instance itself changes (re-created)
        const d1 = reaction(
            () => editorStore.editor,
            (editor) => {
                if (editor) {
                    this.updateTokens();
                    this.setupEditorListeners(editor);
                }
            }
        );

        // React to file changes to reload expectations
        const d2 = reaction(
            () => fileSystemStore.currentFileHandle,
            () => {
                this.loadExpectations();
            }
        );

        this.disposables.push({ dispose: d1 }, { dispose: d2 });
    }

    private cleanupEditorListeners() {
        this.editorDisposables.forEach(d => d.dispose());
        this.editorDisposables = [];
    }

    private setupEditorListeners(editor: monaco.editor.IStandaloneCodeEditor) {
        this.cleanupEditorListeners();

        this.editorDisposables.push(editor.onDidChangeModelContent(() => {
            this.updateTokens();
        }));

        this.editorDisposables.push(editor.onDidChangeCursorPosition((e) => {
            const pos = e.position;
            // We can read tokens directly since we are in the store
            const idx = this.tokens.findIndex(t =>
                t.line === pos.lineNumber &&
                pos.column >= t.startColumn &&
                pos.column <= t.endColumn
            );

            runInAction(() => {
                this.activeTokenIndex = idx !== -1 ? idx : null;
            });

            this.scrollToActiveToken();
        }));
    }

    @action
    dispose() {
        this.disposables.forEach(d => d.dispose());
        this.disposables = [];
        this.cleanupEditorListeners();
    }

    async loadExpectations() {
        const handle = fileSystemStore.currentFileHandle;
        if (!handle) {
            runInAction(() => this.expectations = null);
            return;
        }

        const name = handle.name;
        if (!name.endsWith('.adoc')) {
            runInAction(() => this.expectations = null);
            return;
        }

        const jsonName = name.replace(/\.adoc$/, '.json');
        const jsonHandle = await fileSystemStore.findSiblingFile(handle, jsonName);

        if (!jsonHandle) {
            runInAction(() => this.expectations = null);
            return;
        }

        try {
            const file = await jsonHandle.getFile();
            const text = await file.text();
            const json = JSON.parse(text);
            runInAction(() => {
                this.expectations = json;
            });
        } catch (e) {
            console.error('Error loading expectations', e);
            runInAction(() => this.expectations = null);
        }
    }

    @action
    updateTokens() {
        const editor = editorStore.editor;
        if (!editor) return;

        const model = editor.getModel();
        if (!model) return;

        const rawTokens = monaco.editor.tokenize(model.getValue(), 'asciidoc');
        const flatTokens: TokenInfo[] = [];
        const lines = model.getLinesContent();

        rawTokens.forEach((lineTokens, lineIndex) => {
            const lineNumber = lineIndex + 1;
            const lineContent = lines[lineIndex];

            for (let i = 0; i < lineTokens.length; i++) {
                const token = lineTokens[i];
                const nextToken = lineTokens[i + 1];
                const startColumn = token.offset + 1;
                const endColumn = nextToken ? nextToken.offset + 1 : lineContent.length + 1;

                if (startColumn === endColumn) continue;

                flatTokens.push({
                    line: lineNumber,
                    type: token.type,
                    text: lineContent.substring(startColumn - 1, endColumn - 1),
                    startColumn,
                    endColumn
                });
            }
        });

        runInAction(() => {
            this.tokens = flatTokens;
        });
    }

    @action
    handleTokenClick(token: TokenInfo) {
        const editor = editorStore.editor;
        if (editor) {
            editor.setSelection(new monaco.Selection(
                token.line,
                token.startColumn,
                token.line,
                token.endColumn
            ));
            editor.revealPositionInCenter({ lineNumber: token.line, column: token.startColumn });
            editor.focus();
        }
    }

    scrollToActiveToken() {
        if (this.activeTokenIndex !== null && this.activeTokenIndex !== -1 && this.listRef.current) {
            const el = this.listRef.current.children[this.activeTokenIndex] as HTMLElement;
            if (el) {
                el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            }
        }
    }
}

export const tokensStore = new TokensStore();
