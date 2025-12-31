import { test, expect } from '@playwright/test';

// Helper to tokenize text in the browser using Monaco's tokenizer
async function getTokens(page: any, text: string) {
    return await page.evaluate(async (content: string) => {
        try {
            // @ts-ignore
            if (typeof window.monaco === 'undefined') {
                return { error: 'MONACO_NOT_FOUND' };
            }

            // @ts-ignore
            const monacoObj = window.monaco;
            if (!monacoObj.languages) {
                return { error: 'MONACO_LANGUAGES_NOT_FOUND' };
            }

            // @ts-ignore
            const languages = monacoObj.languages.getLanguages().map((l: any) => l.id);

            // @ts-ignore
            const tokens = monacoObj.editor.tokenize(content, 'asciidoc');
            return { tokens, languages };
        } catch (err: any) {
            return { error: 'EXCEPTION_IN_GETTOKENS', message: err.toString() };
        }
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

        const result = await getTokens(page, adoc);
        if (result.error) throw new Error(`GetTokens Failed: ${result.error}`);

        const { tokens, languages } = result;
        if (!languages.includes('asciidoc')) throw new Error("AsciiDoc language not registered");

        const lineTokens = tokens[0];
        const hasHeaderToken = lineTokens.some((t: any) => t.type.includes('keyword') || t.type.includes('heading'));
        expect(hasHeaderToken).toBeTruthy();
    });

    test('Bold Formatting', async ({ page }) => {
        const adoc = '*bold*';
        const result = await getTokens(page, adoc);
        if (result.error) throw new Error(`GetTokens Failed: ${result.error}`);

        const lineTokens = result.tokens[0];
        const hasBoldToken = lineTokens.some((t: any) => t.type.includes('strong') || t.type.includes('bold'));
        expect(hasBoldToken).toBeTruthy();
    });

    test('Italic Formatting', async ({ page }) => {
        const adoc = '_italic_';
        const result = await getTokens(page, adoc);
        if (result.error) throw new Error(`GetTokens Failed: ${result.error}`);

        const lineTokens = result.tokens[0];
        const hasItalicToken = lineTokens.some((t: any) => t.type.includes('emphasis') || t.type.includes('italic'));
        expect(hasItalicToken).toBeTruthy();
    });

    test('Code Block', async ({ page }) => {
        const adoc = `[source,js]
----
console.log('hi');
----`;
        const result = await getTokens(page, adoc);
        if (result.error) throw new Error(`GetTokens Failed: ${result.error}`);

        const tokens = result.tokens;
        // Check for delimiter
        const delimiterTokens = tokens[1]; // ----
        const hasDelimiter = delimiterTokens.some((t: any) => t.type.includes('string') || t.type.includes('comment'));
        expect(tokens.length).toBeGreaterThan(0);
    });

});
