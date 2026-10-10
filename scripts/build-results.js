#!/usr/bin/env node
/*
 * Builds the results parts of the site from data/<year>.json:
 *
 *   index.html          the current Cup Race card and the Champions row
 *                       (between the BUILD: markers)
 *   results/<year>.html one full results page per year: standings, every
 *                       event's individual results, photos
 *   sitemap.xml
 *
 * Where scores come from:
 *   - "source": "file" years (2025) keep their results in the JSON.
 *   - Every other year reads scores from Supabase: the owner enters them on
 *     admin.html and presses Publish. Only published (status = completed)
 *     events are readable with the public key, so a draft never leaks into
 *     the page. The JSON still supplies school names and colors, event
 *     titles, rules, scoring tables and photos.
 *
 * Ranks, points and team standings are computed by js/scoring.js, except
 * where an event carries "published_standings" (2025 10K used bonuses the
 * code does not model, so its published team scores are used as-is).
 *
 *   node scripts/build-results.js          write the files
 *   node scripts/build-results.js --check  report what would change, write nothing
 *
 * If Supabase cannot be reached the build fails rather than publishing a page
 * without results; on Vercel that keeps the previous deployment live.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const HTML = path.join(ROOT, 'index.html');
const SITE = 'https://winalumnicup.com';
const MARKERS = {
  standings: ['<!-- BUILD:STANDINGS -->', '<!-- /BUILD:STANDINGS -->'],
  champions: ['<!-- BUILD:CHAMPIONS -->', '<!-- /BUILD:CHAMPIONS -->'],
};

const { scoreEvent } = require('../js/scoring');
const { fromDb } = require('../js/cup-data');

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// Round to 3dp and drop trailing zeros: 13.620 -> "13.62", 50.000 -> "50".
const fmt = n => String(Number(Number(n).toFixed(3)));
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const SPORT = { golf: ['Golf', '골프'], run: ['10K', '10K'] };
const both = (en, ko, tag = 'span', cls = '') =>
  `<${tag} class="lang-en${cls ? ' ' + cls : ''}">${en}</${tag}><${tag} class="lang-ko${cls ? ' ' + cls : ''}">${ko}</${tag}>`;

// ------------------------------------------------------------------ data

/* Public URL + anon key: from the environment, else js/supabase-config.js. */
function supabaseConfig() {
  if (process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY) {
    return { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_ANON_KEY };
  }
  const cfg = fs.readFileSync(path.join(ROOT, 'js', 'supabase-config.js'), 'utf8');
  const get = name => (cfg.match(new RegExp(`window\\.${name} = "([^"]+)"`)) || [])[1];
  return { url: get('SUPABASE_URL'), key: get('SUPABASE_ANON_KEY') };
}

/* Replace each event's status and results in `data` with what is published. */
async function loadFromSupabase(data) {
  const { createClient } = require('@supabase/supabase-js');
  const { url, key } = supabaseConfig();
  if (!url || !key) throw new Error('No Supabase URL/key (env or js/supabase-config.js).');
  const db = createClient(url, key, { auth: { persistSession: false } });

  const [ev, sc] = await Promise.all([
    db.from('events').select('id, sport, status').eq('year', data.year),
    db.from('schools').select('id, code'),
  ]);
  if (ev.error) throw new Error('events: ' + ev.error.message);
  if (sc.error) throw new Error('schools: ' + sc.error.message);
  const codeById = Object.fromEntries(sc.data.map(s => [s.id, s.code]));

  const ids = ev.data.map(e => e.id);
  const pr = ids.length ? await db.from('participants').select('*').in('event_id', ids) : { data: [] };
  if (pr.error) throw new Error('participants: ' + pr.error.message);

  for (const e of data.events) {
    const row = ev.data.find(x => x.sport === e.sport);
    if (!row) throw new Error(`No ${data.year} ${e.sport} event in Supabase.`);
    const published = row.status === 'completed';
    const res = fromDb(pr.data.filter(p => p.event_id === row.id), codeById);
    e.status = published ? 'completed' : 'pending';
    e.competitive = published ? res.competitive : [];
    e.recreational = published ? res.recreational : [];
  }
  return data;
}

