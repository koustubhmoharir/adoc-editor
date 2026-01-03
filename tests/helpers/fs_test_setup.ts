import { Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Helper to create a temporary directory unique to the test
export const createTempDir = () => {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'adoc-editor-test-'));
};

export class FsTestSetup {
    tempDir1: string;
    tempDir2: string;

    constructor() {
        this.tempDir1 = createTempDir();
        this.tempDir2 = createTempDir();
        console.log(`Test running in temp dirs: ${this.tempDir1}, ${this.tempDir2}`);
    }

    cleanup() {
        try {
            fs.rmSync(this.tempDir1, { recursive: true, force: true });
            fs.rmSync(this.tempDir2, { recursive: true, force: true });
        } catch (e) {
            console.error(`Failed to cleanup temp dirs`, e);
        }
    }

    createFile(dir: 'dir1' | 'dir2', relativePath: string, content: string) {
        const baseDir = dir === 'dir1' ? this.tempDir1 : this.tempDir2;
        const fullPath = path.join(baseDir, relativePath);
        const folder = path.dirname(fullPath);
        if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });
        fs.writeFileSync(fullPath, content);
    }

    readFile(dir: 'dir1' | 'dir2', relativePath: string): string {
        const baseDir = dir === 'dir1' ? this.tempDir1 : this.tempDir2;
        return fs.readFileSync(path.join(baseDir, relativePath), 'utf8');
    }

    async init(page: Page) {
        // Helper to resolve path based on prefix (dir1 or dir2)
        const resolvePath = (virtualPath: string) => {
            const parts = virtualPath.split(/[/\\]/);
            const root = parts[0];
            const rest = parts.slice(1).join(path.sep);

            if (root === 'dir1') return path.join(this.tempDir1, rest);
            if (root === 'dir2') return path.join(this.tempDir2, rest);

            if (virtualPath === '.') return this.tempDir1;

            throw new Error(`Unknown virtual path root: ${root} in ${virtualPath}`);
        };

        // Expose bindings to bridge the mocked FS access in browser to Node fs
        await page.exposeFunction('__fs_readDir', async (dirPath: string) => {
            const fullPath = resolvePath(dirPath);
            if (!fs.existsSync(fullPath)) return [];
            const entries = fs.readdirSync(fullPath, { withFileTypes: true });
            return entries.map(e => ({
                name: e.name,
                kind: e.isDirectory() ? 'directory' : 'file'
            }));
        });

        await page.exposeFunction('__fs_readFile', async (filePath: string) => {
            const fullPath = resolvePath(filePath);
            return fs.readFileSync(fullPath, 'utf8');
        });

        await page.exposeFunction('__fs_writeFile', async (filePath: string, content: string) => {
            const fullPath = resolvePath(filePath);
            const dir = path.dirname(fullPath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(fullPath, content);
        });

        await page.exposeFunction('__fs_stat', async (filePath: string) => {
            const fullPath = resolvePath(filePath);
            try {
                const s = fs.statSync(fullPath);
                return { isDirectory: s.isDirectory(), isFile: s.isFile() };
            } catch (e) {
                // Return null or similar if not found? Original threw error to emulate native catch
                throw new Error(`File not found: ${filePath} (resolved: ${fullPath})`);
            }
        });

        // Inject the mock implementation
        await page.addInitScript('window.__ENABLE_TEST_GLOBALS__ = true;');
        // Start one level up from this file (tests/helpers) -> tests/helpers/fs_mock.js
        await page.addInitScript({ path: path.join(__dirname, 'fs_mock.js') });
    }
}
