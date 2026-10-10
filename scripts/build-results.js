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
const STANDINGS_START = '<!-- BUILD:STANDINGS-2026 -->';
const STANDINGS_END = '<!-- /BUILD:STANDINGS-2026 -->';

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

  const best = Math.max(...table.map(r => r.points)) || 1;
  for (const row of table) {
    const s = S[row.school] || { name_en: row.school, name_ko: row.school };
    const trophy = row.rank === 1 ? '🏆 ' : '';
    h += `
            <div class="result-row${row.rank === 1 ? ' first' : ''}">
              <span class="school lang-en">${trophy}${esc(s.name_en)}</span>
              <span class="school lang-ko">${trophy}${esc(s.name_ko)}</span>
              <span class="score lang-en">${fmt(row.points)} <small>pts</small></span>
              <span class="score lang-ko">${fmt(row.points)} <small>점</small></span>
              <span class="result-bar" aria-hidden="true"><span style="width: ${(100 * row.points / best).toFixed(1)}%; background: ${esc(s.color || '#00274c')}"></span></span>
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

// Categories shown before the "View all" button. The rest are in the page
// (the lightbox steps through them too) but hidden until asked for, so the
// gallery does not turn the results section into a very long scroll.
const PHOTO_CATEGORIES_SHOWN = 2;

function renderPhotos(groups) {
  const live = (groups || []).filter(g => g && (g.items || []).length);
  if (!live.length) return '';
  const total = live.reduce((n, g) => n + g.items.length, 0);
  let h = `
          <!-- Photo Gallery -->
          <div class="photo-gallery">
            <h3 class="photo-gallery-title">
              <span class="lang-en">📸 2026 Event Photos</span>
              <span class="lang-ko">📸 2026 대회 사진</span>
            </h3>`;
  live.forEach((g, gi) => {
    const extra = gi >= PHOTO_CATEGORIES_SHOWN;
    h += `
            <div class="photo-category${extra ? ' more' : ''}"${extra ? ' hidden' : ''}>
              <h4 class="photo-category-title">
                <span class="lang-en">${esc(g.category_en)}</span>
                <span class="lang-ko">${esc(g.category_ko)}</span>
              </h4>
              <div class="photo-grid${g.single ? ' single' : ''}">`;
    for (const it of g.items) {
      const src = typeof it === 'string' ? it : it.src;
      const alt = typeof it === 'string' ? 'Alumni Cup 2026' : (it.alt || 'Alumni Cup 2026');
      // The grid crops every photo to a fixed height; `position` (CSS
      // object-position, e.g. "center 85%") keeps people in tall shots in frame.
      const pos = typeof it === 'object' && it.position ? ` style="object-position: ${esc(it.position)}"` : '';
      h += `
                <img src="${esc(src)}" alt="${esc(alt)}" loading="lazy"${pos}>`;
    }
    h += `
              </div>
            </div>`;
  });
  if (live.length > PHOTO_CATEGORIES_SHOWN) {
    h += `
            <button type="button" class="photo-more">
              <span class="lang-en">View all ${total} photos</span>
              <span class="lang-ko">사진 ${total}장 모두 보기</span>
            </button>`;
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
          <span class="triangle" aria-hidden="true"></span>
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

/*
 * The overall Cup race: each school's points per event, summed. Shown near the
 * top of the page so visitors can see who leads between events, not only once
 * the last one is done.
 */
function buildStandings(data) {
  const S = schoolMap(data.schools);
  const events = data.events;
  const done = events.filter(e => e.status === 'completed');
  if (!done.length) return '';

  const perEvent = {};
  for (const e of done) {
    perEvent[e.sport] = Object.fromEntries(scoreEvent(e).standings.map(r => [r.school, r.points]));
  }
  const rows = data.schools.map(s => ({
    code: s.code,
    byEvent: events.map(e => perEvent[e.sport] ? (perEvent[e.sport][s.code] || 0) : null),
    total: done.reduce((n, e) => n + (perEvent[e.sport][s.code] || 0), 0),
  })).sort((a, b) => b.total - a.total);
  const top = rows[0].total || 1;
  const next = events.find(e => e.status !== 'completed');

  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const [, mm, dd] = next ? next.date.split('-').map(Number) : [];
  const nameEn = { golf: 'Golf', run: '10K' }, nameKo = { golf: '골프', run: '10K' };
  // The countdown text itself is filled in by the page script, so it stays
  // correct without a rebuild every day.
  const countdown = next ? ` <span class="countdown" data-countdown="${next.date}"></span>` : '';
  const statusEn = next
    ? `After ${done.length} of ${events.length} events · Next: ${nameEn[next.sport]}, ${MONTHS[mm - 1]} ${dd}${countdown}`
    : 'Final standings';
  const statusKo = next
    ? `${events.length}개 종목 중 ${done.length}개 종료 · 다음: ${nameKo[next.sport]} ${mm}월 ${dd}일${countdown}`
    : '최종 순위';

  const head = events.map(e =>
    `<th class="num"><span class="lang-en">${nameEn[e.sport]}</span><span class="lang-ko">${nameKo[e.sport]}</span></th>`).join('');

  let h = `
  <section class="cup-race" id="standings" aria-labelledby="cup-race-title">
    <div class="cup-race-head">
      <h2 id="cup-race-title"><span class="lang-en">${data.year} Cup Race</span><span class="lang-ko">${data.year} 종합 순위</span></h2>
      <p class="cup-race-status"><span class="lang-en">${statusEn}</span><span class="lang-ko">${statusKo}</span></p>
    </div>
    <table class="cup-race-table">
      <thead><tr><th class="rank">#</th><th><span class="lang-en">School</span><span class="lang-ko">학교</span></th>${head}<th class="num"><span class="lang-en">Total</span><span class="lang-ko">합계</span></th></tr></thead>
      <tbody>`;
  rows.forEach((r, i) => {
    const s = S[r.code];
    const cells = r.byEvent.map(v => `<td class="num">${v === null ? '<span class="tbd">–</span>' : fmt(v)}</td>`).join('');
    h += `
        <tr${i === 0 ? ' class="leader"' : ''}>
          <td class="rank">${i + 1}</td>
          <td class="school-cell">
            <span class="lang-en">${esc(s.emoji)} ${esc(s.short_en)}</span><span class="lang-ko">${esc(s.emoji)} ${esc(s.short_ko)}</span>
            <span class="bar" aria-hidden="true"><span style="width: ${(100 * r.total / top).toFixed(1)}%; background: ${esc(s.color || '#00274c')}"></span></span>
          </td>${cells}
          <td class="num total">${fmt(r.total)}</td>
        </tr>`;
  });
  return h + `
      </tbody>
    </table>
    <a class="cup-race-link" href="#results"><span class="lang-en">Full results &amp; photos →</span><span class="lang-ko">전체 결과 및 사진 보기 →</span></a>
  </section>
`;
}

function inject(page, start, end, html, indent) {
  const i = page.indexOf(start), j = page.indexOf(end);
  if (i === -1 || j === -1) {
    console.error(`Markers not found in index.html. Expected:\n  ${start}\n  ${end}`);
    process.exit(1);
  }
  return page.slice(0, i + start.length) + '\n' + html + indent + page.slice(j);
}

function main() {
  const check = process.argv.includes('--check');
  const data = JSON.parse(fs.readFileSync(DATA, 'utf8'));
  const { html, summary } = build(data);

  const page = fs.readFileSync(HTML, 'utf8');
  let next = inject(page, START, END, html, '      ');
  next = inject(next, STANDINGS_START, STANDINGS_END, buildStandings(data), '  ');
  console.log(`build-results: ${summary}`);

  if (next === page) { console.log('index.html already up to date.'); return; }
  if (check) { console.log(`--check: index.html WOULD change (${html.length} chars in the 2026 block).`); return; }

  fs.writeFileSync(HTML, next);
  console.log(`index.html updated (2026 block is ${html.length} chars).`);
}

main();