async function loadYears() {
  const files = fs.readdirSync(DATA_DIR).filter(f => /^\d{4}\.json$/.test(f)).sort().reverse();
  const years = [];
  for (const f of files) {
    const data = JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), 'utf8'));
    years.push(data.source === 'file' ? data : await loadFromSupabase(data));
  }
  return years; // newest first
}

const done = e => e.status === 'completed';

/* Team standings for one event: published numbers if the event has them. */
function eventStandings(e) {
  if (e.published_standings) {
    return Object.entries(e.published_standings)
      .map(([school, points]) => ({ school, points }))
      .sort((a, b) => b.points - a.points)
      .map((r, i) => ({ ...r, rank: i + 1 }));
  }
  return scoreEvent(e).standings;
}

/* The Cup across a year's events: per-event points and totals per school. */
function yearSummary(data) {
  const per = {};
  for (const e of data.events.filter(done)) {
    per[e.sport] = Object.fromEntries(eventStandings(e).map(r => [r.school, r.points]));
  }
  const rows = data.schools.map(s => ({
    code: s.code,
    byEvent: data.events.map(e => (per[e.sport] ? per[e.sport][s.code] || 0 : null)),
    total: Object.values(per).reduce((n, p) => n + (p[s.code] || 0), 0),
  })).sort((a, b) => b.total - a.total);
  const completed = data.events.filter(done).length;
  return {
    rows,
    completed,
    final: completed === data.events.length,
    next: data.events.find(e => !done(e)),
  };
}

const schoolMap = schools => Object.fromEntries(schools.map(s => [s.code, s]));

function dateLabel(d) {
  const [, m, day] = d.split('-').map(Number);
  return day ? [`${MONTHS[m - 1]} ${day}`, `${m}월 ${day}일`] : [MONTHS[m - 1], `${m}월`];
}

// ------------------------------------------------------- shared renderers

/* Cup Race table: per-event points, total, a bar in each school's color. */
function renderStandingsTable(data) {
  const S = schoolMap(data.schools);
  const { rows } = yearSummary(data);
  const top = rows[0].total || 1;
  const head = data.events.map(e => `<th class="num">${both(SPORT[e.sport][0], SPORT[e.sport][1])}</th>`).join('');
  let h = `
    <table class="cup-race-table">
      <thead><tr><th class="rank">#</th><th>${both('School', '학교')}</th>${head}<th class="num">${both('Total', '합계')}</th></tr></thead>
      <tbody>`;
  rows.forEach((r, i) => {
    const s = S[r.code];
    const cells = r.byEvent.map(v => `<td class="num">${v === null ? '<span class="tbd">–</span>' : fmt(v)}</td>`).join('');
    h += `
        <tr${i === 0 ? ' class="leader"' : ''}>
          <td class="rank">${i + 1}</td>
          <td class="school-cell">
            ${both(`${esc(s.emoji)} ${esc(s.short_en)}`, `${esc(s.emoji)} ${esc(s.short_ko)}`)}
            <span class="bar" aria-hidden="true"><span style="width: ${(100 * r.total / top).toFixed(1)}%; background: ${esc(s.color || '#00274c')}"></span></span>
          </td>${cells}
          <td class="num total">${fmt(r.total)}</td>
        </tr>`;
  });
  return h + `
      </tbody>
    </table>`;
}

function statusLine(data) {
  const { completed, final, next } = yearSummary(data);
  if (final) return both('Final standings', '최종 순위');
  // The countdown text is filled in by js/site.js, so it stays correct
  // without a rebuild every day.
  const [en, ko] = dateLabel(next.date);
  const cd = ` <span class="countdown" data-countdown="${next.date}"></span>`;
  return both(
    `After ${completed} of ${data.events.length} events · Next: ${SPORT[next.sport][0]}, ${en}${cd}`,
    `${data.events.length}개 종목 중 ${completed}개 종료 · 다음: ${SPORT[next.sport][1]} ${ko}${cd}`);
}

