const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const filename = process.argv[2];

if (!filename) {
    console.error('Please provide a filename (e.g., my_test.adoc)');
    process.exit(1);
}

const baseName = path.basename(filename, '.adoc');
const fixturesDir = path.join(__dirname, '../tests/fixtures');
const tokensPath = path.join(fixturesDir, `${baseName}-tokens.json`);

console.log(`\n--- Step 1: Analyzing ${baseName}.adoc ---`);
try {
    execSync(`node scripts/analyze_adoc.js ${filename}`, { stdio: 'inherit' });
} catch (e) {
    console.error('Analysis failed.');
    process.exit(1);
}

console.log(`\n--- Step 2: Generating tokens (Running Playwright) ---`);
console.log('Note: This test run uses the browser to tokenize the file. It will fail because the checks file does not exist yet. This is expected.');

try {
    // Run playwright ONLY for this test file
    // We expect it to fail, so we wrap in try-catch and ignore the error, 
    // provided the tokens file is created.
    execSync(`npx playwright test -g "${baseName} Highlighting"`, { stdio: 'inherit' });
} catch (e) {
    // Check if tokens file exists
    if (fs.existsSync(tokensPath)) {
        console.log('Token generation successful (Test failed as expected).');
    } else {
        console.error('Token generation failed. Tokens file was not created.');
        process.exit(1);
    }
}

console.log(`\n--- Step 3: Generating Expectations ---`);
try {
    execSync(`node scripts/generate_expectations.js ${filename}`, { stdio: 'inherit' });
} catch (e) {
    console.error('Expectation generation failed.');
    process.exit(1);
}

console.log(`\n--- Step 4: Verifying (Running Playwright Again) ---`);
try {
    execSync(`npx playwright test -g "${baseName} Highlighting"`, { stdio: 'inherit' });
    console.log(`\nSUCCESS: Test data generated and verified for ${filename}`);
} catch (e) {
    console.error(`\nFAILURE: Verification failed for ${filename}. Check the output above.`);
    process.exit(1);
}
