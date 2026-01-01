import Asciidoctor from 'asciidoctor';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const asciidoctor = Asciidoctor();

const FIXTURES_DIR = path.join(__dirname, '../tests/fixtures');

// Regex patterns for inline elements (simplified)
const PATTERNS = {
    'section': /^(=+)\s+.*$/, // Header marker
    'strong_text': /\*([^*]+)\*/g,
    'keyword': /^(=+)\s/, // Header marker
    'strong': /(\*[^*]+\*|\*\*[^*]+\*\*)/g, // *foo* or **foo**
    'emphasis': /(_[^_]+_|_{2}[^_]+_{2})/g,
    'string': /(`[^`]+`|`{2}[^`]+`{2}|\+[^+]+\+)/g,
    'annotation': /(image::|video::|audio::|include::|link:|icon:|http:|https:|ftp:|mailto:|xref:|<<|>>)/g
};

// Patterns handled explicitly:
// - delimiter (List markers)
// - attribute_def (:attr:)
// - attribute_ref ({attr})
const SPECIAL_PATTERNS = {
    'delimiter': /^\s*([\*\.\-]+)\s+|^\s*(\d+\.)\s+/,
    'attribute_def': /^:[\w\-]+:/,
    'attribute_ref': /\{[\w\-]+\}/g
};

