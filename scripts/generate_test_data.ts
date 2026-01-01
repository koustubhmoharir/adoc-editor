import { analyzeFile } from './analyze_adoc.ts';
import { generateExpectations } from './generate_expectations.ts';
import { generateTokens } from './generate_tokens.ts';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURES_DIR = path.join(__dirname, '../tests/fixtures');

async function main() {
    const args = process.argv.slice(2);
    const all = args.includes('--all');
    let files: string[] = [];

    if (all) {
        files = fs.readdirSync(FIXTURES_DIR).filter(f => f.endsWith('.adoc'));
        console.log(`Found ${files.length} .adoc files in fixtures.`);
    } else {
        const file = args.find(a => !a.startsWith('--'));
        if (file) {
            // Check if full path or just filename
            if (fs.existsSync(file) && file.endsWith('.adoc')) {
                files = [path.basename(file)];
            } else if (fs.existsSync(path.join(FIXTURES_DIR, file))) {
                files = [path.basename(file)];
            } else if (file.endsWith('.adoc')) {
                // Assume it's in fixtures if it looks like one, even if check fails (maybe user just typed name)
                files = [file];
            } else {
                console.error(`File not found or not .adoc: ${file}`);
                process.exit(1);
            }
        } else {
            console.error('Usage: generate_test_data.ts <filename> | --all');
            process.exit(1);
        }
    }

    if (files.length === 0) {
        console.log("No files to process.");
        return;
    }

    console.log(`\n=== 1. Analyzing ${files.length} files ===`);
    for (const file of files) {
        analyzeFile(file);
    }

    console.log(`\n=== 2. Generating Tokens (Playwright) ===`);
    await generateTokens(files);

    console.log(`\n=== 3. Generating Expectations ===`);
    for (const file of files) {
        generateExpectations(file);
    }

    console.log(`\n=== 4. Verifying (Running Tests) ===`);
    try {
        if (all) {
            console.log("Running all tests...");
            execSync('npx playwright test', { stdio: 'inherit' });
        } else {
            const baseName = files[0].replace('.adoc', '');
            console.log(`Running test for ${baseName}...`);
            // Use regex word boundary to match exact test name if possible
            execSync(`npx playwright test -g "\\b${baseName} Highlighting"`, { stdio: 'inherit' });
        }
        console.log(`\nSUCCESS: Test data generated and verified.`);
    } catch (e) {
        console.error('\nFAILURE: Verification failed.');
        process.exit(1);
    }
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
