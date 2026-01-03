import React, { useEffect, useState, useRef } from 'react';
import { observer } from 'mobx-react-lite';
import { editorStore } from '../store/EditorStore';
import * as styles from './TokensSidebar.css';
import * as monaco from 'monaco-editor';
import { fileSystemStore } from '../store/FileSystemStore';

interface TokenInfo {
    line: number;
    type: string;
    text: string;
    startColumn: number;
    endColumn: number;
}

interface TokenCheck {
    line: number;
    tokenContent: string;
    tokenTypes: string[];
}

interface Expectation {
    checks: TokenCheck[];
}

export const TokensSidebar: React.FC = observer(() => {
    const [tokens, setTokens] = useState<TokenInfo[]>([]);
    const [activeTokenIndex, setActiveTokenIndex] = useState<number | null>(null);
    const [expectations, setExpectations] = useState<Expectation | null>(null);
    const listRef = useRef<HTMLDivElement>(null);

    // Check if feature is enabled
    if (!window.__SHOW_TOKENS__) {
        return null;
    }

    useEffect(() => {
        const loadExpectations = async () => {
            const handle = fileSystemStore.currentFileHandle;
            if (!handle) {
                setExpectations(null);
                return;
            }

            const name = handle.name;
            if (!name.endsWith('.adoc')) {
                setExpectations(null);
                return;
            }

            const jsonName = name.replace(/\.adoc$/, '.json');
            const jsonHandle = await fileSystemStore.findSiblingFile(handle, jsonName);

            if (!jsonHandle) {
                setExpectations(null);
                return;
            }

            try {
                const file = await jsonHandle.getFile();
                const text = await file.text();
                const json = JSON.parse(text);
                setExpectations(json);
            } catch (e) {
                console.error('Error loading expectations', e);
                setExpectations(null);
            }
        };

        loadExpectations();
    }, [fileSystemStore.currentFileHandle]);

    const updateTokens = () => {
        const editor = editorStore.editor;
        if (!editor) return;

        const model = editor.getModel();
        if (!model) return;

        // Use monaco.editor.tokenize to get tokens
        const rawTokens = monaco.editor.tokenize(model.getValue(), 'asciidoc');

        const flatTokens: TokenInfo[] = [];
        // ...

        const lines = model.getLinesContent();

        rawTokens.forEach((lineTokens, lineIndex) => {
            const lineNumber = lineIndex + 1;
            const lineContent = lines[lineIndex];

            for (let i = 0; i < lineTokens.length; i++) {
                const token = lineTokens[i];
                const nextToken = lineTokens[i + 1];
                const startColumn = token.offset + 1;
                const endColumn = nextToken ? nextToken.offset + 1 : lineContent.length + 1;

                // Skip empty tokens if any
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

        setTokens(flatTokens);
    };

    useEffect(() => {
        const editor = editorStore.editor;
        if (!editor) return;

        updateTokens();

        const disposables: monaco.IDisposable[] = [];

        // Update tokens on content change
        disposables.push(editor.onDidChangeModelContent(() => {
            updateTokens();
        }));

        return () => {
            disposables.forEach(d => d.dispose());
        };
    }, [editorStore.editor]);

    // Separate effect for selection sync to avoid re-binding listeners often
    useEffect(() => {
        const editor = editorStore.editor;
        if (!editor) return;

        const disposables: monaco.IDisposable[] = [];

        disposables.push(editor.onDidChangeCursorPosition((e) => {
            const pos = e.position;
            const idx = tokens.findIndex(t =>
                t.line === pos.lineNumber &&
                pos.column >= t.startColumn &&
                pos.column <= t.endColumn
            );
            setActiveTokenIndex(idx !== -1 ? idx : null);

            // Scroll to active token
            if (idx !== -1 && listRef.current) {
                const el = listRef.current.children[idx] as HTMLElement;
                if (el) {
                    el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
                }
            }
        }));

        return () => disposables.forEach(d => d.dispose());
    }, [tokens, editorStore.editor]);


    const handleTokenClick = (token: TokenInfo) => {
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
    };

    const checkedTokenIndices = React.useMemo(() => {
        if (!expectations || tokens.length === 0) return new Set<number>();

        const matched = new Set<number>();
        const checks = expectations.checks;



        const checksByLine = new Map<number, TokenCheck[]>();
        checks.forEach(c => {
            if (!checksByLine.has(c.line)) checksByLine.set(c.line, []);
            checksByLine.get(c.line)!.push(c);
        });

        const tokensByLine = new Map<number, { token: TokenInfo, index: number }[]>();
        tokens.forEach((t, i) => {
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
    }, [tokens, expectations]);

    return (
        <div className={styles.sidebar}>
            <div className={styles.header}>
                <span>Token Visualization</span>
                <span>{tokens.length}</span>
            </div>
            <div className={styles.tokenList} ref={listRef}>
                {tokens.map((token, index) => (
                    <div
                        key={`${token.line}-${token.startColumn}`}
                        className={`${styles.tokenItem} ${index === activeTokenIndex ? styles.activeToken : ''}`}
                        onClick={() => handleTokenClick(token)}
                    >
                        <span className={styles.tokenLine}>{token.line}</span>
                        <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', flex: 1 }}>
                            <span className={styles.tokenType} title={token.type}>{token.type}</span>
                            <span className={styles.tokenText} title={token.text}>{token.text}</span>
                        </div>
                        {checkedTokenIndices.has(index) && (
                            <span className={styles.checkIcon} title="Valid test case">✓</span>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
});