function renderPhotos(data, prefix) {
  const groups = (data.photos || []).filter(g => g && (g.items || []).length);
  if (!groups.length) return '';
  let h = `
      <section class="year-section" id="photos">
        <h2>${both(`📸 ${data.year} Photos`, `📸 ${data.year} 대회 사진`)}</h2>
        <div class="photo-gallery">`;
  for (const g of groups) {
    h += `
          <div class="photo-category">
            <h4 class="photo-category-title">${both(esc(g.category_en), esc(g.category_ko))}</h4>
            <div class="photo-grid${g.single ? ' single' : ''}">`;
    for (const it of g.items) {
      const src = typeof it === 'string' ? it : it.src;
      const alt = typeof it === 'string' ? `Alumni Cup ${data.year}` : (it.alt || `Alumni Cup ${data.year}`);
      // The grid crops every photo to a fixed height; `position` (CSS
      // object-position, e.g. "center 85%") keeps people in tall shots in frame.
      const pos = typeof it === 'object' && it.position ? ` style="object-position: ${esc(it.position)}"` : '';
      h += `
              <img src="${esc(prefix + src)}" alt="${esc(alt)}" loading="lazy"${pos}>`;
    }
    h += `
            </div>
          </div>`;
  }
  return h + `
        </div>
      </section>`;
}

// ------------------------------------------------------------ index.html

function buildStandingsBlock(data) {
  if (!data.events.some(done)) return '';
  return `
  <section class="cup-race" id="standings" aria-labelledby="cup-race-title">
    <div class="cup-race-head">
      <h2 id="cup-race-title">${both(`${data.year} Cup Race`, `${data.year} 종합 순위`)}</h2>
      <p class="cup-race-status">${statusLine(data)}</p>
    </div>${renderStandingsTable(data)}
    <a class="cup-race-link" href="results/${data.year}.html">${both('Full results &amp; photos →', '전체 결과 및 사진 보기 →')}</a>
  </section>
`;
}

function buildChampionsBlock(years) {
  let h = `
      <div class="champions">`;
  for (const data of years) {
    const S = schoolMap(data.schools);
    const sum = yearSummary(data);
    const lead = S[sum.rows[0].code];
    const started = sum.completed > 0;
    const headline = sum.final
      ? both(`🏆 ${esc(lead.emoji)} ${esc(lead.short_en)}`, `🏆 ${esc(lead.emoji)} ${esc(lead.short_ko)}`, 'span', 'champ-name')
      : both(started ? 'In progress' : 'Coming up', started ? '진행 중' : '예정', 'span', 'champ-name pending');
    const note = sum.final ? both('Champion', '우승') : started
      ? both(`${esc(lead.short_en)} leads after ${sum.completed} of ${data.events.length}`, `${esc(lead.short_ko)} 선두 (${data.events.length}개 중 ${sum.completed}개 종료)`)
      : '';
    h += `
        <a class="champ-card${sum.final ? ' final' : ''}" href="results/${data.year}.html" style="--c: ${esc(lead.color || '#00274c')}">
          <span class="champ-year">${data.year}</span>
          ${data.edition_en ? both(esc(data.edition_en), esc(data.edition_ko), 'span', 'champ-edition') : ''}
          ${headline}
          <span class="champ-note">${note}</span>
          <ol class="champ-scores">${started ? sum.rows.map(r => `
            <li><span>${both(`${esc(S[r.code].emoji)} ${esc(S[r.code].short_en)}`, `${esc(S[r.code].emoji)} ${esc(S[r.code].short_ko)}`)}</span><b>${fmt(r.total)}</b></li>`).join('') : ''}
          </ol>
          <span class="champ-link">${both('Full results &amp; photos →', '전체 결과 및 사진 →')}</span>
        </a>`;
  }
  return h + `
      </div>
`;
}

// ----------------------------------------------------- results/<year>.html

