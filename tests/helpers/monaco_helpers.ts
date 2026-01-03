import type { Page } from '@playwright/test';
import type * as monacoObj from 'monaco-editor';
import type { Token } from 'monaco-editor';

type Monaco = typeof monacoObj;

/**
 * Retrieves tokens from the Monaco editor instance on the page.
 * Assumes the editor is already loaded and the model has content.
 */
export async function getTokens(page: Page, text: string): Promise<Token[][]> {
    return await page.evaluate((content: string) => {
        const win = window as unknown as { monaco?: Monaco };
        const monaco = win.monaco;
        if (!monaco || !monaco.editor) {
            throw new Error('Monaco editor API not found.');
        }

        // Fallback to static tokenization as model.getLineTokens is not reliably exposed in this context
        // This means embedded tokens might be simplified, but ensures consistency with test expectations.
        const tokens = monaco.editor.tokenize(content, 'asciidoc');
        return tokens;
    }, text);
}

export interface RichToken {
    type: string;
    offset: number;
    text: string;
}

export interface LineTokens {
    lineIndex: number;
    lineText: string;
    tokens: RichToken[];
}

/**
 * Enriches raw Monaco tokens with line text and substrings.
 */
export function enrichTokens(tokens: Token[][], lineTextArray: string[]): LineTokens[] {
    return tokens.map((lineTokens, lineIndex) => {
        const lineText = lineTextArray[lineIndex];
        return {
            lineIndex: lineIndex,
            lineText: lineText,
            tokens: lineTokens.map((token, index) => {
                const nextOffset = index < lineTokens.length - 1 ? lineTokens[index + 1].offset : lineText.length;
                const tokenText = lineText.substring(token.offset, nextOffset);
                return {
                    type: token.type,
                    offset: token.offset,
                    text: tokenText
                };
            })
        };
    });
}
