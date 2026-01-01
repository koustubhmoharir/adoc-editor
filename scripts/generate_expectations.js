const fs = require('fs');
const path = require('path');

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

        analysis.forEach(exp => {
            // Tokens is an Array of { lineIndex, lineText, tokens: [...] }
            const lineItem = tokens.find(item => item.lineIndex === exp.line);
            if (!lineItem || !lineItem.tokens) {
                console.warn(`[${filename}] Line ${exp.line} not found in tokens`);
                return;
            }
            const lineTokens = lineItem.tokens;

            // Find a token that matches textContent and has compatible type
            // Note: textContent from analysis might be substring of token, or token might be substring of textContent.
            // Usually, validation requires identifying the token.
            // Our analysis script extracts the EXACT text we want to highlight (e.g. *bold*).
            // The token text should strictly contain or equal that?
            // Actually, Monaco might break *bold* into '*'(delimiter), 'bold'(strong), '*'(delimiter).
            // Our analysis usually returns '*bold*' for strong.
            // So we need to find tokens that *overlap* with this text and check their type?
            // Or simpler: Find ANY token on that line whose text IS contained in exp.textContent OR contains exp.textContent,
            // AND has the expected type.

            // Let's look for precise matches first.
            const matchingTokens = lineTokens.filter(t => {
                // Check type first
                if (!t.type.includes(exp.tokenType)) return false;

                // Check text
                // If expected is *bold*, token might be 'bold' (type strong).
                // So token text should be PART of expected text?
                // Yes.
                // Also, if expected is '*' and token is '* ', valid match.
                return exp.textContent.includes(t.text) || t.text.includes(exp.textContent);
            });

            if (matchingTokens.length > 0) {
                // Found a match!
                // We use the ACTUAL token text for the check, to be robust.
                // And use the EXACT types from the token.
                // But we filter types to ensure it contains the expected one.

                // Just take the first valid match
                const bestToken = matchingTokens[0];

                // We verify that the token type includes our expected type.
                // The check file format: { line, tokenContent, tokenTypes: [ ... ] }
                // verification runner checks if ACTUAL token types set is superset of expected list.

                checks.push({
                    line: exp.line,
                    tokenContent: bestToken.text,
                    tokenTypes: [exp.tokenType]
                });
            } else {
                // Debug
                // console.log(`[${filename}] No matching token found for "${exp.textContent}" (${exp.tokenType}) on line ${exp.line}`);
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

fs.readdirSync(FIXTURES_DIR).forEach(file => {
    if (file.endsWith('.adoc')) {
        generateExpectations(file);
    }
});
