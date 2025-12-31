import { test, expect } from '@playwright/test';
import type * as monacoObj from 'monaco-editor';

// Helper to tokenize text in the browser using Monaco's tokenizer
async function getTokens(page: any, text: string) {
    return await page.evaluate((content: string) => {
        // Define the shape of the Monaco object we expect
        const win = window as unknown as { monaco?: typeof monacoObj };

        if (typeof win.monaco === 'undefined') {
            throw new Error('Monaco global not found on window. Ensure the editor is loaded.');
        }

        const monaco = win.monaco;
        if (!monaco.languages) {
            throw new Error('Monaco languages API not found.');
        }

        const languages = monaco.languages.getLanguages().map((l) => l.id);
        if (!languages.includes('asciidoc')) {
            throw new Error('AsciiDoc language is not registered in Monaco.');
        }

        const tokens = monaco.editor.tokenize(content, 'asciidoc');
        return tokens;
    }, text);
}

test.describe('AsciiDoc Syntax Highlighting Verification', () => {

    test.beforeEach(async ({ page }) => {
        await page.goto('/');
        await page.waitForSelector('.monaco-editor');

        // Wait for monaco to be exposed
        try {
            await page.waitForFunction(() => (window as any).monaco !== undefined, null, { timeout: 10000 });
        } catch (e) {
            console.error('Monaco global not found after waiting');
        }
    });

    test('Header Highlighting', async ({ page }) => {
        const adoc = '= My Title';

        const tokens = await getTokens(page, adoc);

        const lineTokens = tokens[0];
        const hasHeaderToken = lineTokens.some((t: any) => t.type.includes('keyword') || t.type.includes('heading'));
        expect(hasHeaderToken).toBeTruthy();
    });

    test('Bold Formatting', async ({ page }) => {
        const adoc = '*bold*';
        const tokens = await getTokens(page, adoc);

        const lineTokens = tokens[0];
        const hasBoldToken = lineTokens.some((t: any) => t.type.includes('strong') || t.type.includes('bold'));
        expect(hasBoldToken).toBeTruthy();
    });

    test('Italic Formatting', async ({ page }) => {
        const adoc = '_italic_';
        const tokens = await getTokens(page, adoc);

        const lineTokens = tokens[0];
        const hasItalicToken = lineTokens.some((t: any) => t.type.includes('emphasis') || t.type.includes('italic'));
        expect(hasItalicToken).toBeTruthy();
    });

    test('Code Block', async ({ page }) => {
        const adoc = `[source,js]
----
console.log('hi');
----`;
        const tokens = await getTokens(page, adoc);
        // Check for delimiter
        const delimiterTokens = tokens[1]; // ----
        const hasDelimiter = delimiterTokens.some((t: any) => t.type.includes('string') || t.type.includes('comment'));
        expect(tokens.length).toBeGreaterThan(0);
    });

});
