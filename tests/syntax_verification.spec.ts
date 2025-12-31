import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import type * as monacoObj from 'monaco-editor';

// Helper to tokenize text in the browser using Monaco's tokenizer
async function getTokens(page: Page, text: string) {
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

        // Tokenize returns Token[][]
        const tokens = monaco.editor.tokenize(content, 'asciidoc');
        return tokens;
    }, text);
}

interface TokenCheck {
    line: number;
    tokenTypes: string[];
    tokenContent?: string;
}

interface TestFixture {
    description: string;
    checks: TokenCheck[];
}

const fixturesDir = path.join(__dirname, 'fixtures');
const files = fs.readdirSync(fixturesDir).filter(f => f.endsWith('.json'));

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

    for (const file of files) {
        const fixturePath = path.join(fixturesDir, file);
        const fixture: TestFixture = JSON.parse(fs.readFileSync(fixturePath, 'utf-8'));
        const adocPath = fixturePath.replace('.json', '.adoc');

        if (!fs.existsSync(adocPath)) {
            console.warn(`Skipping fixture ${file}: missing .adoc file`);
            continue;
        }

        const adocContent = fs.readFileSync(adocPath, 'utf-8');

        test(fixture.description, async ({ page }) => {
            const tokens = await getTokens(page, adocContent);
            const lines = adocContent.split(/\r?\n/);

            for (const check of fixture.checks) {
                const lineTokens = tokens[check.line];
                const lineText = lines[check.line];

                // Verify check.line is within bounds
                expect(lineTokens, `Tokens for line ${check.line} exist`).toBeDefined();
                expect(lineText, `Text for line ${check.line} exists`).toBeDefined();

                // Find a matching token in the line
                const matchingToken = lineTokens.find((token, index) => {
                    // Calculate token text
                    const nextOffset = index < lineTokens.length - 1 ? lineTokens[index + 1].offset : lineText.length;
                    const tokenText = lineText.substring(token.offset, nextOffset);

                    // Check type (OR logic)
                    const typeMatch = check.tokenTypes.some(t => token.type.includes(t));

                    // Check content if specified
                    const contentMatch = check.tokenContent ? tokenText === check.tokenContent : true;

                    return typeMatch && contentMatch;
                });

                if (!matchingToken) {
                    console.log(`Failed to find token on line ${check.line}. Available tokens:`);
                    lineTokens.forEach((t, i) => {
                        const nextOffset = i < lineTokens.length - 1 ? lineTokens[i + 1].offset : lineText.length;
                        const txt = lineText.substring(t.offset, nextOffset);
                        console.log(`Token ${i}: text="${txt}", type="${t.type}"`);
                    });
                }


                expect(matchingToken,
                    `Expected token on line ${check.line} with types [${check.tokenTypes.join(', ')}]` +
                    (check.tokenContent ? ` and content "${check.tokenContent}"` : '')
                ).toBeTruthy();
            }
        });
    }
});
