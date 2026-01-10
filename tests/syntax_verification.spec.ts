import { test as base, BrowserContext, expect, Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import type { Token } from 'monaco-editor';
// Import shared helpers. Note .js extension for resolution if needed, or rely on toolchain.
// Since this is Playwright (TS), .ts import usually fine or .js if ESM.
// Given strict browser/node separation in previous steps, let's try .js for consistency.
import { getTokens, enrichTokens, waitForMonaco } from './helpers/monaco_helpers.ts';

interface TokenCheck {
    line: number;
    tokenTypes: string[];
    tokenContent?: string;
}

interface TestFixture {
    description: string;
    checks: TokenCheck[];
}

import { fileURLToPath } from 'url';
import { enableTestLogging } from './helpers/test_logging.ts';
import { enableTestGlobals } from './helpers/test_globals.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const fixturesDir = path.join(__dirname, 'fixtures');
const repoRoot = path.join(__dirname, '..');
const files = fs.readdirSync(fixturesDir).filter(f => f.endsWith('.adoc'));

interface SharedContextPageFixtureArgs {
    page: Page;
};

interface SharedContextFixtureArgs {
    sharedPage: Page;
};

const test = base.extend<SharedContextPageFixtureArgs, SharedContextFixtureArgs>({
    sharedPage: [
        async ({ browser }, use) => {
            const context = await browser.newContext();
            const page = await context.newPage();
            
            enableTestLogging(page);
            await enableTestGlobals(page);
            await page.goto('/?skip_restore=true', { waitUntil: "domcontentloaded" });
            await waitForMonaco(page);

            await use(page);
            
            await page.close();
            await context.close();
        },
        { scope: 'worker' },
    ],
    page: async ({ sharedPage }, use) => {
        await use(sharedPage);
    },
});

test.describe('AsciiDoc Syntax Highlighting Verification', () => {

    for (const file of files) {
        const adocPath = path.join(fixturesDir, file);
        const fixturePath = adocPath.replace('.adoc', '.json');
        const tokensPath = adocPath.replace('.adoc', '-tokens.json');
        const adocContent = fs.readFileSync(adocPath, 'utf-8');
        const testName = path.basename(file, '.adoc') + ' Highlighting';

        test(testName, async ({ page }) => {
            try {
                let tokens!: Token[][];
                await test.step('Get Tokens', async () => {
                    tokens = await getTokens(page, adocContent);
                });
                const lines = adocContent.split(/\r?\n/);

                // 1. Generate {test_name}-tokens.json with rich structure using helper
                const richTokens = enrichTokens(tokens, lines);

                fs.writeFileSync(tokensPath, JSON.stringify(richTokens, null, 2));

                // 2. Check for existence of checks file
                if (!fs.existsSync(fixturePath)) {
                    const relativeFixturePath = path.relative(repoRoot, fixturePath);
                    const relativeTokensPath = path.relative(repoRoot, tokensPath);
                    throw new Error(`Fixture checks file '${relativeFixturePath}' is missing. Please inspect the generated tokens file '${relativeTokensPath}' and create the checks file.`);
                }

                const fixture: TestFixture = JSON.parse(fs.readFileSync(fixturePath, 'utf-8'));

                // Track the last matched token index for each line to assume sequential checks
                const lastMatchIndices = new Map<number, number>();

                for (const check of fixture.checks) {
                    const lineIndex = check.line;

                    const lineTokens = tokens[lineIndex];
                    const lineText = lines[lineIndex];

                    expect(lineTokens, `Tokens for line ${lineIndex} exist`).toBeDefined();
                    expect(lineText, `Text for line ${lineIndex} exists`).toBeDefined();

                    if (!check.tokenContent) {
                        throw new Error(`Fixture ${file} check at line ${lineIndex} is missing 'tokenContent'`);
                    }

                    const startIndex = (lastMatchIndices.get(lineIndex) ?? -1) + 1;
                    let foundTokenIndex = -1;
                    let foundToken: Token | null = null;

                    // Find the first token *after* startIndex that matches the content
                    for (let i = startIndex; i < lineTokens.length; i++) {
                        const token = lineTokens[i];
                        const nextOffset = i < lineTokens.length - 1 ? lineTokens[i + 1].offset : lineText.length;
                        const tokenText = lineText.substring(token.offset, nextOffset);

                        if (tokenText === check.tokenContent) {
                            foundTokenIndex = i;
                            foundToken = token;
                            break;
                        }
                    }

                    if (foundToken) {
                        // Verify types
                        if (check.tokenTypes.length === 1 && check.tokenTypes[0].startsWith('language:')) {
                            // Special check: verify language mode
                            const expectedLang = check.tokenTypes[0].split(':')[1];
                            const actualLang = (foundToken as any).language;
                            // Check for exact match or fallback to asciidoc if nested?
                            // Ideally exact match.
                            // Note: foundToken is RichToken from monaco_helpers which HAS language.
                            // But locally typed as Token.

                            expect(actualLang, `Expected token "${check.tokenContent}" to be language "${expectedLang}"`).toBe(expectedLang);
                        } else {
                            const tokenParts = foundToken.type.split('.');
                            // Check that ALL expected types are present in the token parts (AND logic)
                            const typeMatch = check.tokenTypes.every(t => tokenParts.includes(t));
                            if (!typeMatch) {
                                console.error(`TYPE MISMATCH: Line ${lineIndex} Token "${check.tokenContent}". Expected [${check.tokenTypes}], Got "${foundToken.type}"`);
                            }
                            expect(typeMatch, `Expected token "${check.tokenContent}" to have ALL types [${check.tokenTypes.join(', ')}], but got "${foundToken.type}"`).toBeTruthy();
                        }

                        // Update last match index for this line
                        lastMatchIndices.set(lineIndex, foundTokenIndex);
                    }
                    else {
                        // Check debug info
                        console.log(`Failed to find token "${check.tokenContent}" on line ${lineIndex} starting after index ${startIndex}. Available tokens:`);
                        lineTokens.forEach((t, i) => {
                            const nextOffset = i < lineTokens.length - 1 ? lineTokens[i + 1].offset : lineText.length;
                            const txt = lineText.substring(t.offset, nextOffset);
                            console.log(`Token ${i}: text="${txt}", type="${t.type}"`);
                        });

                        expect(foundToken, `Could not find token with content "${check.tokenContent}" on line ${lineIndex} after previous check`).not.toBe(null);
                    }
                }
            } catch (e: any) {
                console.error(`TEST FAILED: ${testName}`);
                console.error(e.message);
                throw e;
            }
        });
    }
});
