const esbuild = require('esbuild');
const path = require('path');
const fs = require('fs');

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
        loader: {
            '.ttf': 'file',
            '.css': 'css'
        },
        define: {
            'process.env.NODE_ENV': isServe ? '"development"' : '"production"'
        }
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
        const { host, port } = await context.serve({
            servedir: 'dist',
        });
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