function renderEventSection(e, data) {
  const S = schoolMap(data.schools);
  const isRun = e.sport === 'run';
  const [dEn, dKo] = dateLabel(e.date);
  let h = `
      <section class="year-section event-results" id="${e.sport}">
        <h2>${both(esc(e.title_en), esc(e.title_ko))}</h2>
        <p class="event-meta">${both(`${dEn} ${data.year} · ${esc(e.venue_en)}`, `${data.year}년 ${dKo} · ${esc(e.venue_ko)}`)}</p>`;

  if (!done(e)) {
    return h + `
        <div class="event-upcoming">
          ${both(`Results will appear here after the event. <span class="countdown" data-countdown="${e.date}"></span>`,
                 `대회 후 결과가 게시됩니다. <span class="countdown" data-countdown="${e.date}"></span>`, 'p')}
        </div>
      </section>`;
  }

  const table = eventStandings(e);
  const best = Math.max(...table.map(r => r.points)) || 1;
  for (const row of table) {
    const s = S[row.school] || { name_en: row.school, name_ko: row.school };
    const trophy = row.rank === 1 ? '🏆 ' : '';
    h += `
        <div class="result-row${row.rank === 1 ? ' first' : ''}">
          ${both(`${trophy}${esc(s.name_en)}`, `${trophy}${esc(s.name_ko)}`, 'span', 'school')}
          ${both(`${fmt(row.points)} <small>pts</small>`, `${fmt(row.points)} <small>점</small>`, 'span', 'score')}
          <span class="result-bar" aria-hidden="true"><span style="width: ${(100 * row.points / best).toFixed(1)}%; background: ${esc(s.color || '#00274c')}"></span></span>
        </div>`;
  }

  const { competitive: comp, recreational: rec } = scoreEvent(e);
  const pts = e.show_points !== false;
  const tableId = `t-${data.year}-${e.sport}`;
  if (comp.length) {
    const inEvent = data.schools.filter(s => comp.some(r => r.school === s.code));
    h += `
        <h3>${both(isRun ? 'Individual times' : (rec.length ? 'Individual (competitive)' : 'Individual scores'), isRun ? '개인 기록' : (rec.length ? '선수부 (개인전)' : '개인 성적'))}</h3>
        <div class="chips" role="group" aria-label="Filter by school" data-filter="${tableId}">
          <button type="button" aria-pressed="true" data-school="">${both('All', '전체')}</button>${inEvent.map(s => `
          <button type="button" aria-pressed="false" data-school="${s.code}">${both(`${esc(s.emoji)} ${esc(s.short_en)}`, `${esc(s.emoji)} ${esc(s.short_ko)}`)}</button>`).join('')}
        </div>
        <div class="results-table-wrap">
          <table class="results-table" id="${tableId}">
            <thead><tr><th class="rank">#</th><th>${both('Name', '이름')}</th><th>${both('School', '학교')}</th><th class="num">${both(isRun ? 'Time' : 'Score', isRun ? '기록' : '타수')}</th>${pts ? `<th class="num">${both('Pts', '점수')}</th>` : ''}</tr></thead>
            <tbody>`;
    for (const r of comp) {
      const s = S[r.school] || {};
      const badge = r.badge_en ? ` <span class="badge-mini">${both(esc(r.badge_en), esc(r.badge_ko || r.badge_en))}</span>` : '';
      h += `
              <tr data-school="${esc(r.school)}"${r.rank === 1 ? ' class="winner"' : ''}><td class="rank">${r.rank}</td><td>${r.rank === 1 ? '🏆 ' : ''}${esc(r.name)}${badge}</td><td>${both(esc(s.short_en || r.school), esc(s.short_ko || r.school))}</td><td class="num">${esc(isRun ? r.time : r.score)}</td>${pts ? `<td class="num">${fmt(r.points)}</td>` : ''}</tr>`;
    }
    h += `
            </tbody>
          </table>
        </div>`;
  }

  if (rec.length) {
    h += `
        <h3>${both('Team matches (recreational)', '일반부 팀 매치')}</h3>
        <div class="match-grid">`;
    for (const m of [...new Set(rec.map(t => t.match))].sort((a, b) => a - b)) {
      const teams = rec.filter(t => t.match === m).sort((a, b) => (a.result === 'win' ? 0 : 1) - (b.result === 'win' ? 0 : 1));
      h += `
          <div class="match-card">
            <div class="match-title">${both(`Match ${m}`, `${m}경기`)}</div>`;
      for (const t of teams) {
        const s = S[t.school] || {};
        const w = t.result === 'win';
        h += `
            <div class="match-team${w ? ' won' : ''}" style="--c: ${esc(s.color || '#00274c')}">
              <div class="match-team-head">${both(`${w ? '🏆 ' : ''}${esc(s.emoji)} ${esc(s.short_en)}`, `${w ? '🏆 ' : ''}${esc(s.emoji)} ${esc(s.short_ko)}`)}<b>${fmt(t.points)}</b></div>
              <ul>${t.players.map(p => `<li>${esc(p.name)}<span>${esc(p.score)}</span></li>`).join('')}</ul>
            </div>`;
      }
      h += `
          </div>`;
    }
    h += `
        </div>`;
  }

  return h + `
        <details class="detail-toggle">
          <summary class="detail-toggle-summary">${both(`📋 How ${data.year} ${SPORT[e.sport][0]} was scored`, `📋 ${data.year} ${SPORT[e.sport][1]} 채점 방식`)}</summary>
          <div class="lang-en rules-block">${esc(e.rules_en)}</div>
          <div class="lang-ko rules-block">${esc(e.rules_ko)}</div>
        </details>
      </section>`;
}

