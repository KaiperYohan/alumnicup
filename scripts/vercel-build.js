#!/usr/bin/env node
/*
 * Vercel build: bake the published results into index.html, then copy the
 * public site into dist/ (the output directory in vercel.json).
 *
 * Runs on every push to main and every Publish on the admin page (a Supabase
 * webhook on `events` calls the Vercel deploy hook). If Supabase is down the
 * build fails and Vercel keeps serving the previous deployment.
 *
 * Only what is listed here is published — scripts/, supabase/, data/ and
 * node_modules/ stay out of the site.
 */

const fs = require('fs');
const path = require('path');
const { main: buildResults } = require('./build-results');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'dist');

const PUBLIC = [
  'index.html', 'apply.html', 'admin.html',
  'favicon2.png', 'alumni-cup.jpg', 'robots.txt', 'sitemap.xml',
  'js', 'pic',
];

(async () => {
  await buildResults();

  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT);
  for (const p of PUBLIC) {
    const from = path.join(ROOT, p);
    if (!fs.existsSync(from)) throw new Error(`missing public file: ${p}`);
    fs.cpSync(from, path.join(OUT, p), { recursive: true });
  }
  // Stamp the published page (not the repo copy) so it is easy to tell
  // whether a Publish actually produced a new build: view source, or
  //   curl -s https://winalumnicup.com/ | grep alumnicup-built
  const index = path.join(OUT, 'index.html');
  fs.writeFileSync(index, fs.readFileSync(index, 'utf8')
    .replace('<head>', `<head>\n  <meta name="alumnicup-built" content="${new Date().toISOString()}">`));
  console.log(`vercel-build: copied ${PUBLIC.length} entries to dist/`);
})().catch(e => { console.error('vercel-build failed:', e.message); process.exit(1); });
