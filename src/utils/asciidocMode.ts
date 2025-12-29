import * as monaco from 'monaco-editor';

export function registerAsciiDoc() {
    monaco.languages.register({ id: 'asciidoc' });

    monaco.languages.setMonarchTokensProvider('asciidoc', {
        tokenizer: {
            root: [
                // Headers
                [/^=.+$/, 'keyword'],

                // Bold
                [/\*.+\*/, 'strong'],

                // Italic
                [/_.+_/, 'emphasis'],

                // Monospace
                [/`.+`/, 'variable'],

                // Lists
                [/^[\*\.\-]\s/, 'string'],

                // Code blocks
                [/^----$/, 'comment'],
                [/^\[.+\]$/, 'type'],
            ]
        }
    });

    monaco.languages.setLanguageConfiguration('asciidoc', {
        comments: {
            lineComment: '//',
        },
        brackets: [
            ['{', '}'],
            ['[', ']'],
            ['(', ')']
        ]
    });
}
