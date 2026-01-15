import { Page } from '@playwright/test';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

type InMemoryEntry = InMemoryFile | InMemoryDirectory;

interface InMemoryFile {
    kind: 'file';
    content: Uint8Array;
}

interface InMemoryDirectory {
    kind: 'directory';
    children: Map<string, InMemoryEntry>;
}

export class FsTestSetup {
    private readonly roots = new Map<string, InMemoryDirectory>();

    cleanup() {
        this.roots.clear();
    }

    private getRoot(dirName: string): InMemoryDirectory {
        let root = this.roots.get(dirName);
        if (!root) {
            root = { kind: 'directory', children: new Map() };
            this.roots.set(dirName, root);
        }
        return root;
    }

    private traversePath(root: InMemoryDirectory, parts: string[], create: boolean = false): InMemoryEntry | undefined {
        let current: InMemoryEntry = root;
        for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
            if (current.kind !== 'directory') {
                return undefined;
            }
            let next = current.children.get(part);
            if (!next) {
                if (create) {
                    // processing last part?
                    if (i === parts.length - 1) {
                        // caller should handle creating the final node if specific type needed, 
                        // but here we are just traversing intermediate directories usually
                        // actually traversePath is usually for finding.
                        // Let's make helper for ensureDirectory
                        return undefined;
                    }
                    // Create intermediate directory
                    next = { kind: 'directory', children: new Map() };
                    current.children.set(part, next);
                } else {
                    return undefined;
                }
            }
            current = next;
        }
        return current;
    }

    // Helper to ensure a directory path exists and return the directory node
    private ensureDirectory(root: InMemoryDirectory, parts: string[]): InMemoryDirectory {
        let current = root;
        for (const part of parts) {
            let next = current.children.get(part);
            if (!next) {
                next = { kind: 'directory', children: new Map() };
                current.children.set(part, next);
            } else if (next.kind !== 'directory') {
                throw new Error(`Path segment '${part}' is a file, expected directory`);
            }
            current = next;
        }
        return current;
    }

    createFile(dirName: string, relativePath: string, content: string | Buffer) {
        const root = this.getRoot(dirName);
        const parts = relativePath.split(/[/\\]/);
        const fileName = parts.pop();
        if (!fileName) throw new Error("Invalid file path");

        const parent = this.ensureDirectory(root, parts);

        let buffer: Uint8Array;
        if (typeof content === 'string') {
            buffer = new TextEncoder().encode(content);
        } else if (Buffer.isBuffer(content)) {
            buffer = new Uint8Array(content);
        } else {
            throw new Error("Invalid content type");
        }

        parent.children.set(fileName, { kind: 'file', content: buffer });
    }

    createDirectory(dirName: string, relativePath: string) {
        const root = this.getRoot(dirName);
        const parts = relativePath.split(/[/\\]/);
        this.ensureDirectory(root, parts);
    }

    readFile(dirName: string, relativePath: string): string {
        const root = this.getRoot(dirName);
        const parts = relativePath.split(/[/\\]/);
        const entry = this.traversePath(root, parts);

        if (!entry || entry.kind !== 'file') {
            throw new Error(`File not found: ${relativePath} in ${dirName}`);
        }

        return new TextDecoder().decode(entry.content);
    }

    exists(dirName: string, relativePath: string): boolean {
        const root = this.getRoot(dirName);
        const parts = relativePath.split(/[/\\]/);
        const entry = this.traversePath(root, parts);
        return entry !== undefined;
    }

    // Renamed from init to register to verify it is only called once per page
    async register(page: Page) {
        const resolveNode = (virtualPath: string): { parent: InMemoryDirectory, name: string, entry: InMemoryEntry | undefined } => {
            if (virtualPath === '.') throw new Error(`A single . as path is not supported`);
            const parts = virtualPath.split(/[/\\]/);
            const rootName = parts[0];
            const rest = parts.slice(1);

            // If path is just "rootName", we treat it as the root directory itself?
            // The original implementation joined with a temp dir base.
            // Here "rootName" corresponds to the key in this.roots.

            const root = this.getRoot(rootName);
            if (rest.length === 0) {
                // It's the root itself.
                // We can't really return "parent" of root easily, but usually we operate on children.
                // Let's handle special case or assume paths always have at least one component if manipulating files?
                // But readDir("root") is valid.
                return { parent: undefined as any, name: rootName, entry: root };
            }

            const parentParts = rest.slice(0, rest.length - 1);
            const fileName = rest[rest.length - 1];

            // Traverse to parent
            let parent = root;
            for (const part of parentParts) {
                const next = parent.children.get(part);
                if (!next || next.kind !== 'directory') {
                    throw new Error(`Path not found: ${virtualPath}`);
                }
                parent = next as InMemoryDirectory;
            }

            const entry = parent.children.get(fileName);
            return { parent, name: fileName, entry };
        };

        // Need to be careful about closure capturing 'this'.
        // We bind the methods to 'this' implicitly by using arrow functions or accessing 'this.roots' directly.

        await page.exposeFunction('__fs_readDir', async (dirPath: string) => {
            try {
                const { entry } = resolveNode(dirPath);
                if (!entry || entry.kind !== 'directory') return [];

                return Array.from(entry.children.entries()).map(([name, child]) => ({
                    name,
                    kind: child.kind
                }));
            } catch (e) {
                return [];
            }
        });

        await page.exposeFunction('__fs_readFile', async (filePath: string) => {
            const { entry } = resolveNode(filePath);
            if (!entry || entry.kind !== 'file') throw new Error(`File not found: ${filePath}`);

            // Convert Uint8Array to Base64 string
            // Node.js buffer handling
            return Buffer.from(entry.content).toString('base64');
        });

        await page.exposeFunction('__fs_writeFile', async (filePath: string, content: string) => {
            // Write file, creating directories if needed. 
            // Reuse logic from createDirectory/createFile but adapted for single path string
            const parts = filePath.split(/[/\\]/);
            const rootName = parts[0];
            const rest = parts.slice(1);
            if (rest.length === 0) throw new Error("Cannot write to root directory directly");

            const root = this.getRoot(rootName);
            const parentParts = rest.slice(0, rest.length - 1);
            const fileName = rest[rest.length - 1];

            const parent = this.ensureDirectory(root, parentParts);

            // Content matches fs_test_setup: string (legacy) or buffer? 
            // The exposed function receives string. fs_mock sends string buffer (sometimes accumulated).
            // in fs_mock.js: window.__fs_writeFile(path, contentBuffer);
            // In original fs_test_setup: fs.writeFileSync(fullPath, content);

            // We'll treat it as string and encode to utf8 bytes
            const buffer = new TextEncoder().encode(content);
            parent.children.set(fileName, { kind: 'file', content: buffer });
        });

        await page.exposeFunction('__fs_mkdir', async (dirPath: string) => {
            const parts = dirPath.split(/[/\\]/);
            const rootName = parts[0];
            const rest = parts.slice(1);
            const root = this.getRoot(rootName);

            // Recursive creation
            let current = root;
            for (const part of rest) {
                let next = current.children.get(part);
                if (!next) {
                    next = { kind: 'directory', children: new Map() };
                    current.children.set(part, next);
                } else if (next.kind !== 'directory') {
                    // Error or ignore? fs.mkdir with recursive:true ignores existing dirs but fails on files
                    // We'll assume recursive: true behavior always
                    // But if it's a file, it should probably fail?
                    // Just overwrite or ignore? Native fs throws ENOTDIR
                }
                current = next;
            }
        });

        await page.exposeFunction('__fs_stat', async (filePath: string) => {
            // resolveNode throws if parent not found, return null/error if entry not found
            try {
                const { entry } = resolveNode(filePath);
                if (!entry) throw new Error("Not found");
                return { isDirectory: entry.kind === 'directory', isFile: entry.kind === 'file' };
            } catch (e) {
                throw new Error(`File not found: ${filePath}`);
            }
        });

        await page.exposeFunction('__fs_rename', async (oldPath: string, newPath: string) => {
            // Resolve source
            const source = resolveNode(oldPath);
            if (!source.entry) throw new Error(`Source not found: ${oldPath}`);

            // Resolve destination parent
            const newParts = newPath.split(/[/\\]/);
            const newRootName = newParts[0];
            const newRest = newParts.slice(1);
            const newFileName = newRest[newRest.length - 1];

            const root = this.getRoot(newRootName);

            // Need to ensure new parent exists? fs.rename usually implies parent exists.
            // But let's check.
            // Also need to handle "overwrite destination if exists" logic from original

            // Logic: remove from old parent, add to new parent.

            // Get new parent
            // traversePath stops if not found
            // We assume parent of newPath exists, consistent with fs.rename (usually)
            // But original implementation used fs.renameSync which requires parents to exist.
            // AND original implementation did `rmSync` on dest if it existed.

            const destParentParts = newRest.slice(0, newRest.length - 1);
            let destParent = root;
            for (const part of destParentParts) {
                const next = destParent.children.get(part);
                if (!next || next.kind !== 'directory') throw new Error("Destination parent directory not found");
                destParent = next;
            }

            // Remove from source
            source.parent.children.delete(source.name);

            // Add to dest (overwriting)
            destParent.children.set(newFileName, source.entry);
        });

        await page.exposeFunction('__fs_remove', async (filePath: string) => {
            try {
                const { parent, name, entry } = resolveNode(filePath);
                if (entry) {
                    parent.children.delete(name);
                }
            } catch (e) {
                // ignore if not found? 
                // Original: fs.rmSync(fullPath, { recursive: true, force: true }); which ignores missing
            }
        });

        // Inject the mock implementation
        await page.addInitScript({ path: path.join(__dirname, 'fs_mock.js') });
    }
}
