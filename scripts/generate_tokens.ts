import { chromium } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { getTokens, enrichTokens } from '../tests/helpers/monaco_helpers.ts';
import { SERVER_URL, SERVER_PORT, SERVER_HOST } from './devserver.config.ts';

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
        const url = SERVER_URL;
        let connected = false;

        try {
            console.log(`Trying ${url}...`);
            await page.goto(url, { timeout: 4000 });
            connected = true;
            console.log(`Connected to ${url}`);
        } catch (e: any) {
            // Check failed
        }

        if (!connected) {
            console.log('No running server found. Starting dev server...');
            const { spawn, execSync } = await import('child_process');

            // Start the server
            const serverProcess = spawn('npm', ['start'], {
                detached: true,
                stdio: 'ignore',
                shell: true
            });

            // Allow the script to exit even if this process is running
            serverProcess.unref();

            // Wait for it to be ready
            console.log('Waiting for server to become available...');
            const maxRetries = 30;
            for (let i = 0; i < maxRetries; i++) {
                try {
                    await new Promise(r => setTimeout(r, 1000));
                    await page.goto(SERVER_URL, { timeout: 4000 });
                    connected = true;
                    console.log(`Server started and connected on port ${SERVER_PORT}`);

                    // Register cleanup
                    process.on('exit', () => {
                        try {
                            if (process.platform === 'win32') {
                                execSync(`taskkill /pid ${serverProcess.pid} /T /F`);
                            } else {
                                process.kill(-serverProcess.pid!, 'SIGTERM');
                            }
                        } catch (e) { /* ignore */ }
                    });
                    break;
                } catch (e) {
                    process.stdout.write('.');
                }
            }
            console.log('');
        }

        if (!connected) {
            console.error('Failed to start or connect to dev server.');
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
            } catch (err: any) {
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
