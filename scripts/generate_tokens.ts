import { chromium } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { getTokens, enrichTokens } from '../tests/helpers/monaco_helpers.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURES_DIR = path.join(__dirname, '../tests/fixtures');

export async function generateTokens(files: string[]) {
    console.log(`Starting token generation for ${files.length} files...`);
    const browser = await chromium.launch();
    const context = await browser.newContext();
    const page = await context.newPage();

    let successCount = 0;
    let failCount = 0;

    try {
        // Go to app
        const ports = [8000, 8001, 8002, 8003, 3000, 3001, 3002, 8080];
        let connected = false;

        for (const port of ports) {
            const url = `http://127.0.0.1:${port}`;
            try {
                console.log(`Trying ${url}...`);
                await page.goto(url, { timeout: 10000 }); // Increase to 10s to be safe
                // If we get here, check if we have the editor or just some random page?
                // The app root should load. We wait for selector later.
                connected = true;
                console.log(`Connected to ${url}`);
                break;
            } catch (e: any) {
                console.log(`Failed ${url}: ${e.message}`);
                // Ignore and try next
            }
        }

        if (!connected) {
            console.error('Failed to connect to dev server on monitored ports (8000-8003, 3000-3002, 8080). Is it running?');
            throw new Error('Connection failed');
        }

        await page.waitForSelector('.monaco-editor');
        // Wait for monaco global
        await page.waitForFunction(() => (window as any).monaco !== undefined);

        for (const file of files) {
            const filePath = path.join(FIXTURES_DIR, file);
            if (!fs.existsSync(filePath)) {
                console.warn(`File not found: ${filePath}`);
                continue;
            }

            const content = fs.readFileSync(filePath, 'utf-8');
            console.log(`Processing ${file}...`);

            try {
                const rawTokens = await getTokens(page, content);
                const lines = content.split(/\r?\n/);
                const richTokens = enrichTokens(rawTokens, lines);

                const tokenPath = path.join(FIXTURES_DIR, file.replace('.adoc', '-tokens.json'));
                fs.writeFileSync(tokenPath, JSON.stringify(richTokens, null, 2));
                successCount++;
            } catch (err) {
                console.error(`Error processing ${file}:`, err);
                failCount++;
            }
        }

    } finally {
        await browser.close();
        console.log(`Token generation complete. Success: ${successCount}, Failed: ${failCount}`);
    }
}

// CLI Support
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
    const args = process.argv.slice(2);
    if (args.length > 0) {
        generateTokens(args).catch(e => {
            console.error(e);
            process.exit(1);
        });
    } else {
        console.log('Usage: node scripts/generate_tokens.ts <file1.adoc> [file2.adoc] ...');
    }
}
