import * as esbuild from 'esbuild';
import { mkdirSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const VERSION = '0.1.0';
const NAME = 'Ferry';
const DESCRIPTION = 'Fast, private URL redirector. Define rules; matching URLs are redirected natively.';

const watch = process.argv.includes('--watch');
const targets = ['chrome', 'firefox'];

function manifest(target) {
  const base = {
    manifest_version: 3,
    name: NAME,
    version: VERSION,
    description: DESCRIPTION,
    permissions: ['declarativeNetRequest', 'storage'],
    host_permissions: ['*://*/*'],
    action: { default_popup: 'popup.html', default_title: NAME },
    options_ui: { page: 'options.html', open_in_tab: true },
  };
  if (target === 'chrome') {
    return { ...base, background: { service_worker: 'engine.js' } };
  }
  return {
    ...base,
    background: { scripts: ['engine.js'] },
    browser_specific_settings: { gecko: { id: 'ferry@pedrosousa.me', strict_min_version: '128.0' } },
  };
}

function buildOptions(outdir) {
  return {
    entryPoints: ['src/engine.ts', 'src/options.ts', 'src/popup.ts'],
    bundle: true,
    format: 'iife',
    target: ['chrome110', 'firefox128'],
    outdir,
    logLevel: 'info',
  };
}

function copyStatic(outdir, target) {
  writeFileSync(join(outdir, 'manifest.json'), JSON.stringify(manifest(target), null, 2));
  copyFileSync('src/options.html', join(outdir, 'options.html'));
  copyFileSync('src/popup.html', join(outdir, 'popup.html'));
}

for (const target of targets) {
  const outdir = join('dist', target);
  rmSync(outdir, { recursive: true, force: true });
  mkdirSync(outdir, { recursive: true });
}

if (watch) {
  for (const target of targets) {
    const outdir = join('dist', target);
    const ctx = await esbuild.context(buildOptions(outdir));
    await ctx.watch();
    copyStatic(outdir, target);
  }
  console.log('esbuild: watching for changes… (manifest/html copied once; restart to re-copy)');
} else {
  for (const target of targets) {
    const outdir = join('dist', target);
    await esbuild.build(buildOptions(outdir));
    copyStatic(outdir, target);
  }
  console.log('Built dist/chrome and dist/firefox');
}
