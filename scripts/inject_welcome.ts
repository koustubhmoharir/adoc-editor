import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const welcomeAdocPath = path.resolve(__dirname, '../src/components/Welcome.adoc');
const editorStorePath = path.resolve(__dirname, '../src/store/EditorStore.ts');


export function injectWelcome() {
    try {
        if (!fs.existsSync(welcomeAdocPath) || !fs.existsSync(editorStorePath)) {
            // Might be clean checkout or deleted
            return;
        }

        const welcomeContent = fs.readFileSync(welcomeAdocPath, 'utf-8');
        const editorStoreContent = fs.readFileSync(editorStorePath, 'utf-8');

        const startMarker = '// MARKER: WELCOME_CONTENT_START';
        const endMarker = '// MARKER: WELCOME_CONTENT_END';

        const startIndex = editorStoreContent.indexOf(startMarker);
        const endIndex = editorStoreContent.indexOf(endMarker);

        if (startIndex !== -1 && endIndex !== -1) {
            // Escape backticks in welcomeContent to avoid breaking the template string in TS
            // Also escape ${ just in case, though unlikely in simple adoc
            const escapedWelcomeContent = welcomeContent
                .replace(/\\/g, '\\\\') // Escape backslashes first
                .replace(/`/g, '\\`')   // Escape backticks
                .replace(/\${/g, '\\${'); // Escape template interpolation

            const newAssignment = `const WELCOME_CONTENT = \`
${escapedWelcomeContent}
\`;`;

            const newContent =
                editorStoreContent.substring(0, startIndex + startMarker.length) +
                '\n' + newAssignment + '\n' +
                editorStoreContent.substring(endIndex);

            if (newContent !== editorStoreContent) {
                fs.writeFileSync(editorStorePath, newContent, 'utf-8');
                //console.log('Successfully injected Welcome.adoc content into EditorStore.ts');
            } else {
                // No change needed
            }
        } else {
            console.error('Could not find markers in EditorStore.ts');
            // process.exit(1); // Don't exit process if called as module
        }
    } catch (error) {
        console.error('Error injecting welcome content:', error);
        // process.exit(1);
    }
}

// Execute if run directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    injectWelcome();
}

