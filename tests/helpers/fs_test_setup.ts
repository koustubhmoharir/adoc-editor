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
    private readonly tempDirs = new Map<string, string>();

    cleanup() {
        for (const path of this.tempDirs.values()) {
            try {
                fs.rmSync(path, { recursive: true, force: true });
            } catch (e) {
                console.error(`Failed to cleanup temp dirs`, e);
            }
        }
        this.tempDirs.clear();
    }

    createFile(dirName: string, relativePath: string, content: string | Buffer) {
        let baseDir = this.tempDirs.get(dirName);
        if (baseDir === undefined) {
            baseDir = createTempDir();
            this.tempDirs.set(dirName, baseDir);
        }
        const fullPath = path.join(baseDir, relativePath);
        const folder = path.dirname(fullPath);
        if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });

        if (Buffer.isBuffer(content)) {
            fs.writeFileSync(fullPath, content);
        } else {
            fs.writeFileSync(fullPath, content as string);
        }
    }

    readFile(dirName: string, relativePath: string): string {
        const baseDir = this.tempDirs.get(dirName);
        if (baseDir === undefined) throw new Error(`Directory not created for ${dirName}`);
        return fs.readFileSync(path.join(baseDir, relativePath), 'utf8');
    }

    exists(dirName: string, relativePath: string): boolean {
        const baseDir = this.tempDirs.get(dirName);
        if (baseDir === undefined) throw new Error(`Directory not created for ${dirName}`);
        return fs.existsSync(path.join(baseDir, relativePath));
    }

    // Renamed from init to register to verify it is only called once per page
    async register(page: Page) {
        // Helper to resolve path based on prefix (dir1 or dir2)
        const resolvePath = (virtualPath: string) => {
            if (virtualPath === '.') throw new Error(`A single . as path is not supported`);
            const parts = virtualPath.split(/[/\\]/);
            const root = parts[0];
            const rest = parts.slice(1).join(path.sep);

            const baseDir = this.tempDirs.get(root);
            if (baseDir === undefined) throw new Error(`Directory not created for ${root}`);
            return path.join(baseDir, rest);
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
            const buffer = fs.readFileSync(fullPath);
            return buffer.toString('base64');
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

        await page.exposeFunction('__fs_rename', async (oldPath: string, newPath: string) => {
            const fullOldPath = resolvePath(oldPath);
            const fullNewPath = resolvePath(newPath);
            fs.renameSync(fullOldPath, fullNewPath);
        });

        await page.exposeFunction('__fs_remove', async (filePath: string) => {
            const fullPath = resolvePath(filePath);
            fs.rmSync(fullPath, { recursive: true, force: true });
        });

        // Inject the mock implementation
        // Start one level up from this file (tests/helpers) -> tests/helpers/fs_mock.js
        await page.addInitScript({ path: path.join(__dirname, 'fs_mock.js') });
    }
}
