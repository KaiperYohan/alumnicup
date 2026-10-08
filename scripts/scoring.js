/*
 * Scoring rules for The Alumni Cup.
 *
 * Shared by scripts/build-results.js (renders the page) and
 * scripts/import-to-supabase.js (fills the database). Keeping one copy is the
 * point: if these ever diverge, the published standings and the stored
 * standings disagree and there is no way to tell which is right.
 */

/* "1:02:03" | "48:23" | 93 -> seconds. null for blank/unparseable. */
function toSeconds(t) {
  if (t === null || t === undefined || t === '') return null;
  if (typeof t === 'number') return t;
  const p = String(t).trim().split(':').map(Number);
  if (p.some(isNaN)) return null;
  return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2]
       : p.length === 2 ? p[0] * 60 + p[1]
       : p[0];
}

/* Strip the _comment/_example scaffolding rows and anything unnamed. */
function realRows(arr) {
  return (arr || []).filter(r =>
    r && !Object.keys(r).some(k => k.startsWith('_')) && String(r.name || '').trim());
}

/*
 * Rank the competitive field across all schools and assign points.
 *
 * Ties share the better rank and each tied competitor takes that rank's
 * points, which is how 2025 was scored (two golfers tied on 90 both took the
 * trophy mark). This means a tie pays out slightly more than the table's
 * nominal total — intentional, and the alternative (splitting) would have
 * contradicted the published result.
 */
function scoreCompetitive(event) {
  const order = event.scoring?.order === 'desc' ? -1 : 1;
  const isRun = event.sport === 'run';

  const rows = realRows(event.competitive)
    .map(r => ({ ...r, _v: isRun ? toSeconds(r.time) : Number(r.score) }))
    .filter(r => r._v !== null && !isNaN(r._v))
    .sort((a, b) => (a._v - b._v) * order);

  const table = event.scoring?.rank_points || [];
  let prevVal = null, prevRank = 0;

  rows.forEach((r, i) => {
    r.rank = r._v === prevVal ? prevRank : i + 1;
    prevVal = r._v; prevRank = r.rank;

    if (r.points === undefined || r.points === null) {
      r.points = table[r.rank - 1] ?? 0;
      const bonus = event.scoring?.place_bonus?.[String(r.rank)];
      if (bonus) r.points += bonus;
    }
  });
  return rows;
}

/* Recreational golf: team matches, winner and loser each take a flat score. */
function scoreRecreational(event) {
  const pts = event.scoring?.team_match_points || { win: 0, loss: 0 };
  const matches = (event.recreational || [])
    .filter(m => m && !Object.keys(m).some(k => k.startsWith('_')));

  const out = [];
  for (const m of matches) {
    for (const t of m.teams || []) {
      const players = (t.players || []).filter(p => String(p.name || '').trim());
      if (!players.length) continue;
      out.push({
        match: m.match,
        school: t.school,
        result: t.result,
        players,
        points: t.points ?? (pts[t.result] ?? 0),
      });
    }
  }
  return out;
}

/* Sum per school, then apply the school bonus on the pre-bonus standing. */
function standings(event, competitive, recreational) {
  const totals = {};
  const add = (school, p) => { totals[school] = (totals[school] || 0) + p; };
  competitive.forEach(r => add(r.school, r.points));
  recreational.forEach(t => add(t.school, t.points));

  const rows = Object.entries(totals)
    .map(([school, points]) => ({ school, points }))
    .sort((a, b) => b.points - a.points);

  const sb = event.scoring?.school_bonus;
  if (sb) rows.forEach((r, i) => { r.points += sb[String(i + 1)] || 0; });

  rows.sort((a, b) => b.points - a.points);
  rows.forEach((r, i) => { r.rank = i + 1; });
  return rows;
}

function scoreEvent(event) {
  const competitive = scoreCompetitive(event);
  const recreational = scoreRecreational(event);
  return { competitive, recreational, standings: standings(event, competitive, recreational) };
}

module.exports = { toSeconds, realRows, scoreCompetitive, scoreRecreational, standings, scoreEvent };
