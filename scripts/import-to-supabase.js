#!/usr/bin/env node
/*
 * Imports data/<year>.json into Supabase, including the computed ranks and
 * points, so the DB holds exactly what the published page shows.
 *
 *   node scripts/import-to-supabase.js            # 2026
 *   node scripts/import-to-supabase.js --year 2025
 *   node scripts/import-to-supabase.js --dry-run
 *
 * Needs the SERVICE ROLE key (it writes past RLS). Never ship that key to the
 * browser — it is read here from .env, which is gitignored.
 */

const fs = require('fs');
const path = require('path');

const argv = process.argv.slice(2);
const flags = {};
for (let i = 0; i < argv.length; i++) {
  if (argv[i].startsWith('--')) {
    const k = argv[i].slice(2);
    const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? (i++, argv[i]) : true;
    flags[k] = v;
  }
}
const YEAR = String(flags.year ?? '2026');
const DRY = !!flags['dry-run'];

// Minimal .env reader — avoids a dotenv dependency for one file.
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!DRY && (!URL || !KEY)) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.\nCopy .env.example to .env and fill them in.');
  process.exit(1);
}

const dataFile = path.join(__dirname, '..', 'data', `${YEAR}.json`);
if (!fs.existsSync(dataFile)) {
  console.error(`No data file at data/${YEAR}.json`);
  process.exit(1);
}
const data = JSON.parse(fs.readFileSync(dataFile, 'utf8'));

// Reuse the generator's scoring so the DB and the page can never disagree.
const { scoreEvent } = require('./scoring');

(async () => {
  const rows = { schools: [], events: [], participants: [], photos: [] };

  for (const s of data.schools) {
    rows.schools.push({
      code: s.code, emoji: s.emoji,
      name_en: s.name_en, name_ko: s.name_ko,
      short_en: s.short_en, short_ko: s.short_ko,
    });
  }

  for (const e of data.events) {
    rows.events.push({
      year: data.year, sport: e.sport, status: e.status === 'completed' ? 'completed' : 'scheduled',
      event_date: e.date, title_en: e.title_en, title_ko: e.title_ko,
      venue_en: e.venue_en, venue_ko: e.venue_ko,
      scoring: e.scoring, rules_en: e.rules_en, rules_ko: e.rules_ko,
    });
  }

  for (const e of data.events) {
    const { competitive, recreational } = scoreEvent(e);
    for (const r of competitive) {
      rows.participants.push({
        _sport: e.sport, _school: r.school, name: r.name, division: 'competitive',
        raw_score: e.sport === 'golf' ? r.score : null,
        finish_time: e.sport === 'run' ? r.time : null,
        rank: r.rank, points: r.points,
      });
    }
    for (const t of recreational) {
      for (const p of t.players) {
        rows.participants.push({
          _sport: e.sport, _school: t.school, name: p.name, division: 'recreational',
          match_no: t.match, team_result: t.result,
          raw_score: p.score ?? null, points: t.points,
        });
      }
    }
  }

  let order = 0;
  for (const g of data.photos || []) {
    for (const it of g.items || []) {
      const src = typeof it === 'string' ? it : it.src;
      rows.photos.push({
        year: Number(YEAR), storage_path: src.replace(/^pic\//, ''),
        category_en: g.category_en, category_ko: g.category_ko,
        alt_en: typeof it === 'string' ? null : it.alt, sort_order: order++,
      });
    }
  }

  console.log(`data/${YEAR}.json ->`);
  console.log(`  schools      ${rows.schools.length}`);
  console.log(`  events       ${rows.events.length}`);
  console.log(`  participants ${rows.participants.length}`);
  console.log(`  photos       ${rows.photos.length}`);

  if (DRY) { console.log('\n--dry-run: nothing written.'); return; }

  const { createClient } = require('@supabase/supabase-js');
  const db = createClient(URL, KEY, { auth: { persistSession: false } });

  const up = async (table, payload, onConflict) => {
    const { data: out, error } = await db.from(table).upsert(payload, { onConflict }).select();
    if (error) throw new Error(`${table}: ${error.message}`);
    return out;
  };

  const schools = await up('schools', rows.schools, 'code');
  const schoolId = Object.fromEntries(schools.map(s => [s.code, s.id]));
  console.log(`upserted ${schools.length} schools`);

  const events = await up('events', rows.events, 'year,sport');
  const eventId = Object.fromEntries(events.map(e => [e.sport, e.id]));
  console.log(`upserted ${events.length} events`);

  // Participants have no natural key, so replace them per event rather than
  // upserting — re-running the import must not duplicate the field.
  for (const sport of Object.keys(eventId)) {
    const batch = rows.participants
      .filter(p => p._sport === sport)
      .map(({ _sport, _school, ...p }) => ({ ...p, event_id: eventId[sport], school_id: schoolId[_school] }));
    const { error: delErr } = await db.from('participants').delete().eq('event_id', eventId[sport]);
    if (delErr) throw new Error(`participants delete: ${delErr.message}`);
    if (batch.length) {
      const { error } = await db.from('participants').insert(batch);
      if (error) throw new Error(`participants insert: ${error.message}`);
    }
    console.log(`replaced ${batch.length} ${sport} participants`);
  }

  if (rows.photos.length) {
    await up('photos', rows.photos.map(p => ({ ...p, event_id: null })), 'storage_path');
    console.log(`upserted ${rows.photos.length} photos`);
  }

  console.log('\nDone.');
})().catch(e => { console.error('\nImport failed:', e.message); process.exit(1); });
