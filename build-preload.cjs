const esbuild = require('esbuild');
const path = require('path');

esbuild.build({
    entryPoints: [path.resolve(__dirname, 'electron/preload/index.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: path.resolve(__dirname, 'dist-electron/preload/index.cjs'),
    external: ['electron'],
    target: 'node18',
    logLevel: 'info',
}).then(() => {
    console.log('✅ Preload script built successfully as CommonJS');
}).catch(() => process.exit(1));