function analyzeFile(filename) {
    // ...
    console.log(`Analyzing ${filename}...`);
    const filePath = path.join(FIXTURES_DIR, filename);
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split(/\r?\n/);

    // Load with sourcemap
    const doc = asciidoctor.load(content, { sourcemap: true, safe: 'safe' });

    const expectations = [];

    // Helper to add expectation
    const addExp = (line, text, type) => {
        if (line >= 0 && line < lines.length) {
            expectations.push({
                line: line,
                textContent: text, // This is the expected TOKEN text or partial
                tokenType: type
            });
        }
    };

    // Traverse all blocks to identify context?
    // Actually, for syntax highlighting we mostly care about the line content matching patterns.
    // The AST helps us avoid false positives (e.g. * in code block).
    // So we use AST to whitelist lines that are NOT code/literal.

    const codeLines = new Set();
    const processedLines = new Set();
    const blocks = doc.findBy((b) => true);
    blocks.forEach(block => {
        const type = block.getNodeName();
        if (['listing', 'literal', 'sidebar', 'example', 'quote'].includes(type)) {
            const start = block.getLineNumber();
            let blockLines = [];
            if (typeof block.getLines === 'function') {
                blockLines = block.getLines();
            } else if (block.lines) {
                blockLines = block.lines;
            }

            // Check if 'start' points to delimiter
            let contentStartLine = start;
            // Asciidoctor behavior: start line is the first line of the block.
            // For delimited blocks, it is the delimiter line.
            // We can check the line content at 'start-1' (0-indexed).
            const startLineIdx = start - 1;
            const delimiters = ['----', '....', '====', '____', '****']; // Define here for scope
            if (startLineIdx >= 0 && startLineIdx < lines.length) {
                const l = lines[startLineIdx].trim();
                if (delimiters.some(d => l.startsWith(d))) {
                    // Start points to delimiter. Content starts at next line.
                    contentStartLine = start + 1;

                    // Verify delimiter explicitly
                    addExp(startLineIdx, lines[startLineIdx], 'string');
                    codeLines.add(startLineIdx);
                }
                // Check ending delimiter too
                // If we have content lines, end delimiter is start + lines.length + 1?
                // No, start (delimiter) + content lines + end delimiter.
                if (blockLines && blockLines.length > 0) {
                    const endDelimLine = startLineIdx + blockLines.length + 1; // 1 for start delim replacement
                    if (endDelimLine < lines.length) {
                        const el = lines[endDelimLine].trim();
                        if (delimiters.some(d => el.startsWith(d))) {
                            addExp(endDelimLine, lines[endDelimLine], 'string');
                            codeLines.add(endDelimLine);
                        }
                    }
                }
            }

            if (type === 'listing' || type === 'literal') {
                // These are simple blocks with raw lines (usually)
                if (blockLines) {
                    for (let i = 0; i < blockLines.length; i++) {
                        const lineIdx = contentStartLine - 1 + i;
                        codeLines.add(lineIdx);
                        addExp(lineIdx, lines[lineIdx], 'string');
                    }
                }
            }
            // For sidebar/example/quote, they are usually compound.
            // Their content lines (if any directly attached) might be handled here, 
            // or by their children (paragraphs).
            // If they have direct lines (e.g. non-compound?), handle same way.
            // But usually they comprise paragraphs.
            // We'll rely on child node traversal for content, but we need to pass down "isStringContext".
        }

        // Check for Nested Context (Sidebar/Example/Quote content is string)
        let isStringContext = false;
        let parent = block.getParent && block.getParent();
        while (parent) {
            const pName = parent.getNodeName();
            if (['sidebar', 'example', 'quote'].includes(pName)) {
                isStringContext = true;
                break;
            }
            parent = parent.getParent && parent.getParent();
        }

        if (type === 'paragraph' || type === 'list_item') {
            const startLine = block.getLineNumber();
            const lineIdx = startLine - 1;
            if (processedLines.has(lineIdx)) return;
            // If inside a string context (sidebar), mark whole text as string?
            // Monaco highlights sidebar content (text) as 'string'.
            if (isStringContext) {
                let pLines = [];
                if (typeof block.getLines === 'function') {
                    pLines = block.getLines();
                } else if (block.lines) {
                    pLines = block.lines;
                }

                if (pLines && pLines.length > 0) {
                    for (let i = 0; i < pLines.length; i++) {
                        const currentLineIdx = lineIdx + i;
                        if (currentLineIdx < lines.length && !processedLines.has(currentLineIdx)) { // Check bounds and processed
                            addExp(currentLineIdx, lines[currentLineIdx], 'string');
                            processedLines.add(currentLineIdx);
                        }
                    }
                } else {
                    if (!processedLines.has(lineIdx)) {
                        addExp(lineIdx, lines[lineIdx], 'string');
                        processedLines.add(lineIdx);
                    }
                }
                return;
            }

            const text = lines[lineIdx];
            if (!text) return;

            // Run regexes
            for (const [tokenType, regex] of Object.entries(PATTERNS)) {
                if (regex.flags.includes('g')) {
                    const iter = text.matchAll(regex);
                    for (const m of iter) {
                        addExp(lineIdx, m[0], tokenType);
                    }
                } else {
                    const match = text.match(regex);
                    if (match) {
                        addExp(lineIdx, match[0], tokenType);
                    }
                }
            }

            // Special Patterns (Attributes, Delimiters)
            for (const match of text.matchAll(SPECIAL_PATTERNS['attribute_ref'])) {
                addExp(lineIdx, match[0], 'variable.predefined');
            }
            // Attribute definitions usually strictly at start of line, handled by fallback if not in block?
            // But Asciidoctor validation might swallow them.
            // If it is a paragraph, it might be text.
            // Let's check anyway.
            let attrDef = text.match(SPECIAL_PATTERNS['attribute_def']);
            if (attrDef) {
                addExp(lineIdx, attrDef[0], 'variable');
            }

            // List Delimiters
            let delimMatch = text.match(SPECIAL_PATTERNS['delimiter']);
            if (delimMatch) {
                // Determine which group matched (1 or 2)
                const text = delimMatch[1] || delimMatch[2];
                addExp(lineIdx, text, 'delimiter');
            }
            processedLines.add(lineIdx); // Mark as processed after inline analysis
        }
        // Identifiers for Lists?
        if (type === 'ulist' || type === 'olist') {
            // Markers *, ., -
            // Regex can handle them.
        }
    });

    lines.forEach((line, idx) => {
        // Skip code block content for inline formatting
        // But headers can't be in code blocks anyway (if parsed correctly).
        const isCode = codeLines.has(idx);
        if (processedLines.has(idx)) return; // Skip if already processed by AST traversal

        if (!isCode) {
            // Headers
            let m = line.match(/^(=+)\s/);
            if (m) {
                addExp(idx, m[1], 'keyword');
            }

            // Comments
            if (line.trim().startsWith('//')) {
                addExp(idx, '//', 'comment');
                // The whole line is comment usually
                addExp(idx, line.trim(), 'comment');
                return; // formatted text inside comment handled? No usually.
            }

            // Inline Formatting
            // Bold
            for (const match of line.matchAll(PATTERNS['strong'])) {
                addExp(idx, match[0], 'strong');
            }
            // Italic
            for (const match of line.matchAll(PATTERNS['emphasis'])) {
                addExp(idx, match[0], 'emphasis');
            }
            // Mono
            for (const match of line.matchAll(PATTERNS['string'])) {
                addExp(idx, match[0], 'string');
            }
            // Macros
            for (const match of line.matchAll(PATTERNS['annotation'])) {
                addExp(idx, match[0], 'annotation');
            }
            // Attributes
            let attrDef = line.match(SPECIAL_PATTERNS['attribute_def']);
            if (attrDef) {
                addExp(idx, attrDef[0], 'variable');
            }
            for (const match of line.matchAll(SPECIAL_PATTERNS['attribute_ref'])) {
                addExp(idx, match[0], 'variable.predefined');
            }
            // List Delimiters
            let delimMatch = line.match(SPECIAL_PATTERNS['delimiter']);
            if (delimMatch) {
                // Determine which group matched (1 or 2)
                const text = delimMatch[1] || delimMatch[2];
                addExp(idx, text, 'delimiter');
            }
        }
    });

    // Output...
    expectations.sort((a, b) => a.line - b.line);

    const outputPath = path.join(FIXTURES_DIR, filename.replace('.adoc', '-analysis.json'));
    console.log(`Writing to ${outputPath}`);
    fs.writeFileSync(outputPath, JSON.stringify(expectations, null, 2));
}

const targetArg = process.argv[2];

if (targetArg) {
    const fileName = path.basename(targetArg);
    if (fileName.endsWith('.adoc')) {
        analyzeFile(fileName);
    } else {
        console.error('File must end with .adoc');
    }
} else {
    fs.readdirSync(FIXTURES_DIR).forEach(file => {
        if (file.endsWith('.adoc')) {
            analyzeFile(file);
        }
    });
}
