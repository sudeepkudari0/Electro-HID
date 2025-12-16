import * as esbuild from 'esbuild';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

await esbuild.build({
    entryPoints: [resolve(__dirname, 'electron/preload/index.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: resolve(__dirname, 'dist-electron/preload/index.cjs'),
    external: ['electron'],
    target: 'node18',
    logLevel: 'info',
});

console.log('✅ Preload script built successfully as CommonJS');
