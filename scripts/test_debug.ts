
import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';

const cwd = process.cwd();
const failureFile = path.resolve(cwd, '.first_failure');

// Helper to spawn a process
function spawnCommand(cmd: string, args: string[], env: NodeJS.ProcessEnv = {}, stdio: any = 'inherit'): Promise<number | null> {
    return new Promise((resolve, reject) => {
        const process = spawn(cmd, args, {
            stdio: stdio,
            cwd: cwd,
            shell: false,
            env: { ...global.process.env, ...env }
        });

        process.on('close', (code) => {
            resolve(code);
        });

        process.on('error', (err) => {
            reject(err);
        });
    });
}

function escapeRegexLiteral(str: string) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function run() {
    console.log('Starting smart test execution...');

    // 1. Clean up failure file
    if (fs.existsSync(failureFile)) {
        try { fs.unlinkSync(failureFile); } catch (e) { }
    }

    // 2. Determine pnpm exec command
    const playwrightCli = path.resolve(
        'node_modules',
        '@playwright',
        'test',
        'cli.js'
    );

    const userArgs = process.argv.slice(2);

    // Check for help
    if (userArgs.includes('--help') || userArgs.includes('-h')) {
        console.log(`
Usage: pnpm run test -- [options]

Runs all tests using Playwright. If any test fails, re-runs the *first* failure in debug mode.

Options:
  --                  Pass arguments to Playwright (must appear before Playwright args)
  -g, --grep <pattern>  Run tests matching this regular expression
  --headed            Run tests in headed mode (visible browser)
  [file]              Run tests in specific file(s)

Examples:
  pnpm run test                                      Run all tests
  pnpm run test -- -g "rename"                       Run tests with "rename" in title
  pnpm run test -- tests/editor_filesystem.spec.ts   Run specific test file
  pnpm run test -- --headed                          Run in headed mode
`);
        process.exit(0);
    }

    // 3. Run Verify
    // We pass arguments directly to the verify command. 
    // pnpm run test-verify -- <args>
    const reporterPath = './scripts/first_fail_reporter.js';

    const verifyArgs = [
        playwrightCli,
        'test',
        `--reporter=${reporterPath},line`,
        ...userArgs
    ];

    //console.log("Running", process.execPath, "with args", verifyArgs);
    const verifyExitCode = await spawnCommand(process.execPath, verifyArgs);

    if (verifyExitCode === 0) {
        console.log('\nAll tests passed successfully.');
        process.exit(0);
    }

    // 4. Handle Failure
    if (fs.existsSync(failureFile)) {
        console.log('\nTest failure detected. Switching to debug mode for the first failing test...\n');

        try {
            const failureData = JSON.parse(fs.readFileSync(failureFile, 'utf8'));
            const { file, title } = failureData;

            if (file && title) {
                // Ensure relative path with forward slashes for Windows compatibility in args
                const relativeFile = path.relative(cwd, file).replace(/\\/g, '/');

                const literalTitle = escapeRegexLiteral(title);
                const exactMatch = `${literalTitle}$`;

                const debugArgs = [
                    playwrightCli,
                    'test',
                    '--reporter=json',
                    '--workers=1',
                    relativeFile,
                    '-g',
                    exactMatch
                ];

                const env = { FORCE_COLOR: '0', DEBUG_TESTS: '1' };
                const debugLogPath = path.resolve(cwd, 'test_failure_debug.txt');
                const logFd = fs.openSync(debugLogPath, 'w');

                //console.log("Running", process.execPath, "with args", debugArgs, "and env", env);


                const debugExitCode = await spawnCommand(process.execPath, debugArgs, env, ['inherit', logFd, 'inherit']);
                fs.closeSync(logFd);

                console.log(`\nDebug run completed. Make sure that you read the debug output from ${debugLogPath}`);
                process.exit(debugExitCode ?? 1);
            }
        } catch (e) {
            console.error('Error reading failure file:', e);
        }
    } else {
        console.log('\nTests failed, but no specific test failure was captured.');
    }
    process.exit(verifyExitCode ?? 1);
}


run().catch(err => {
    console.error('Smart test execution failed:', err);
    process.exit(1);
});
