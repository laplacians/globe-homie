# POD CLASH — Globe Homie

Static GitHub Pages website synchronized from the Google Sheets tab:

`7-Day Rolling Schedule`

## Files

- `index.html` — page structure and static Day 3 fallback
- `styles.css` — responsive desktop/mobile design
- `config.js` — spreadsheet, timing, clan links, and refresh configuration
- `fallback-data.js` — last-known schedule used if Google Sheets cannot be reached
- `app.js` — CSV synchronization, search, day filtering, member drawer/bottom sheet, refresh, and countdown
- `.nojekyll` — tells GitHub Pages to serve the files directly

## Google Sheets requirement

The spreadsheet/tab must be publicly readable. In Google Sheets on desktop:

1. Open the spreadsheet.
2. Select **File → Share → Publish to web**.
3. Select the `7-Day Rolling Schedule` tab.
4. Publish it.
5. Do not publish private or sensitive information.

The website reads this endpoint automatically:

`https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/gviz/tq?tqx=out:csv&sheet=SHEET_NAME`

If the live request fails, the page keeps showing `fallback-data.js` and reports **Using saved fallback**.

## Updating configuration

Edit `config.js` if the spreadsheet ID, tab name, clan links, or Day 3 ending time changes.

## Expected sheet headers

The parser searches for a row containing:

`Member Name | Town Hall | Day 1 | Day 2 | Day 3 | Day 4 | Day 5 | Day 6 | Day 7`

Rows after that header are read until `TOTAL ACTIVE...`.

Accepted status values:

- `IN`
- `OUT`
- `IN - N/A` (shown as IN / NO ATTACK)

## Local preview

For full JavaScript behavior, serve the folder over HTTP. Do not rely on iPhone Quick Look for testing.

Example:

```bash
python -m http.server 8000
```

Then open `http://localhost:8000`.
