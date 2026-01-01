import React, { useEffect, useState, useRef } from 'react';
import { observer } from 'mobx-react-lite';
import { editorStore } from '../store/EditorStore';
import * as styles from './TokensSidebar.css';
import * as monaco from 'monaco-editor';

interface TokenInfo {
    line: number;
    type: string;
    text: string;
    startColumn: number;
    endColumn: number;
}

export const TokensSidebar: React.FC = observer(() => {
    const [tokens, setTokens] = useState<TokenInfo[]>([]);
    const [activeTokenIndex, setActiveTokenIndex] = useState<number | null>(null);
    const listRef = useRef<HTMLDivElement>(null);

    // Check if feature is enabled
    if (!window.__SHOW_TOKENS__) {
        return null;
    }

    const updateTokens = () => {
        const editor = editorStore.editor;
        if (!editor) return;

        const model = editor.getModel();
        if (!model) return;

        // Use monaco.editor.tokenize to get tokens
        // This is a rough approximation as it tokenizes from scratch
        // but for visualization it's usually sufficient and easier than decoding binary metadata
        const rawTokens = monaco.editor.tokenize(model.getValue(), 'asciidoc');

        const flatTokens: TokenInfo[] = [];
        const lines = model.getValue().split('\n');

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
                    </div>
                ))}
            </div>
        </div>
    );
});
