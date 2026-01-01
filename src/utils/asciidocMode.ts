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
    monaco.languages.setMonarchTokensProvider('asciidoc', {
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
                // Bold: *text* or **text**
                [/\*\*.*?\*\*/, 'strong'],
                [/\*.*?\*/, 'strong'],
                // Italic: _text_ or __text__
                [/__.*?__/, 'emphasis'],
                [/_.*?_/, 'emphasis'],
                // Monospace: `text` or ``text`` or +text+
                [/``.*?``/, 'string'],
                [/`.*?`/, 'string'],
                [/\+.*?\+/, 'string'],
                // Highlight: #text#
                [/#.*?#/, 'variable'] // using variable for highlight
            ]
        }
    });

    // Optional: Define a theme that maps these better if default isn't enough
    // But usually vs-dark handles keyword, string, comment, variable well.
}
