#!/usr/bin/env node
/*
 * Compresses event photos for the web and prints the JSON snippet to paste
 * into data/2026.json.
 *
 *   node scripts/compress-photos.js <source-dir> [--year 2026] [--max 1600] [--quality 80]
 *
 * Reads straight off the camera/phone dump in <source-dir>, writes web-sized
 * copies into pic/<year>/, and leaves the source untouched so the originals
 * stay available for the Supabase storage upload later.
 *
 * Bakes in EXIF orientation — phone photos are routinely tagged rotated, and
 * stripping the tag without rotating the pixels lands them sideways.
 */

const fs = require('fs');
const path = require('path');

let sharp;
try {
  sharp = require('sharp');
} catch {
  console.error('sharp is not installed. Run:  npm install');
  process.exit(1);
}

const argv = process.argv.slice(2);
const flags = {};
const positional = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i].startsWith('--')) { flags[argv[i].slice(2)] = argv[i + 1]; i++; }
  else positional.push(argv[i]);
}

const SRC = positional[0];
const YEAR = flags.year ?? '2026';
const MAX = Number(flags.max ?? 1600);
const QUALITY = Number(flags.quality ?? 80);

if (!SRC) {
  console.error('Usage: node scripts/compress-photos.js <source-dir> [--year 2026] [--max 1600] [--quality 80]');
  process.exit(1);
}
if (!fs.existsSync(SRC)) {
  console.error(`Source directory not found: ${SRC}`);
  process.exit(1);
}

const OUT = path.join(__dirname, '..', 'pic', YEAR);
fs.mkdirSync(OUT, { recursive: true });

const files = fs.readdirSync(SRC).filter(f => /\.(jpe?g|png|heic|webp)$/i.test(f)).sort();
if (!files.length) {
  console.error(`No images found in ${SRC}`);
  process.exit(1);
}

(async () => {
  let before = 0, after = 0;
  const written = [];

  for (const f of files) {
    const src = fs.readFileSync(path.join(SRC, f));          // read fully; sharp keeps a handle otherwise
    const base = f.replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const name = `${base}.jpg`;
    const dest = path.join(OUT, name);

    const buf = await sharp(src)
      .rotate()                                              // bake EXIF orientation into the pixels
      .resize({ width: MAX, height: MAX, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: QUALITY, mozjpeg: true, chromaSubsampling: '4:2:0' })
      .toBuffer();

    fs.writeFileSync(dest, buf);
    before += src.length; after += buf.length;
    written.push(`pic/${YEAR}/${name}`);
    console.log(`  ${f.padEnd(28)} ${(src.length / 1024).toFixed(0).padStart(6)} KB -> ${(buf.length / 1024).toFixed(0).padStart(5)} KB`);
  }

  console.log(`\n${written.length} photos: ${(before / 1048576).toFixed(1)} MB -> ${(after / 1048576).toFixed(2)} MB`);
  console.log(`Written to pic/${YEAR}/\n`);
  console.log('Paste into the relevant "items" array in data/2026.json:\n');
  console.log(JSON.stringify(written.map(src => ({ src, alt: '' })), null, 2));
  console.log('\nFill in the alt text (it matters for SEO), then: npm run build:results');
})();
