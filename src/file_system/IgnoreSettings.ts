
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

export function mergeSettings(parent: IgnoreSettings, child: Partial<IgnoreSettings>): IgnoreSettings {
    return {
        ignored_directories: [...parent.ignored_directories, ...(child.ignored_directories || [])],
        unignored_directories: [...parent.unignored_directories, ...(child.unignored_directories || [])],
        ignore_dot_directories: child.ignore_dot_directories ?? parent.ignore_dot_directories,
        ignore_underscore_directories: child.ignore_underscore_directories ?? parent.ignore_underscore_directories,
        ignored_extensions: [...parent.ignored_extensions, ...(child.ignored_extensions || [])],
        unignored_extensions: [...parent.unignored_extensions, ...(child.unignored_extensions || [])],
        ignore_dot_files: child.ignore_dot_files ?? parent.ignore_dot_files,
        ignore_extensionless_files: child.ignore_extensionless_files ?? parent.ignore_extensionless_files,
    };
}

function matchesPattern(name: string, pattern: string): boolean {
    // Check for regex format: /pattern/
    if (pattern.startsWith('/') && pattern.endsWith('/') && pattern.length > 2) {
        try {
            const regexBody = pattern.slice(1, -1);
            const regex = new RegExp(regexBody);
            return regex.test(name);
        } catch (e) {
            console.warn(`Invalid regex pattern in ignore settings: ${pattern}`, e);
            return false;
        }
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

export function shouldIgnoreDirectory(name: string, settings: IgnoreSettings): boolean {
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

export function shouldIgnoreFile(name: string, settings: IgnoreSettings): boolean {
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
