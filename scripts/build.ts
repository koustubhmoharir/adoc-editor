import { vanillaExtractPlugin } from '@vanilla-extract/esbuild-plugin';
import * as esbuild from 'esbuild';
import * as fs from 'fs';

const isServe = process.argv.includes('--serve');

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
        minify: !isServe,
        target: 'es2020',
        loader: {
            '.ttf': 'file',
            '.css': 'css'
        },
        define: {
            'process.env.NODE_ENV': isServe ? '"development"' : '"production"'
        },
        plugins: [vanillaExtractPlugin()]
    });

    // Simple index.html copy plugin or manual copy
    if (!fs.existsSync('dist')) {
        fs.mkdirSync('dist');
    }

    // We'll rely on a manual copy for index.html for simplicity in this script, or add a plugin.
    // Let's just copy it now and on rebuilds if we were watching, but for now just one-off/serve.
    // Actually, we need to ensure index.html exists in dist.
    fs.copyFileSync('src/index.html', 'dist/index.html');

    if (isServe) {
        await context.watch();
        const server = await context.serve({
            servedir: 'dist',
            host: '127.0.0.1'
        });

        if (!server.hosts || server.hosts.length === 0) {
            throw new Error("Server started but no hosts were returned. This indicates a network binding issue.");
        }

        const host = server.hosts[0];
        const port = server.port;
        console.log(`Serving at http://${host}:${port}`);
    } else {
        await context.rebuild();
        await context.dispose();
    }
}

build().catch(err => {
    console.error(err);
    process.exit(1);
});
