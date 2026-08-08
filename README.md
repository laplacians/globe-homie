# POD CLASH — Globe Homie CWL v4

This version merges three Google Sheets tabs:

- `CWL Dashboard`
- `7-Day Rolling Schedule`
- `Total Stars`

## Data logic

- `Game Pref` is intentionally ignored.
- Schedule `IN` = eligible attack.
- `IN - N/A` = in lineup, no attack.
- `OUT` = resting / not in lineup.
- Stars `0` = completed attack with zero stars.
- Blank star cell = pending / not entered.
- Upcoming days always display `UPCOMING —`.
- Total leaderboard includes all registered members.
- Daily leaderboard only includes members with schedule status `IN`.

## Performance ranking

Total performance is sorted by:

1. Stars per completed attack
2. Avg Destruction %
3. Total Stars
4. Completed attack count

## CWL timing

Fallback:
`Day 1 Start = 2026-08-02 19:58 GMT+7`

This produces:
`Day 6 End = 2026-08-08 19:58 GMT+7`

Optional live spreadsheet override:
add a row to `CWL Dashboard`:

`CWL DAY 1 START | 2026-08-02T19:58:00+07:00`

The website will use that timestamp when the row is present.

## Google Sheets publishing

All three tabs must be publicly readable through Google Sheets GViz CSV.

The app refreshes all three every 60 seconds and falls back to `fallback-data.js` if live loading fails.

## GitHub Pages

Upload all files in this folder to the repository root:

- `index.html`
- `styles.css`
- `app.js`
- `config.js`
- `fallback-data.js`
- `.nojekyll`
- `CNAME` if using `podclash.lyvrastudio.com`

For the custom domain, `CNAME` should contain only:

`podclash.lyvrastudio.com`
