import { vanillaExtractPlugin } from '@vanilla-extract/esbuild-plugin';
import * as esbuild from 'esbuild';
import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';
import { injectWelcome } from './inject_welcome.ts';

import { SERVER_PORT, SERVER_HOST } from './devserver.config.ts';

const isServe = process.argv.includes('--serve');
const isWatch = process.argv.includes('--watch');
const isShowTokens = process.argv.includes('--show-tokens');

const clients: http.ServerResponse[] = [];

// Simple MIME type map
const mimeTypes: { [key: string]: string } = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.ttf': 'font/ttf',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
};

async function build() {
    const context = await esbuild.context({
        entryPoints: {
            'bundle': 'src/main.tsx',
            'editor.worker': 'monaco-editor/esm/vs/editor/editor.worker.js',
            'json.worker': 'monaco-editor/esm/vs/language/json/json.worker.js',
            'css.worker': 'monaco-editor/esm/vs/language/css/css.worker.js',
            'html.worker': 'monaco-editor/esm/vs/language/html/html.worker.js',
            'ts.worker': 'monaco-editor/esm/vs/language/typescript/ts.worker.js'
        },
        bundle: true,
        outdir: 'dist',
        sourcemap: true,
        minify: !isServe, // Only minify in production/non-serve mode? Or maybe just keep it simple.
        target: 'es2020',
        loader: {
            '.ttf': 'dataurl',
            '.woff': 'dataurl',
            '.woff2': 'dataurl',
            '.eot': 'dataurl',
            '.css': 'css'
        },
        define: {
            'process.env.NODE_ENV': isServe ? '"development"' : '"production"'
        },
        plugins: [vanillaExtractPlugin()]
    });

    // Helper to run rebuild and copy index.html
    const runRebuild = async () => {
        // Run pre-build steps
        injectWelcome();

        const start = Date.now();
        console.log('Building...');
        try {
            await context.rebuild();
            if (!fs.existsSync('dist')) {
                fs.mkdirSync('dist');
            }
            fs.copyFileSync('src/index.html', 'dist/index.html');
            console.log(`[${new Date().toLocaleTimeString()}] Build done in ${Date.now() - start}ms`);

            // Notify clients
            if (isServe && isWatch) {
                clients.forEach(res => {
                    res.write('data: update\n\n');
                });
            }
        } catch (e) {
            console.error('Build failed:', e);
        }
    };

    // Initial build
    await runRebuild();

    if (isServe) {
        const port = SERVER_PORT;

        const server = http.createServer((req, res) => {
            // SSE Endpoint
            if (isWatch && req.url === '/_reload') {
                res.writeHead(200, {
                    'Content-Type': 'text/event-stream',
                    'Cache-Control': 'no-cache',
                    'Connection': 'keep-alive',
                });
                res.write('data: connected\n\n');
                clients.push(res);
                req.on('close', () => {
                    const index = clients.indexOf(res);
                    if (index !== -1) clients.splice(index, 1);
                });
                return;
            }

            // File Serving
            const parsedUrl = new URL(req.url || '/', `http://${req.headers.host}`);
            const pathname = parsedUrl.pathname === '/' ? 'index.html' : parsedUrl.pathname;
            let filePath = path.join('dist', pathname);

            // Security check to prevent traversing out of dist (basic)
            if (!filePath.startsWith('dist')) {
                res.writeHead(403);
                res.end('Forbidden');
                return;
            }

            // If file doesn't exist, try adding .html? Or just return 404.
            // For SPA, we might want fallback to index.html, but let's stick to simple file serving for now.
            if (!fs.existsSync(filePath)) {
                res.writeHead(404);
                res.end('Not found');
                return;
            }

            // If it's a directory, try index.html
            if (fs.statSync(filePath).isDirectory()) {
                filePath = path.join(filePath, 'index.html');
                if (!fs.existsSync(filePath)) {
                    res.writeHead(404);
                    res.end('Not found');
                    return;
                }
            }

            const ext = path.extname(filePath).toLowerCase();
            const contentType = mimeTypes[ext] || 'application/octet-stream';

            // Inject script if serving index.html and watching
            if (isWatch && ext === '.html') {
                fs.readFile(filePath, 'utf8', (err, data) => {
                    if (err) {
                        res.writeHead(500);
                        res.end('Error reading file');
                        return;
                    }
                    const injected = data.replace(
                        '</head>',
                        `<script>
    new EventSource('/_reload').onmessage = function(e) {
        if (e.data === 'update') location.reload();
    };
    console.log('Live reload enabled');
    ${isShowTokens ? 'window.__SHOW_TOKENS__ = true;' : ''}
</script>
</head>`
                    );
                    res.writeHead(200, { 'Content-Type': contentType });
                    res.end(injected);
                });
            } else {
                res.writeHead(200, { 'Content-Type': contentType });
                fs.createReadStream(filePath).pipe(res);
            }
        });

        server.listen(port, SERVER_HOST, () => {
            console.log(`Serving at http://${SERVER_HOST}:${port}`);
        });
    }

    if (isWatch) {
        let timer: NodeJS.Timeout;
        // Recursive watch on src
        console.log('Watching for changes in src...');
        fs.watch('src', { recursive: true }, (eventType, filename) => {
            // Debounce
            clearTimeout(timer);
            timer = setTimeout(() => {
                console.log(`Change detected (${filename}), rebuilding...`);
                runRebuild();
            }, 100);
        });
    }

    if (!isServe && !isWatch) {
        await context.dispose();
    }
}

build().catch(err => {
    console.error(err);
    process.exit(1);
});
