
(() => {
  "use strict";
  const C = window.PODCLASH_CONFIG;
  const fallback = Array.isArray(window.PODCLASH_FALLBACK) ? window.PODCLASH_FALLBACK : [];
  let members = fallback;
  let selectedDay = 3;
  let restingOpen = false;
  let previousFocus = null;
  let scrollYBeforeModal = 0;
  let activeDay = 3;
  let refreshTimer = null;

  const $ = (id) => document.getElementById(id);
  const normalize = (s) => String(s || "").normalize("NFKD").toLowerCase().replace(/\s+/g, " ").trim();
  const pad = (n) => String(n).padStart(2, "0");

  function sheetCsvUrl() {
    const base = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(C.spreadsheetId)}/gviz/tq`;
    const params = new URLSearchParams({
      tqx: "out:csv",
      sheet: C.sheetName,
      _: String(Date.now())
    });
    return `${base}?${params}`;
  }

  function parseCsv(text) {
    const rows = [];
    let row = [], field = "", quoted = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i], next = text[i + 1];
      if (quoted) {
        if (ch === '"' && next === '"') { field += '"'; i++; }
        else if (ch === '"') quoted = false;
        else field += ch;
      } else {
        if (ch === '"') quoted = true;
        else if (ch === ",") { row.push(field); field = ""; }
        else if (ch === "\n") { row.push(field.replace(/\r$/, "")); rows.push(row); row = []; field = ""; }
        else field += ch;
      }
    }
    if (field.length || row.length) { row.push(field.replace(/\r$/, "")); rows.push(row); }
    return rows;
  }

  function normalizeStatus(value) {
    const s = normalize(value).replace(/[–—]/g, "-");
    if (s.includes("n/a") && s.includes("in")) return "IN_NA";
    if (s === "in" || s.startsWith("in ")) return "IN";
    if (s === "out" || s.startsWith("out ")) return "OUT";
    return null;
  }

  function rowsToMembers(rows) {
    const headerIndex = rows.findIndex(r => r.some(c => normalize(c) === "member name") && r.some(c => normalize(c) === "town hall"));
    if (headerIndex < 0) throw new Error("Header row not found. Expected Member Name and Town Hall.");
    const header = rows[headerIndex].map(normalize);
    const nameCol = header.indexOf("member name");
    const thCol = header.indexOf("town hall");
    const dayCols = Array.from({length:7}, (_,i) => header.indexOf(`day ${i+1}`));
    if (nameCol < 0 || thCol < 0 || dayCols.some(i => i < 0)) throw new Error("Required schedule columns are missing.");

    const parsed = [];
    for (const row of rows.slice(headerIndex + 1)) {
      const name = String(row[nameCol] || "").trim();
      if (!name) continue;
      if (normalize(name).includes("total active")) break;
      const thMatch = String(row[thCol] || "").match(/\d+/);
      const days = dayCols.map(i => normalizeStatus(row[i]));
      if (!thMatch || days.some(v => !v)) continue;
      parsed.push({ name, th: Number(thMatch[0]), days });
    }
    if (!parsed.length) throw new Error("No member schedule rows were found.");
    return parsed;
  }

  function getTimeline(now = new Date()) {
    const day3End = new Date(C.day3EndIso);
    const dayEnd = (day) => new Date(day3End.getTime() + (day - 3) * 86400000);
    let current = null;
    for (let d = 1; d <= 7; d++) {
      const end = dayEnd(d);
      const start = new Date(end.getTime() - 86400000);
      if (now >= start && now < end) { current = d; break; }
    }
    if (current === null) current = now < new Date(dayEnd(1).getTime() - 86400000) ? 1 : 7;
    return { current, dayEnd };
  }

  function phaseForDay(day) {
    const now = new Date(), {current, dayEnd} = getTimeline(now);
    const end = dayEnd(day), start = new Date(end.getTime() - 86400000);
    if (now >= end) return "ENDED";
    if (now >= start && now < end) return "ACTIVE";
    if (day === current + 1) return "PREPARATION";
    return "UPCOMING";
  }

  function displayState(raw, day) {
    const phase = phaseForDay(day);
    if (raw === "OUT") return phase === "ACTIVE" ? "OUT · RESTING" : "RESTING";
    if (raw === "IN_NA") return (phase === "ENDED" || phase === "ACTIVE") ? "IN · NO ATTACK" : "SCHEDULED · NO ATTACK";
    if (phase === "ACTIVE") return "ATTACK REQUIRED";
    if (phase === "ENDED") return "IN LINEUP";
    return "SCHEDULED";
  }

  function statusClass(raw) { return raw === "OUT" ? "out" : raw === "IN_NA" ? "na" : "in"; }

  function setSync(message, error = false) {
    $("syncMeta").textContent = message;
    $("syncDot").classList.toggle("error", error);
  }

  function formatJakartaTime(date = new Date()) {
    return new Intl.DateTimeFormat("en-GB", {
      hour:"2-digit", minute:"2-digit", second:"2-digit", hour12:false, timeZone:C.timeZoneIana
    }).format(date);
  }

  async function loadSheet({manual = false} = {}) {
    const btn = $("refreshBtn");
    if (btn.disabled) return;
    btn.disabled = true;
    btn.textContent = manual ? "Refreshing…" : "Loading…";
    setSync("Connecting to Google Sheets…");
    try {
      const response = await fetch(sheetCsvUrl(), {cache:"no-store"});
      if (!response.ok) throw new Error(`Google Sheets returned HTTP ${response.status}.`);
      const text = await response.text();
      const parsed = rowsToMembers(parseCsv(text));
      members = parsed;
      renderAll();
      setSync(`Schedule synced · ${formatJakartaTime()} GMT+7`);
      btn.textContent = "Schedule Updated";
    } catch (error) {
      console.error(error);
      members = members.length ? members : fallback;
      renderAll();
      setSync(`Using saved fallback · ${formatJakartaTime()} GMT+7`, true);
      btn.textContent = "Refresh Failed";
    } finally {
      window.setTimeout(() => {
        btn.disabled = false;
        btn.textContent = "Refresh Schedule";
      }, manual ? 900 : 250);
    }
  }

  function updateTimeline() {
    const now = new Date(), timeline = getTimeline(now);
    activeDay = timeline.current;
    if (!Number.isInteger(selectedDay) || selectedDay < 1 || selectedDay > 7) selectedDay = activeDay;

    const currentEnd = timeline.dayEnd(activeDay);
    const diff = Math.max(0, currentEnd.getTime() - now.getTime());
    const totalMin = Math.floor(diff / 60000);
    const countText = `${pad(Math.floor(totalMin / 60))}H ${pad(totalMin % 60)}M`;

    $("currentDayTitle").textContent = `Day ${activeDay}`;
    $("currentPhase").textContent = phaseForDay(activeDay);
    $("currentPhase").className = `chip ${phaseForDay(activeDay).toLowerCase()} mono`;
    $("currentCountdownLabel").textContent = phaseForDay(activeDay) === "ACTIVE" ? "Ends in" : "Status";
    $("currentCountdown").textContent = phaseForDay(activeDay) === "ACTIVE" ? countText : phaseForDay(activeDay);

    const nextDay = Math.min(7, activeDay + 1);
    $("nextDayTitle").textContent = `Day ${nextDay}`;
    $("nextPhase").textContent = phaseForDay(nextDay);
    $("nextPhase").className = `chip ${phaseForDay(nextDay).toLowerCase() === "preparation" ? "prep" : phaseForDay(nextDay).toLowerCase()} mono`;
    $("nextCountdownLabel").textContent = nextDay > activeDay ? "Starts in" : "Status";
    $("nextCountdown").textContent = nextDay > activeDay ? countText : phaseForDay(nextDay);
    renderSummary();
  }

  function renderSummary() {
    if (!members.length) return;
    const currentIdx = activeDay - 1, nextIdx = Math.min(6, activeDay);
    const cur = members.map(m => m.days[currentIdx]);
    const next = members.map(m => m.days[nextIdx]);
    const curIn = cur.filter(v => v === "IN" || v === "IN_NA").length;
    const curNA = cur.filter(v => v === "IN_NA").length;
    const nextIn = next.filter(v => v === "IN" || v === "IN_NA").length;
    $("currentIn").textContent = `${curIn} in lineup`;
    $("currentAttack").textContent = `${curIn - curNA} attack required`;
    $("currentNoAttack").textContent = `${curNA} no attack`;
    $("nextIn").textContent = `${nextIn} scheduled`;
  }

  function buildTabs() {
    const root = $("dayTabs");
    root.innerHTML = "";
    for (let day = 1; day <= 7; day++) {
      const b = document.createElement("button");
      b.className = `day-tab mono${day === selectedDay ? " active" : ""}`;
      b.textContent = `D${day}`; b.type = "button";
      b.addEventListener("click", () => {
        selectedDay = day; restingOpen = false; renderLineup(); buildTabs();
      });
      root.appendChild(b);
    }
  }

  function memberRow(member, displayIndex, raw) {
    const row = document.createElement("div");
    row.className = "member-row"; row.tabIndex = 0; row.setAttribute("role","button");
    row.setAttribute("aria-label", `Open schedule for ${member.name}`);
    row.innerHTML = `<div class="member-index mono">${pad(displayIndex)}</div><div class="member-name"></div><div class="member-th mono">TH${member.th}</div><div class="member-status ${statusClass(raw)} mono">${displayState(raw, selectedDay)}</div>`;
    row.querySelector(".member-name").textContent = member.name;
    const open = () => openDetail(member);
    row.addEventListener("click", open);
    row.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); }});
    return row;
  }

  function renderLineup() {
    if (!members.length) return;
    const idx = selectedDay - 1;
    const active = members.filter(m => m.days[idx] === "IN");
    const noAttack = members.filter(m => m.days[idx] === "IN_NA");
    const resting = members.filter(m => m.days[idx] === "OUT");
    $("lineupTitle").textContent = `Day ${selectedDay} Lineup`;
    $("lineupCount").textContent = `${active.length + noAttack.length} / 30`;
    $("inList").replaceChildren();
    $("naList").replaceChildren();
    $("outList").replaceChildren();
    let n = 1;
    active.forEach(m => $("inList").appendChild(memberRow(m, n++, "IN")));
    noAttack.forEach(m => $("naList").appendChild(memberRow(m, n++, "IN_NA")));
    resting.forEach((m,i) => $("outList").appendChild(memberRow(m, i+1, "OUT")));
    $("naGroup").style.display = noAttack.length ? "block" : "none";
    $("restCount").textContent = resting.length;
    $("outList").style.display = restingOpen ? "block" : "none";
    $("restBtn").firstElementChild.textContent = restingOpen ? "Hide resting members" : "Show resting members";
  }

  function renderSearchResults() {
    const q = $("searchInput").value, box = $("searchResults");
    if (!q.trim()) { box.style.display = "none"; box.replaceChildren(); return; }
    const found = members.filter(m => normalize(m.name).includes(normalize(q))).slice(0,12);
    box.replaceChildren(); box.style.display = "block";
    if (!found.length) {
      const div = document.createElement("div"); div.style.cssText = "padding:14px;color:var(--muted)"; div.textContent = "No member found."; box.appendChild(div); return;
    }
    found.forEach(m => {
      const b = document.createElement("button"); b.className = "result"; b.type = "button";
      const name = document.createElement("span"); name.textContent = m.name;
      const meta = document.createElement("small"); meta.className = "mono"; meta.textContent = `TH${m.th} · ${m.days.filter(v => v !== "OUT").length} IN`;
      b.append(name, meta);
      b.addEventListener("click", () => { $("searchInput").blur(); box.style.display = "none"; openDetail(m); });
      box.appendChild(b);
    });
  }

  function lockBody() {
    scrollYBeforeModal = window.scrollY;
    document.body.style.position = "fixed"; document.body.style.top = `-${scrollYBeforeModal}px`;
    document.body.style.left = "0"; document.body.style.right = "0"; document.body.style.width = "100%";
  }
  function unlockBody() {
    document.body.style.position = ""; document.body.style.top = ""; document.body.style.left = ""; document.body.style.right = ""; document.body.style.width = "";
    window.scrollTo(0, scrollYBeforeModal);
  }
  function openDetail(member) {
    const detail = $("detail"), alreadyOpen = detail.classList.contains("open");
    previousFocus = document.activeElement;
    $("detailName").textContent = member.name;
    $("detailMeta").textContent = `TH${member.th} · ${member.days.filter(v => v !== "OUT").length} OF 7 DAYS IN`;
    $("detailCurrent").textContent = `DAY ${activeDay} · ${displayState(member.days[activeDay-1], activeDay)}`;
    $("detailSchedule").innerHTML = member.days.map((raw,i) => {
      const d=i+1; return `<div class="schedule-item"><div class="mono">DAY ${d}</div><div class="phase mono">${phaseForDay(d)}</div><div class="state">${displayState(raw,d)}</div></div>`;
    }).join("");
    if (!alreadyOpen) lockBody();
    detail.classList.add("open"); $("backdrop").classList.add("open"); detail.setAttribute("aria-hidden","false");
    requestAnimationFrame(() => $("closeDetail").focus());
  }
  function closeDetail() {
    if (!$("detail").classList.contains("open")) return;
    $("detail").classList.remove("open"); $("backdrop").classList.remove("open"); $("detail").setAttribute("aria-hidden","true");
    unlockBody();
    if (previousFocus && typeof previousFocus.focus === "function") setTimeout(() => previousFocus.focus(),0);
  }

  function renderAll() { updateTimeline(); buildTabs(); renderLineup(); }

  function init() {
    $("clanLink").href = C.clanUrl; $("clanLink").target = "_blank"; $("clanLink").rel = "noopener";
    $("discordLink").href = C.discordUrl; $("discordLink").target = "_blank"; $("discordLink").rel = "noopener";
    selectedDay = getTimeline(new Date()).current;
    $("searchInput").addEventListener("input", renderSearchResults);
    $("restBtn").addEventListener("click", () => { restingOpen = !restingOpen; renderLineup(); });
    $("refreshBtn").addEventListener("click", () => loadSheet({manual:true}));
    $("closeDetail").addEventListener("click", closeDetail);
    $("backdrop").addEventListener("click", closeDetail);
    document.addEventListener("keydown", e => { if (e.key === "Escape") closeDetail(); });
    renderAll();
    loadSheet();
    window.setInterval(updateTimeline, 60000);
    refreshTimer = window.setInterval(() => loadSheet(), C.refreshIntervalMs);
  }
  document.addEventListener("DOMContentLoaded", init, {once:true});
})();
