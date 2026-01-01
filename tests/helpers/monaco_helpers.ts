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
        // Define the shape of the Monaco object we expect
        const win = window as unknown as { monaco?: Monaco };

        const monaco = win.monaco;
        if (!monaco) {
            throw new Error('Monaco global not found on window. Ensure the editor is loaded.');
        }

        if (!monaco.languages) {
            throw new Error('Monaco languages API not found.');
        }

        const languages = monaco.languages.getLanguages().map((l) => l.id);
        if (!languages.includes('asciidoc')) {
            throw new Error('AsciiDoc language is not registered in Monaco.');
        }

        // Tokenize returns Token[][]
        // We set the value first to ensure the model is up to date if we were to use the model,
        // but monaco.editor.tokenize handles text directly without needing a model instance (usually).
        // However, tokenize() is a static method that uses the tokenizer.
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
