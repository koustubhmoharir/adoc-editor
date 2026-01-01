import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FIXTURES_DIR = path.join(__dirname, '../tests/fixtures');

function generateExpectations(filename) {
    const baseName = filename.replace('.adoc', '');
    const analysisPath = path.join(FIXTURES_DIR, `${baseName}-analysis.json`);
    const tokensPath = path.join(FIXTURES_DIR, `${baseName}-tokens.json`);
    const outputPath = path.join(FIXTURES_DIR, `${baseName}.json`);

    if (!fs.existsSync(analysisPath)) {
        console.warn(`Analysis file missing for ${filename}`);
        return;
    }
    if (!fs.existsSync(tokensPath)) {
        console.warn(`Tokens file missing for ${filename} (skipping)`);
        return;
    }

    try {
        const analysis = JSON.parse(fs.readFileSync(analysisPath, 'utf8'));
        const tokens = JSON.parse(fs.readFileSync(tokensPath, 'utf8'));

        const checks = [];

        // Analysis gives: { line: 0, textContent: 'foo', tokenType: 'strong' }
        // Tokens gives: [ [ { startIndex: 0, type: '...', text: '...' } ] ] (Array of Array of Token)

        // Track used tokens to avoid creating multiple checks for the same token
        // which would cause the sequential test runner to fail.
        const matchedTokens = new Set(); // "line:index"

        analysis.forEach(exp => {
            // Tokens is an Array of { lineIndex, lineText, tokens: [...] }
            const lineItem = tokens.find(item => item.lineIndex === exp.line);
            if (!lineItem || !lineItem.tokens) {
                console.warn(`[${filename}] Line ${exp.line} not found in tokens`);
                return;
            }
            const lineTokens = lineItem.tokens;

            const matchingTokens = lineTokens.map((t, i) => ({ token: t, index: i })).filter(({ token: t, index: i }) => {
                if (matchedTokens.has(`${exp.line}:${i}`)) return false;

                // Check type first
                if (!t.type.includes(exp.tokenType)) return false;

                // Check text
                return exp.textContent.includes(t.text) || t.text.includes(exp.textContent);
            });

            if (matchingTokens.length > 0) {
                const match = matchingTokens[0];
                matchedTokens.add(`${exp.line}:${match.index}`);
                const bestToken = match.token;

                const types = exp.tokenType.split('.');
                checks.push({
                    line: exp.line,
                    tokenContent: bestToken.text,
                    tokenTypes: types
                });
            }
        });

        // Write output
        const out = { checks };
        fs.writeFileSync(outputPath, JSON.stringify(out, null, 2));
        console.log(`Generated ${outputPath} with ${checks.length} checks`);
    } catch (err) {
        console.error(`Error processing ${filename}:`, err.message);
    }
}

const targetArg = process.argv[2];

if (targetArg) {
    const fileName = path.basename(targetArg);
    if (fileName.endsWith('.adoc')) {
        generateExpectations(fileName);
    } else {
        console.error('File must end with .adoc');
    }
} else {
    fs.readdirSync(FIXTURES_DIR).forEach(file => {
        if (file.endsWith('.adoc')) {
            generateExpectations(file);
        }
    });
}
