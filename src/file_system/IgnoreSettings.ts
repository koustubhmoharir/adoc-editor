export interface IgnoreSettings {
    unignored_directories: string[];
    ignore_dot_directories: boolean;
    ignore_underscore_directories: boolean;
    ignored_directories: string[];
    unignored_extensions: string[];
    ignore_dot_files: boolean;
    ignore_extensionless_files: boolean;
    ignored_extensions: string[];
}

export interface CompiledIgnoreSettings extends IgnoreSettings {
    ignored_directories_compiled_: (string | RegExp)[];
    unignored_directories_compiled_: (string | RegExp)[];
}

export const DEFAULT_SETTINGS: IgnoreSettings = {
    unignored_directories: [],
    ignore_dot_directories: true,
    ignore_underscore_directories: false,
    ignored_directories: [
        'node_modules',
        'dist',
        'build',
        'coverage',
        '.git',
        '.idea',
        '.vscode',
        '__pycache__',
        '.mypy_cache',
        '.pytest_cache',
        'target', // Rust/Maven
        'artifacts', // .NET
        'bin',    // General binary output
        'obj',    // C# / C++
        'out',    // Java/Kotlin
        'vendor', // Go/PHP/Ruby
    ],
    unignored_extensions: [],
    ignore_dot_files: true,
    ignore_extensionless_files: false,
    ignored_extensions: [
        '.exe', '.dll', '.so', '.dylib', '.o', '.a', '.obj', '.class', '.pyc', // Binaries
        '.zip', '.tar', '.gz', '.7z', '.rar', // Archives
        '.db', '.sqlite', '.sqlite3', // Databases
        '.log',
        '.DS_Store', // macOS
    ],
};

// Module-level cache for regex patterns
const patternCache = new Map<string, string | RegExp>();

function createPattern(pattern: string): string | RegExp {
    let result = patternCache.get(pattern);
    if (result != null) {
        return result;
    }

    result = pattern;

    // Check for regex format: /pattern/
    if (pattern.startsWith('/') && pattern.endsWith('/') && pattern.length > 2) {
        try {
            const regexBody = pattern.slice(1, -1);
            result = new RegExp(regexBody);
        } catch (e) {
            console.warn(`Invalid regex pattern in ignore settings: ${pattern}`, e);
            // Fallback to exact match of the raw string if regex fails? Or just return the string.
        }
    }

    patternCache.set(pattern, result);
    return result;
}

function uniquePatters(patterns: string[]) {
    return Array.from(new Set(patterns).values()).map(createPattern);
}

export function compileSettings(settings: IgnoreSettings): CompiledIgnoreSettings {
    return {
        ...settings,
        ignored_directories_compiled_: uniquePatters(settings.ignored_directories),
        unignored_directories_compiled_: uniquePatters(settings.unignored_directories),
    };
}

export const DEFAULT_COMPILED_SETTINGS = compileSettings(DEFAULT_SETTINGS);

export function resetPatternCache() {
    patternCache.clear();
}

export function combineArrays(base: string[], child?: string[]) {
    const combined = child?.length ? base.concat(child) : base;
    return Array.from(new Set(combined).values());
}

export function mergeSettings(parent: CompiledIgnoreSettings, child: Partial<IgnoreSettings>): CompiledIgnoreSettings {
    // Child is partial raw settings.
    const merged: CompiledIgnoreSettings = {
        ...parent,
        ...child, // Overrides booleans
        ignored_directories: combineArrays(parent.ignored_directories, child.ignored_directories),
        unignored_directories: combineArrays(parent.unignored_directories, child.unignored_directories),
    };
    merged.ignored_directories_compiled_ = merged.ignored_directories.map(createPattern);
    merged.unignored_directories_compiled_ = merged.unignored_directories.map(createPattern);
    return merged;
}

function matchesPattern(name: string, pattern: string | RegExp): boolean {
    if (pattern instanceof RegExp) {
        return pattern.test(name);
    }
    // Exact match
    return name === pattern;
}

function matchesExtension(name: string, extensionPattern: string): boolean {
    // 1. Wildcard match all
    if (extensionPattern === '*') return true;

    // 2. Wildcard match any extension (so requires dot)
    if (extensionPattern === '.*') {
        return name.includes('.');
    }

    // 3. Explicit extension match
    // Pattern should start with dot, e.g. ".exe", ".g.cs"
    if (extensionPattern.startsWith('.')) {
        return name.endsWith(extensionPattern);
    }

    // Fallback/Legacy: if user forgot dot, assume dot.
    return name.endsWith('.' + extensionPattern);
}

export function shouldIgnoreDirectory(name: string, settings: CompiledIgnoreSettings): boolean {
    // 1. Unignore list (Explicit Keep)
    if (settings.unignored_directories.some(pattern => matchesPattern(name, pattern))) {
        return false;
    }

    // 2. Boolean Flags
    if (settings.ignore_dot_directories && name.startsWith('.')) return true;
    if (settings.ignore_underscore_directories && name.startsWith('_')) return true;

    // 3. Ignored List
    if (settings.ignored_directories.some(pattern => matchesPattern(name, pattern))) {
        return true;
    }

    return false;
}

export function shouldIgnoreFile(name: string, settings: CompiledIgnoreSettings): boolean {
    // 1. Unignore list
    if (settings.unignored_extensions.some(pattern => matchesExtension(name, pattern))) {
        return false;
    }

    // 2. Boolean flags
    if (settings.ignore_dot_files && name.startsWith('.')) {
        return true;
    }
    if (settings.ignore_extensionless_files && !name.includes('.')) {
        return true;
    }

    // 3. Ignored list
    if (settings.ignored_extensions.some(pattern => matchesExtension(name, pattern))) {
        return true;
    }

    return false;
}

export function generateDefaultIgnoreFileContent(): string {
    const header = `# File and Directory Ignore Settings
###
### Rules are evaluated in this order:
### 1. 'unignored_*' lists (Explicit Keep - wins over everything else)
### 2. Boolean flags (ignore_dot_*, ignore_extensionless_files)
### 3. 'ignored_*' lists (Explicit Ignore)
###
### Inheritance:
### Settings are inherited from defaults or parent directories, and settings at the current level are merged.
### Lists are appended, booleans are overridden.
###
### Pattern Syntax:
### - Directory patterns support regex surounded by slashes (e.g. "/^build.*/") or exact match.
### - Extension patterns support wildcards ('*' for all, '.*' for any extension) and leading dots (e.g. ".log").
###
### The commented lines below show default settings. Uncomment and modify as desired.
### Note that settings may already be inherited from a parent directory.
### __________________________________________________________________________________

`;

    // Order keys logically to match the logical grouping in the interface/default object if possible, 
    // or just rely on Object.entries (which usually follows definition order for non-integer keys).
    // Let's enforce a specific order for clarity if we want, or just loop.
    // The user didn't STRICTLY match definition order but let's try to keep it clean.

    const lines = Object.entries(DEFAULT_SETTINGS).map(([key, value]) => {
        let serializedValue: string;
        if (Array.isArray(value)) {
            // Determine if string array
            // JSON.stringify creates valid TOML for string arrays: ["a", "b"]
            serializedValue = JSON.stringify(value);
        } else {
            serializedValue = String(value);
        }
        return `# ${key} = ${serializedValue}`;
    });

    return header + '\n' + lines.join('\n\n') + '\n';
}
