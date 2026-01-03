import * as monaco from 'monaco-editor';

export function registerAsciiDoc() {
    // Register the language ID
    monaco.languages.register({ id: 'asciidoc' });

    // Configuration
    monaco.languages.setLanguageConfiguration('asciidoc', {
        comments: {
            lineComment: '//',
            blockComment: ['////', '////']
        },
        brackets: [
            ['{', '}'],
            ['[', ']'],
            ['(', ')']
        ],
        autoClosingPairs: [
            { open: '{', close: '}' },
            { open: '[', close: ']' },
            { open: '(', close: ')' },
            { open: '"', close: '"' },
            { open: "'", close: "'" },
            { open: '`', close: '`' },
            { open: '*', close: '*' },
            { open: '_', close: '_' }
        ],
        surroundingPairs: [
            { open: '{', close: '}' },
            { open: '[', close: ']' },
            { open: '(', close: ')' },
            { open: '"', close: '"' },
            { open: "'", close: "'" },
            { open: '`', close: '`' },
            { open: '*', close: '*' },
            { open: '_', close: '_' }
        ]
    });

    // Monarch tokens provider
    const baseTokenizer = {
        defaultToken: '',

        tokenizer: {
            root: [
                // Headers
                { include: '@headers' },

                // Comments
                { include: '@comments' },

                // Blocks (Code, Admonition, etc.)
                { include: '@blocks' },

                // Lists
                { include: '@lists' },

                // Macros (Images, Links)
                { include: '@macros' },

                // Attributes
                [/^:[a-zA-Z0-9_\-]+:/, 'variable'],
                [/\{[a-zA-Z0-9_\-]+\}/, 'variable.predefined'],

                // Formatting (Bold, Italic, Monospace)
                { include: '@formatting' },

                // General Text
                [/[^=\*_\`\[\]\:\/\<\>\{\}]+/, '']
            ],

            headers: [
                [/^(=+)(\s+)/, ['keyword', { token: 'white', next: '@header' }]],
            ],

            header: [
                { include: '@formatting' },
                { include: '@macros' },
                [/\{[a-zA-Z0-9_\-]+\}/, 'variable.predefined'],
                [/[^=\n*_\`#\[<\{]+/, 'keyword'], // Text that isn't formatting-like
                [/[*_\`#\[<\{]/, 'keyword'], // Fallback for characters that look like formatting but aren't
                [/^=+$|$/, { token: '', next: '@pop' }] // End of header line
            ],

            comments: [
                [/^\/\/\/*$/, 'comment'], // block comment line (////) matched in @blocks if needed, but here simple valid check
                [/^\/\/.*$/, 'comment'],
                [/^\/\/\/\/$/, { token: 'comment', next: '@commentBlock' }]
            ],

            commentBlock: [
                [/^\/\/\/\/$/, { token: 'comment', next: '@pop' }],
                [/.*$/, 'comment']
            ],

            blocks: [
                // Code blocks
                [/^----\s*$/, { token: 'string', next: '@codeBlock' }],
                [/^....\s*$/, { token: 'string', next: '@literalBlock' }],
                [/^====\s*$/, { token: 'string', next: '@exampleBlock' }],
                [/^____\s*$/, { token: 'string', next: '@quoteBlock' }],
                [/^\*\*\*\*\s*$/, { token: 'string', next: '@sidebarBlock' }],

                // Admonitions
                [/^[A-Z]+:\s/, 'type.identifier'], // NOTE: text
                [/^\[(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/, 'type.identifier']
            ],

            codeBlock: [
                [/^----\s*$/, { token: 'string', next: '@pop' }],
                [/.*$/, 'string']
            ],
            literalBlock: [
                [/^....\s*$/, { token: 'string', next: '@pop' }],
                [/.*$/, 'string']
            ],
            exampleBlock: [
                [/^====\s*$/, { token: 'string', next: '@pop' }],
                [/.*$/, 'string']
            ],
            quoteBlock: [
                [/^____\s*$/, { token: 'string', next: '@pop' }],
                [/.*$/, 'string']
            ],
            sidebarBlock: [
                [/^\*\*\*\*\s*$/, { token: 'string', next: '@pop' }],
                [/.*$/, 'string']
            ],

            lists: [
                [/^\s*[\*\.\-]+\s/, 'delimiter'],
                [/^\s*\d+\.\s/, 'delimiter']
            ],

            macros: [
                [/(image|video|audio|include|icon)::[^\[]+\[.*?\]/, 'annotation'],
                [/(link|icon|http|https|ftp|mailto):[^\[]+\[.*?\]/, 'annotation'],
                [/<<.*?>>/, 'annotation'] // Cross references
            ],

            formatting: [
                // Bold: **text** or *text*
                [/\*\*/, { token: 'strong', next: '@strongDouble' }],
                [/\*/, { token: 'strong', next: '@strongSingle' }],
                // Italic: __text__ or _text_
                [/__/, { token: 'emphasis', next: '@emphasisDouble' }],
                [/_/, { token: 'emphasis', next: '@emphasisSingle' }],
                // Monospace: ``text`` or `text` or +text+
                [/``/, { token: 'string', next: '@monospaceDouble' }],
                [/`/, { token: 'string', next: '@monospaceSingle' }],
                [/\+/, { token: 'string', next: '@monospacePlus' }],
                // Highlight: #text#
                [/#/, { token: 'variable', next: '@highlightSingle' }],
            ],

            strongDouble: [
                [/\*\*/, { token: 'strong', next: '@pop' }],
                { include: '@formatting' },
                [/[^*_`#]+/, 'strong'],
                [/./, 'strong']
            ],

            strongSingle: [
                [/\*/, { token: 'strong', next: '@pop' }],
                { include: '@formatting' },
                [/[^*_`#]+/, 'strong'],
                [/./, 'strong']
            ],

            emphasisDouble: [
                [/\.\./, 'emphasis'], // Should not happen with __ but just in case
                [/__/, { token: 'emphasis', next: '@pop' }],
                { include: '@formatting' },
                [/[^*_`#]+/, 'emphasis'],
                [/./, 'emphasis']
            ],

            emphasisSingle: [
                [/_/, { token: 'emphasis', next: '@pop' }],
                { include: '@formatting' },
                [/[^*_`#]+/, 'emphasis'],
                [/./, 'emphasis']
            ],

            monospaceDouble: [
                [/``/, { token: 'string', next: '@pop' }],
                [/[^`]+/, 'string'],
                [/./, 'string']
            ],

            monospaceSingle: [
                [/`/, { token: 'string', next: '@pop' }],
                [/[^`]+/, 'string'],
                [/./, 'string']
            ],

            monospacePlus: [
                [/\+/, { token: 'string', next: '@pop' }],
                [/[^+]+/, 'string'],
                [/./, 'string']
            ],

            highlightSingle: [
                [/#/, { token: 'variable', next: '@pop' }],
                { include: '@formatting' },
                [/[^*_`#]+/, 'variable'], // using variable for highlight
                [/./, 'variable']
            ]
        }
    };

    monaco.languages.setMonarchTokensProvider('asciidoc', extendTokenizer(baseTokenizer));

    // Optional: Define a theme that maps these better if default isn't enough
    // But usually vs-dark handles keyword, string, comment, variable well.
}

// Supported languages and their aliases
const embeddedLanguages = {
    'javascript': ['js', 'jsx', 'javascript'],
    'typescript': ['ts', 'tsx', 'typescript'],
    'json': ['json', 'jsonc'],
    'html': ['html', 'htm'],
    'css': ['css'],
    'scss': ['scss'],
    'less': ['less'],
    'python': ['py', 'python'],
    'java': ['java'],
    'cpp': ['cpp', 'c++'],
    'c': ['c'],
    'xml': ['xml'],
    'yaml': ['yaml', 'yml'],
    'go': ['go'],
    'rust': ['rust', 'rs'],
    'sql': ['sql'],
    'csharp': ['cs', 'csharp'],
    'shell': ['sh', 'bash', 'shell']
};

function getEmbeddedLanguageRules() {
    const rootRules: any[] = [];
    const stateDefinitions: any = {};

    Object.entries(embeddedLanguages).forEach(([langId, aliases]) => {
        // Escape special characters in aliases for Regex (e.g. c++)
        const escapedAliases = aliases.map(a => a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
        const aliasPattern = escapedAliases.join('|');
        const stateNameWait = `block_wait_${langId}`;
        const stateNameBody = `block_body_${langId}`;

        // 1. Root rule: Detect [source, lang]
        rootRules.push([
            new RegExp(`^/\\/\\/\\s*.*$`), // Ignore comments before checking source block
            'comment'
        ]);

        // Match [source, language] or just [language] if it's a common pattern (but usually it's [source,lang])
        // We focus on [source, lang]
        rootRules.push([
            new RegExp(`^\\[source,\\s*(${aliasPattern})\\s*\\]$`),
            { token: 'keyword', next: `@${stateNameWait}` }
        ]);

        // 2. Waiting state: waiting for ----
        stateDefinitions[stateNameWait] = [
            [/^----\s*$/, { token: 'string', next: `@${stateNameBody}`, nextEmbedded: langId }],
            [/\s+/, { token: '' }], // whitespace allowed
            [/^.*$/, { token: '@rematch', next: '@pop' }] // Anything else? Abort wait.
        ];

        // 3. Body state: inside the block, look for exit
        stateDefinitions[stateNameBody] = [
            [/^----$/, { token: 'string', next: '@pop', nextEmbedded: '@pop' }]
        ];
    });

    return { rootRules, stateDefinitions };
}

// ... inside setMonarchTokensProvider ...
// to be called within the registers function
function extendTokenizer(baseTokenizer: any) {
    const { rootRules, stateDefinitions } = getEmbeddedLanguageRules();

    // Insert language detection rules at the top of root, but after headers/comments if we strictly follow order
    // Actually, [source,lang] is a block attribute. It should be checked before general blocks.

    const newRoot = [
        ...rootRules,
        ...baseTokenizer.tokenizer.root
    ];

    return {
        ...baseTokenizer,
        tokenizer: {
            ...baseTokenizer.tokenizer,
            root: newRoot,
            ...stateDefinitions
        }
    };
}