/* The index page's nav and footer, re-pointed from the results/ folder. */
function chrome(page) {
  const grab = (a, b) => page.slice(page.indexOf(a), page.indexOf(b) + b.length);
  const fix = s => s
    .replace(/href="#/g, 'href="../#')
    .replace(/href="(apply|admin)\.html/g, 'href="../$1.html');
  return {
    nav: fix(grab('<nav>', '</nav>')),
    footer: fix(grab('<footer>', '</footer>')),
  };
}

function buildYearPage(data, years, page) {
  const { nav, footer } = chrome(page);
  const sum = yearSummary(data);
  const S = schoolMap(data.schools);
  const lead = S[sum.rows[0].code];
  const firstPhoto = (data.photos || []).flatMap(g => g.items || [])[0];
  const ogImage = firstPhoto ? `${SITE}/${typeof firstPhoto === 'string' ? firstPhoto : firstPhoto.src}` : `${SITE}/alumni-cup.jpg`;
  const description = sum.final
    ? `${data.year} Alumni Cup results: ${lead.name_en} won. Golf and 10K standings, individual scores and photos.`
    : `${data.year} Alumni Cup results so far: standings, individual scores and photos.`;
  const subtitle = sum.final
    ? both(`🏆 Champion: ${esc(lead.emoji)} ${esc(lead.name_en)}`, `🏆 우승: ${esc(lead.emoji)} ${esc(lead.name_ko)}`, 'p', 'year-sub')
    : `<p class="year-sub">${statusLine(data)}</p>`;
  // Years without a stated count (Supabase years) count distinct names.
  let people = data.participants_en ? [data.participants_en, data.participants_ko] : null;
  if (!people) {
    const names = new Set();
    for (const e of data.events.filter(done)) {
      (e.competitive || []).forEach(r => r.name && names.add(r.name.trim()));
      (e.recreational || []).forEach(m => m.teams.forEach(t => t.players.forEach(p => p.name && names.add(String(p.name).trim()))));
    }
    if (names.size) people = sum.final
      ? [`${names.size} alumni took part.`, `${names.size}명의 동문이 참가했습니다.`]
      : [`${names.size} alumni have taken part so far.`, `지금까지 ${names.size}명의 동문이 참가했습니다.`];
  }
  const tabs = years.map(y => `<a href="${y.year}.html"${y.year === data.year ? ' aria-current="page"' : ''}>${y.year}</a>`).join('');
  const jump = data.events.map(e => `<a href="#${e.sport}">${both(SPORT[e.sport][0], SPORT[e.sport][1])}</a>`).join('')
    + ((data.photos || []).some(g => (g.items || []).length) ? `<a href="#photos">${both('Photos', '사진')}</a>` : '');

  return `<!DOCTYPE html>
<!-- Generated by scripts/build-results.js from data/${data.year}.json${data.source === 'file' ? '' : ' and Supabase'}. Do not edit by hand. -->
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${data.year} Results - The Alumni Cup</title>
  <meta name="description" content="${esc(description)}">
  <link rel="canonical" href="${SITE}/results/${data.year}">
  <meta property="og:title" content="${data.year} Alumni Cup Results">
  <meta property="og:description" content="${esc(description)}">
  <meta property="og:image" content="${esc(ogImage)}">
  <meta property="og:url" content="${SITE}/results/${data.year}">
  <meta name="twitter:card" content="summary_large_image">
  <link rel="icon" type="image/png" href="../favicon2.png">
  <link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css">
  <link rel="stylesheet" href="../css/site.css">
</head>
<body class="results-page">
  ${nav}

  <header class="year-hero">
    <div class="year-tabs" role="navigation" aria-label="Results by year">${tabs}</div>
    <h1>${both(`${data.year} Alumni Cup`, `${data.year} 알룸나이 컵`)}</h1>
    ${data.edition_en ? both(esc(data.edition_en), esc(data.edition_ko), 'p', 'year-edition') : ''}
    ${subtitle}
  </header>

  <main class="container year-main">
    <section class="cup-race year-standings" aria-labelledby="standings-title">
      <div class="cup-race-head">
        <h2 id="standings-title">${both('Overall standings', '종합 순위')}</h2>
        <div class="year-jump" role="navigation" aria-label="On this page">${jump}</div>
      </div>${renderStandingsTable(data)}
    </section>
${data.events.map(e => renderEventSection(e, data)).join('\n')}
${renderPhotos(data, '../')}
    ${people ? both(esc(people[0]), esc(people[1]), 'p', 'participation-note') : ''}
    <p class="back-home"><a href="../#results">${both('← All years', '← 전체 연도')}</a></p>
  </main>

  ${footer}

  <script src="../js/site.js"></script>
</body>
</html>
`;
}

function buildSitemap(years) {
  const today = new Date().toISOString().slice(0, 10);
  const url = (loc, prio) => `  <url>\n    <loc>${loc}</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>monthly</changefreq>\n    <priority>${prio}</priority>\n  </url>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${[url(`${SITE}/`, '1.0'), url(`${SITE}/apply`, '0.8'), ...years.map(y => url(`${SITE}/results/${y.year}`, '0.7'))].join('\n')}
</urlset>
`;
}

// ----------------------------------------------------------------- write

function inject(page, [start, end], html, indent) {
  const i = page.indexOf(start), j = page.indexOf(end);
  if (i === -1 || j === -1) throw new Error(`Markers not found in index.html: ${start} … ${end}`);
  return page.slice(0, i + start.length) + '\n' + html + indent + page.slice(j);
}

async function main() {
  const check = process.argv.includes('--check');
  const years = await loadYears();
  const current = years[0];

  const page = fs.readFileSync(HTML, 'utf8');
  // Git on Windows checks files out with CRLF; keep whatever the page has so
  // a rebuild only shows real changes.
  const eol = page.includes('\r\n') ? '\r\n' : '\n';
  const norm = s => s.replace(/\r?\n/g, eol);

  let index = inject(page, MARKERS.standings, buildStandingsBlock(current), '  ');
  index = inject(index, MARKERS.champions, buildChampionsBlock(years), '      ');
  const out = new Map([[HTML, norm(index)], [path.join(ROOT, 'sitemap.xml'), buildSitemap(years)]]);
  for (const y of years) out.set(path.join(ROOT, 'results', `${y.year}.html`), buildYearPage(y, years, page));

  const changed = [...out].filter(([f, s]) => !fs.existsSync(f) || fs.readFileSync(f, 'utf8') !== s);
  const rel = f => path.relative(ROOT, f).replace(/\\/g, '/');
  console.log(`build-results: ${years.map(y => `${y.year} (${y.events.filter(done).length}/${y.events.length} events)`).join(', ')}`);
  if (!changed.length) { console.log('everything already up to date.'); return; }
  if (check) { console.log('--check: would update ' + changed.map(([f]) => rel(f)).join(', ')); return; }
  fs.mkdirSync(path.join(ROOT, 'results'), { recursive: true });
  for (const [f, s] of changed) fs.writeFileSync(f, s);
  console.log('updated ' + changed.map(([f]) => rel(f)).join(', '));
}

if (require.main === module) {
  main().catch(e => { console.error('build-results failed:', e.message); process.exit(1); });
}

module.exports = { main };
