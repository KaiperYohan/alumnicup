#!/usr/bin/env node
/*
 * Generates the 2026 results block from data/2026.json and injects it into
 * index.html between the BUILD:RESULTS markers.
 *
 * Ranks, points and team standings are all computed — you only enter names,
 * schools and raw scores/times.
 *
 *   node scripts/build-results.js          write index.html
 *   node scripts/build-results.js --check  print what would change, write nothing
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'data', '2026.json');
const HTML = path.join(ROOT, 'index.html');
const START = '<!-- BUILD:RESULTS-2026 -->';
const END = '<!-- /BUILD:RESULTS-2026 -->';

const { realRows, scoreEvent } = require('./scoring');

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// Round to 3dp and drop trailing zeros: 13.620 -> "13.62", 50.000 -> "50".
const fmt = n => String(Number(Number(n).toFixed(3)));

function schoolMap(schools) {
  return Object.fromEntries(schools.map(s => [s.code, s]));
}

function renderEvent(event, S) {
  const { competitive: comp, recreational: rec, standings: table } = scoreEvent(event);
  if (!comp.length && !rec.length) return '';
  const isRun = event.sport === 'run';
  const valHead = isRun ? ['Time', '기록'] : ['Score', '점수'];
  const val = r => isRun ? esc(r.time) : esc(r.score);

  let h = `
          <!-- ${event.sport} -->
          <div class="results-box">
            <h3 class="lang-en">${esc(event.title_en)}</h3>
            <h3 class="lang-ko">${esc(event.title_ko)}</h3>`;

  for (const row of table) {
    const s = S[row.school] || { name_en: row.school, name_ko: row.school };
    const trophy = row.rank === 1 ? '🏆 ' : '';
    h += `
            <div class="result-row">
              <span class="school lang-en">${trophy}${esc(s.name_en)}</span>
              <span class="school lang-ko">${trophy}${esc(s.name_ko)}</span>
              <span class="score lang-en">Team Score: ${fmt(row.points)}</span>
              <span class="score lang-ko">팀 점수: ${fmt(row.points)}</span>
            </div>`;
  }

  if (comp.length) {
    h += `
            <details class="detail-toggle" style="margin-top: 1rem;">
              <summary class="detail-toggle-summary">
                <span class="lang-en">📊 ${isRun ? 'Individual Times' : 'Individual Scores'}</span>
                <span class="lang-ko">📊 ${isRun ? '개인 기록' : '개인 성적'}</span>
              </summary>
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th><span class="lang-en">Name</span><span class="lang-ko">이름</span></th>
                    <th><span class="lang-en">School</span><span class="lang-ko">학교</span></th>
                    <th><span class="lang-en">${valHead[0]}</span><span class="lang-ko">${valHead[1]}</span></th>
                    <th><span class="lang-en">Pts</span><span class="lang-ko">점수</span></th>
                  </tr>
                </thead>
                <tbody>`;
    if (rec.length) {
      h += `
                  <tr><td colspan="5" style="padding: 0.4rem 0.5rem; font-weight: bold; color: #00274c; background: #eef2f7; border-bottom: 1px solid #ddd;"><span class="lang-en">Individual (Competitive)</span><span class="lang-ko">선수부 (개인전)</span></td></tr>`;
    }
    for (const r of comp) {
      const s = S[r.school] || {};
      h += `
                  <tr${r.rank === 1 ? ' class="winner"' : ''}><td>${r.rank}</td><td>${r.rank === 1 ? '🏆 ' : ''}${esc(r.name)}</td><td>${esc(s.short_en || r.school)}</td><td>${val(r)}</td><td>${fmt(r.points)}</td></tr>`;
    }
    for (const m of [...new Set(rec.map(t => t.match))].sort((a, b) => a - b)) {
      h += `
                  <tr><td colspan="5" style="padding: 0.4rem 0.5rem; font-weight: bold; color: #00274c; background: #eef2f7; border-bottom: 1px solid #ddd;"><span class="lang-en">Team ${m} (Recreational)</span><span class="lang-ko">일반부 ${m}팀</span></td></tr>`;
      for (const t of rec.filter(x => x.match === m)) {
        const s = S[t.school] || {};
        const w = t.result === 'win';
        for (const p of t.players) {
          h += `
                  <tr${w ? ' class="winner"' : ''}><td></td><td>${w ? '🏆 ' : ''}${esc(p.name)}</td><td>${esc(s.short_en || t.school)}</td><td>${esc(p.score)}</td><td>${fmt(t.points)}</td></tr>`;
        }
      }
    }
    h += `
                </tbody>
              </table>
            </details>`;
  }

  h += `
            <details class="detail-toggle" style="margin-top: 0.5rem;">
              <summary class="detail-toggle-summary">
                <span class="lang-en">📋 ${isRun ? '10K Rules' : 'Golf Rules'}</span>
                <span class="lang-ko">📋 ${isRun ? '10K 규칙' : '골프 규칙'}</span>
              </summary>
              <div class="lang-en rules-block">${esc(event.rules_en)}</div>
              <div class="lang-ko rules-block">${esc(event.rules_ko)}</div>
            </details>
          </div>`;
  return h;
}

function renderPhotos(groups) {
  const live = (groups || []).filter(g => g && (g.items || []).length);
  if (!live.length) return '';
  let h = `
          <!-- Photo Gallery -->
          <div class="photo-gallery">
            <h3 class="photo-gallery-title">
              <span class="lang-en">📸 2026 Event Photos</span>
              <span class="lang-ko">📸 2026 대회 사진</span>
            </h3>`;
  for (const g of live) {
    h += `
            <div class="photo-category">
              <h4 class="photo-category-title">
                <span class="lang-en">${esc(g.category_en)}</span>
                <span class="lang-ko">${esc(g.category_ko)}</span>
              </h4>
              <div class="photo-grid${g.single ? ' single' : ''}">`;
    for (const it of g.items) {
      const src = typeof it === 'string' ? it : it.src;
      const alt = typeof it === 'string' ? 'Alumni Cup 2026' : (it.alt || 'Alumni Cup 2026');
      h += `
                <img src="${esc(src)}" alt="${esc(alt)}" loading="lazy">`;
    }
    h += `
              </div>
            </div>`;
  }
  return h + `
          </div>`;
}

function build(data) {
  const S = schoolMap(data.schools);
  const done = data.events.filter(e => e.status === 'completed');
  const body = done.map(e => renderEvent(e, S)).filter(Boolean).join('\n');
  const photos = renderPhotos(data.photos);
  if (!body && !photos) return { html: '', summary: 'no completed events and no photos — nothing to render' };

  const venues = done.map(e => `${e.title_en.replace(/^\S+\s/, '')} at ${e.venue_en}`).join(' / ');
  const venuesKo = done.map(e => `${e.title_ko.replace(/^\S+\s/, '')} @ ${e.venue_ko}`).join(' / ');
  const names = new Set();
  for (const e of done) {
    realRows(e.competitive).forEach(r => names.add(r.name));
    scoreEvent(e).recreational.forEach(t => t.players.forEach(p => names.add(p.name)));
  }

  const html = `
      <!-- 2026 Results - Collapsible -->
      <details class="results-year" open>
        <summary class="results-year-summary">
          <span class="triangle">▼</span>
          <span class="lang-en">🏆 2026 Results</span>
          <span class="lang-ko">🏆 2026 대회 결과</span>
        </summary>

        <div class="results-content">
          <p class="lang-en results-subtitle">${esc(venues)} — 2026</p>
          <p class="lang-ko results-subtitle">${esc(venuesKo)} — 2026년</p>
${body}
${photos}
          <p class="lang-en participation-note">${names.size} alumni participated.</p>
          <p class="lang-ko participation-note">${names.size}명의 동문이 참가했습니다.</p>
        </div>
      </details>
`;
  return { html, summary: `${done.length} event(s), ${names.size} participants, ${(data.photos || []).reduce((n, g) => n + (g.items || []).length, 0)} photos` };
}

function main() {
  const check = process.argv.includes('--check');
  const data = JSON.parse(fs.readFileSync(DATA, 'utf8'));
  const { html, summary } = build(data);

  let page = fs.readFileSync(HTML, 'utf8');
  const i = page.indexOf(START), j = page.indexOf(END);
  if (i === -1 || j === -1) {
    console.error(`Markers not found in index.html. Expected:\n  ${START}\n  ${END}`);
    process.exit(1);
  }

  const next = page.slice(0, i + START.length) + '\n' + html + '      ' + page.slice(j);
  console.log(`build-results: ${summary}`);

  if (next === page) { console.log('index.html already up to date.'); return; }
  if (check) { console.log(`--check: index.html WOULD change (${html.length} chars in the 2026 block).`); return; }

  fs.writeFileSync(HTML, next);
  console.log(`index.html updated (2026 block is ${html.length} chars).`);
}

main();
