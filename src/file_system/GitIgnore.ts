import ignore, { type Ignore } from 'ignore';

export const DEFAULT_GITIGNORE_CONTENT = `# Default exclusions for ADoc Editor.
# Rules follow gitignore syntax and are evaluated in order.
# Add !pattern to include a path; include its parent directories first.
# The root fallback is used only when the workspace has no .gitignore.
# Refresh the sidebar after editing these rules.

.*
!.gitignore
node_modules/
dist/
build/
coverage/
.git/
.idea/
.vscode/
__pycache__/
.mypy_cache/
.pytest_cache/
target/
artifacts/
bin/
obj/
out/
vendor/
*.exe
*.dll
*.so
*.dylib
*.o
*.a
*.obj
*.class
*.pyc
*.zip
*.tar
*.gz
*.7z
*.rar
*.db
*.sqlite
*.sqlite3
*.log
.DS_Store
`;

export interface IgnoreContext {
    readonly basePath: string;
    readonly parent: IgnoreContext | null;
}

const directMatcherCache = new WeakMap<IgnoreContext, Map<string, Ignore>>();
const scopeMatchers = new WeakMap<IgnoreContext, Ignore>();

export function isMissingGitIgnore(error: unknown): boolean {
    return (error as DOMException)?.name === 'NotFoundError';
}

export function isMissingDirectory(error: unknown): boolean {
    return (error as DOMException)?.name === 'NotFoundError';
}

export function createIgnoreContext(basePath: string, parent: IgnoreContext | null, text: string): IgnoreContext {
    const matcher = ignore({ ignorecase: false }).add(text);
    const context = Object.freeze({ basePath, parent });
    scopeMatchers.set(context, matcher);
    return context;
}

function metadataIgnored(path: string): boolean {
    return path.split('/').some(part => part === '.git' || part === '.adoc-editor' || part === '.s3');
}

function contexts(context: IgnoreContext): IgnoreContext[] {
    const result: IgnoreContext[] = [];
    for (let current: IgnoreContext | null = context; current; current = current.parent) result.push(current);
    return result.reverse();
}

function relativeToScope(path: string, basePath: string): string | null {
    if (!basePath) return path;
    if (path === basePath) return '.';
    return path.startsWith(`${basePath}/`) ? path.slice(basePath.length + 1) : null;
}

function escapeLiteralPath(path: string): string {
    return path.split('/').map(segment => segment
        .replace(/[\\*?\[\]]/g, '\\$&')
        .replace(/ /g, '\\ ')
    ).join('/');
}

function test(context: IgnoreContext, path: string, isDirectory: boolean, acceptedAncestors: string[]): boolean {
    if (metadataIgnored(path)) return true;
    let ignored = false;
    for (const scope of contexts(context)) {
        const local = relativeToScope(path, scope.basePath);
        if (local === null || local === '.') continue;
        const candidate = isDirectory ? `${local.replace(/\/$/, '')}/` : local;
        // Re-include traversable ancestor directories in the scope matcher.
        // The trailing slash makes these exact directory rules: they clear the
        // library's recursive parent pruning while leaving rules on this path
        // available. A no-match then remains {false,false} and preserves the
        // decision composed from earlier scopes.
        const parentPath = local.includes('/') ? local.slice(0, local.lastIndexOf('/')) : '';
        let matcher = directMatcherCache.get(scope);
        if (!matcher) {
            matcher = new Map();
            directMatcherCache.set(scope, matcher);
        }
        let directMatcher = matcher.get(parentPath);
        if (!directMatcher) {
            const scopeMatcher = scopeMatchers.get(scope);
            if (!scopeMatcher) throw new Error('Ignore context is no longer available');
            directMatcher = ignore({ ignorecase: false }).add(scopeMatcher);
            for (const ancestor of acceptedAncestors) {
                const relative = relativeToScope(ancestor, scope.basePath);
                if (relative === null || relative === '.') continue;
                directMatcher.add(`!/${escapeLiteralPath(relative)}/`);
            }
            matcher.set(parentPath, directMatcher);
        }
        const decision = directMatcher.test(candidate);
        if (decision.ignored) ignored = true;
        else if (decision.unignored) ignored = false;
    }
    return ignored;
}

export function isIgnoredPath(context: IgnoreContext, path: string, isDirectory = false): boolean {
    const normalized = path.replace(/^\/+|\/+$/g, '');
    if (!normalized) return false;
    const parts = normalized.split('/');
    const acceptedAncestors: string[] = [];
    for (let i = 1; i < parts.length; i++) {
        const ancestor = parts.slice(0, i).join('/');
        if (test(context, ancestor, true, acceptedAncestors)) return true;
        acceptedAncestors.push(ancestor);
    }
    return test(context, normalized, isDirectory, acceptedAncestors);
}

export function isIgnoredEntry(context: IgnoreContext, path: string, name: string, isDirectory: boolean): boolean {
    // .gitignore remains readable/editable even when a local pattern matches it.
    if (!isDirectory && name === '.gitignore') {
        const parentPath = path.slice(0, Math.max(0, path.lastIndexOf('/')));
        return metadataIgnored(path) || (parentPath !== '' && isIgnoredPath(context, parentPath, true));
    }
    return isIgnoredPath(context, path, isDirectory);
}

export async function loadIgnoreContext(
    directory: FileSystemDirectoryHandle,
    basePath: string,
    parent: IgnoreContext | null = null
): Promise<IgnoreContext> {
    let text: string | null = null;
    try {
        const fileHandle = await directory.getFileHandle('.gitignore');
        text = await (await fileHandle.getFile()).text();
    } catch (error) {
        if (!isMissingGitIgnore(error)) {
            throw new Error(`Failed to read .gitignore in ${basePath || directory.name}: ${error}`);
        }
    }
    if (text === null && parent === null) text = DEFAULT_GITIGNORE_CONTENT;
    return createIgnoreContext(basePath, parent, text ?? '');
}
