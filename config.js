window.PODCLASH_CONFIG = Object.freeze({
  spreadsheetId: "1DHmRKP527wxSj7KLUPKFF-P7kFMpl9W6cChnou0VPv8",
  sheets: {
    dashboard: "CWL Dashboard",
    schedule: "7-Day Rolling Schedule",
    stars: "Total Stars"
  },
  refreshIntervalMs: 60000,

  // Fallback timing for this CWL.
  // User-confirmed: Day 6 ends 8 Aug 2026 at 19:58 GMT+7.
  // Therefore Day 1 starts 2 Aug 2026 at 19:58 GMT+7.
  // If the Dashboard later contains a row labelled "CWL DAY 1 START",
  // the live spreadsheet value will override this fallback automatically.
  fallbackDay1StartIso: "2026-08-02T19:59:00+07:00",

  clanName: "Globe Homie",
  clanTag: "#2U80PYQG8",
  league: "Gold League I",
  warSize: "30v30",
  timeZoneLabel: "GMT+7",
  timeZoneIana: "Asia/Jakarta",
  founded: "16 July 2026",
  maxCwlStars: 630,

  clanUrl: "https://link.clashofclans.com/en?action=OpenClanProfile&tag=2U80PYQG8",
  discordUrl: "https://discord.gg/TZcz3mmTg"
});
