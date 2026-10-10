/*
 * Converts between the database's `participants` rows and the event shape
 * that scoring.js and the page builder work with (the same shape as the
 * events in data/<year>.json: competitive[] and recreational[] matches).
 *
 * Shared by scripts/build-results.js, scripts/import-to-supabase.js and
 * admin.html, so the score sheet, the database and the published page all
 * read and write results the same way. CommonJS in Node, window.AlumniCupData
 * in the browser.
 */
(function () {
  'use strict';

  var scoring = typeof module !== 'undefined' && module.exports
    ? require('./scoring')
    : window.AlumniScoring;

  /* Seconds -> "H:MM:SS" (or "MM:SS" under an hour is still written H:MM:SS,
     because Postgres reads a bare "38:37" as 38 hours 37 minutes). */
  function formatTime(t) {
    var sec = scoring.toSeconds(t);
    if (sec === null || isNaN(sec)) return null;
    var h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = Math.round(sec % 60);
    return h + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  }

  function num(v) { return v === null || v === undefined || v === '' ? null : Number(v); }

  /*
   * participants rows for one event -> { competitive, recreational }.
   * `codeById` maps school uuid -> school code ("texas").
   * Hand-set overrides come back as rank/points on the row, exactly like a
   * row in data/<year>.json, so scoring.js treats them the same way.
   */
  function fromDb(rows, codeById) {
    var competitive = [], matches = {};
    // Stored rank first so ties keep the order they were saved in.
    rows = rows.slice().sort(function (a, b) {
      return (a.rank == null ? 1e9 : a.rank) - (b.rank == null ? 1e9 : b.rank) || String(a.name).localeCompare(b.name);
    });
    rows.forEach(function (p) {
      var school = codeById[p.school_id] || p.school_id;
      if (p.division === 'competitive') {
        var r = { name: p.name, school: school, score: num(p.raw_score), time: p.finish_time ? formatTime(p.finish_time) : null };
        if (p.rank_override != null) r.rank = p.rank_override;
        if (p.points_override != null) r.points = Number(p.points_override);
        competitive.push(r);
      } else {
        var m = matches[p.match_no] || (matches[p.match_no] = { match: p.match_no, teams: [] });
        var t = m.teams.filter(function (x) { return x.school === school; })[0];
        if (!t) { t = { school: school, result: p.team_result, players: [] }; m.teams.push(t); }
        t.players.push({ name: p.name, score: num(p.raw_score) });
      }
    });
    // The table keeps no display order, so use a fixed one: winning team
    // first, then players by score.
    var recreational = Object.keys(matches).map(function (k) { return matches[k]; })
      .sort(function (a, b) { return a.match - b.match; });
    recreational.forEach(function (m) {
      m.teams.sort(function (a, b) { return (a.result === 'win' ? 0 : 1) - (b.result === 'win' ? 0 : 1); });
      m.teams.forEach(function (t) {
        t.players.sort(function (a, b) {
          return (a.score == null ? 1e9 : a.score) - (b.score == null ? 1e9 : b.score) || String(a.name).localeCompare(b.name);
        });
      });
    });
    return { competitive: competitive, recreational: recreational };
  }

  /*
   * An event (with competitive/recreational filled in) -> rows for the
   * replace_participants() function, with ranks and points computed.
   * `idByCode` maps school code -> uuid.
   */
  function toDb(event, idByCode) {
    var isRun = event.sport === 'run';
    // Remember which rows carried a hand-set rank/points before scoring fills
    // both in on every row. (No leading underscore: realRows drops those.)
    var marked = Object.assign({}, event, {
      competitive: (event.competitive || []).map(function (r) {
        return Object.assign({}, r, { rankOverride: r.rank, pointsOverride: r.points });
      })
    });
    var scored = scoring.scoreEvent(marked);
    var rows = [];
    scored.competitive.forEach(function (r) {
      rows.push({
        school_id: idByCode[r.school], name: r.name, division: 'competitive',
        match_no: null, team_result: null,
        raw_score: isRun ? null : num(r.score),
        finish_time: isRun ? formatTime(r.time) : null,
        rank: r.rank, points: r.points,
        rank_override: r.rankOverride == null ? null : r.rankOverride,
        points_override: r.pointsOverride == null ? null : r.pointsOverride
      });
    });
    scored.recreational.forEach(function (t) {
      t.players.forEach(function (p) {
        rows.push({
          school_id: idByCode[t.school], name: p.name, division: 'recreational',
          match_no: t.match, team_result: t.result || null,
          raw_score: num(p.score), finish_time: null,
          rank: null, points: t.points, rank_override: null, points_override: null
        });
      });
    });
    return rows;
  }

  var AlumniCupData = { formatTime: formatTime, fromDb: fromDb, toDb: toDb };
  if (typeof module !== 'undefined' && module.exports) module.exports = AlumniCupData;
  else window.AlumniCupData = AlumniCupData;
})();
