# Publishing results and photos

One-time setup:

```
npm install
```

## Event day

**1. Photos.** Dump them off the camera/phone into any folder, then:

```
npm run photos -- "C:/Users/letme/Desktop/UTAKA/alumni cup proj/raw-oct10"
```

This writes web-sized copies into `pic/2026/`, leaves the source untouched,
and prints a JSON snippet. It bakes in EXIF rotation, so phone photos stay
upright.

**Keep the originals out of `pic/`.** Anything committed there is in git
history permanently — that is how the repo reached 26 MB. Park the originals
next to the repo in `originals/` (gitignored) and upload them to Supabase
storage later.

**2. Results.** Open `data/2026.json` and fill in:

- `events[].status` → `"completed"`
- `competitive[]` → one row per golfer/runner: `name`, `school`, and `score`
  (golf strokes) or `time` (`"0:38:37"`)
- `recreational[]` → the 4 team matches, marking each winner `"result": "win"`
- `photos[].items` → paste the snippet from step 1 and write the `alt` text

Delete the `_example` / `_comment` rows as you go; the build ignores them, but
they are only there as a guide.

You do **not** enter ranks, points or team totals — those are computed.

**3. Build and check.**

```
npm run build:results
```

Open `index.html` in a browser and look at the Results section. To preview
without writing: `npm run check:results`.

**4. Publish.**

```
git add -A && git commit -m "Add 2026 golf results and photos" && git push
```

GitHub Pages rebuilds in about 40 seconds.

## How scoring works

`scripts/scoring.js` is the single source of truth, shared by the page builder
and the database import so the two cannot disagree.

- **Golf** — competitive field ranked across all schools, points from the
  table in `data/2026.json` (3.89 down to 1.11, 40 points total). Each of the
  4 recreational matches pays 1.50 to the winning school and 1.00 to the
  loser, 10 points total. **Grand total 50.**
- **10K** — 40 runners ranked, 1.50 down to 0.50. Place bonus 1st +1.77,
  2nd +1.20, 3rd +1.00. School bonus 1st +3.00, 2nd +2.00, 3rd +1.00, applied
  on the standing before the bonus. **Total 50.**
- **Ties** share the better rank and each tied competitor takes that rank's
  points, matching how 2025 was scored. A tie therefore pays slightly more
  than the nominal total.

To override a computed number, add `"points": 2.75` to any row and it is used
verbatim.

## Supabase

Not yet live — the migrations have been written but never run against a real
project. To stand it up:

1. Create a project at supabase.com.
2. Run `supabase/migrations/0001_init.sql` then `0002_rls.sql` in the SQL
   editor, in that order.
3. `cp .env.example .env` and fill in the URL and service role key.
4. `npm run db:import -- --dry-run` to see the row counts, then without the
   flag to write.

`0002_rls.sql` is the file to read carefully: the site talks to Supabase with
the anon key, so every `to anon` policy is open to the internet. Registrations
are insert-only for the public — there is deliberately no public read policy,
so one registrant cannot pull everyone else's email and phone out of the
table.

Still to do: wire the registration form in `index.html` to the
`registrations` table, and move photo serving from `pic/` to storage.
