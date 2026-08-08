(() => {
"use strict";
const C = window.PODCLASH_CONFIG;
const fallback = Array.isArray(window.PODCLASH_FALLBACK) ? window.PODCLASH_FALLBACK : [];
let members = fallback.map(m => ({...m}));
let selectedDay = 6;
let leaderFilter = "TOTAL";
let restingOpen = false;
let activeDay = 6;
let day1Start = new Date(C.fallbackDay1StartIso);
let scrollYBeforeModal = 0;
let refreshTimer = null;

const $ = id => document.getElementById(id);
const pad = n => String(n).padStart(2,"0");
const clamp = (n,a,b) => Math.min(b,Math.max(a,n));
const normalize = s => String(s ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/\s+/g," ").trim();
const normKey = s => normalize(s).replace(/[İIı]/g,"i");

function csvUrl(sheet){
  const params = new URLSearchParams({tqx:"out:csv",sheet,_:String(Date.now())});
  return `https://docs.google.com/spreadsheets/d/${encodeURIComponent(C.spreadsheetId)}/gviz/tq?${params}`;
}
function parseCsv(text){
  const rows=[]; let row=[],field="",quoted=false;
  for(let i=0;i<text.length;i++){
    const ch=text[i],next=text[i+1];
    if(quoted){
      if(ch === '"' && next === '"'){field+='"';i++;}
      else if(ch === '"') quoted=false;
      else field+=ch;
    }else{
      if(ch === '"') quoted=true;
      else if(ch === ","){row.push(field);field="";}
      else if(ch === "\n"){row.push(field.replace(/\r$/,""));rows.push(row);row=[];field="";}
      else field+=ch;
    }
  }
  if(field.length||row.length){row.push(field.replace(/\r$/,""));rows.push(row);}
  return rows;
}
function headerIndex(rows, required){
  return rows.findIndex(r => required.every(req => r.some(c => normalize(c) === normalize(req))));
}
function parseSchedule(rows){
  const hi=headerIndex(rows,["Member Name","Town Hall","Day 1"]);
  if(hi<0) throw new Error("Schedule header not found.");
  const h=rows[hi].map(normalize), ni=h.indexOf("member name"), ti=h.indexOf("town hall");
  const dc=Array.from({length:7},(_,i)=>h.indexOf(`day ${i+1}`));
  const out=[];
  for(const r of rows.slice(hi+1)){
    const name=String(r[ni]||"").trim(); if(!name) continue;
    if(normalize(name).includes("total active")) break;
    const th=Number(String(r[ti]||"").match(/\d+/)?.[0]); if(!th) continue;
    const days=dc.map(i=>normalizeStatus(r[i])); if(days.some(v=>!v)) continue;
    out.push({name,th,days});
  }
  return out;
}
function normalizeStatus(v){
  const s=normalize(v).replace(/[–—]/g,"-");
  if(s.includes("in")&&s.includes("n/a")) return "IN_NA";
  if(s==="in") return "IN";
  if(s==="out") return "OUT";
  return null;
}
function parseStars(rows){
  const hi=headerIndex(rows,["Member Name","Town Hall","D1 Stars"]);
  if(hi<0) throw new Error("Stars header not found.");
  const h=rows[hi].map(normalize), ni=h.indexOf("member name");
  const dc=Array.from({length:7},(_,i)=>h.indexOf(`d${i+1} stars`));
  const map=new Map();
  for(const r of rows.slice(hi+1)){
    const name=String(r[ni]||"").trim(); if(!name) continue;
    if(normalize(name).includes("total stars per day")) break;
    map.set(normKey(name),dc.map(i=>parseStarCell(r[i])));
  }
  return map;
}
function parseStarCell(v){
  const raw=String(v??"").trim();
  if(raw==="") return null;
  const n=Number(raw); if(Number.isFinite(n) && n>=0 && n<=3) return n;
  const s=normalize(raw).replace(/[–—]/g,"-");
  if(s.includes("in")&&s.includes("n/a")) return "IN_NA";
  if(s==="out") return "OUT";
  return null;
}
function parseDashboard(rows){
  const hi=headerIndex(rows,["Member Name","Avg Destruction %"]);
  if(hi<0) throw new Error("Dashboard header not found.");
  const h=rows[hi].map(normalize), ni=h.indexOf("member name"), ai=h.indexOf("avg destruction %");
  const map=new Map();
  let timing=null;
  for(const r of rows){
    const label=normalize(r[0]);
    if(label==="cwl day 1 start" || label==="day 1 start" || label==="cwl day1 start"){
      const value=String(r[1]||"").trim();
      const d=new Date(value);
      if(!Number.isNaN(d.getTime())) timing=d;
    }
  }
  for(const r of rows.slice(hi+1)){
    const name=String(r[ni]||"").trim(); if(!name) continue;
    const raw=String(r[ai]??"").replace("%","").trim();
    let avg=Number(raw);
    if(!Number.isFinite(avg)) avg=0;
    if(avg>0 && avg<=1) avg*=100;
    map.set(normKey(name),{avgDestruction:avg});
  }
  return {map,timing};
}
function mergeData(schedule,stars,dashboard){
  return schedule.map(m=>{
    const k=normKey(m.name), old=fallback.find(f=>normKey(f.name)===k)||{};
    return {
      ...m,
      stars: stars.get(k) || old.stars || [null,null,null,null,null,null,null],
      avgDestruction: dashboard.get(k)?.avgDestruction ?? old.avgDestruction ?? 0
    };
  });
}
function getTimeline(now=new Date()){
  const start=new Date(day1Start);
  const end=new Date(start.getTime()+7*86400000);
  if(now<start) return {current:1,before:true,after:false,start,end};
  if(now>=end) return {current:7,before:false,after:true,start,end};
  return {current:Math.floor((now-start)/86400000)+1,before:false,after:false,start,end};
}
function dayStart(day){return new Date(day1Start.getTime()+(day-1)*86400000)}
function dayEnd(day){return new Date(day1Start.getTime()+day*86400000)}
function phaseForDay(day,now=new Date()){
  if(now>=dayEnd(day)) return "ENDED";
  if(now>=dayStart(day)) return "ACTIVE";
  const t=getTimeline(now);
  if(!t.before && day===t.current+1) return "PREPARATION";
  return "UPCOMING";
}
function timeLeft(target,now=new Date()){
  const diff=Math.max(0,target-now), mins=Math.floor(diff/60000);
  return `${pad(Math.floor(mins/60))}H ${pad(mins%60)}M`;
}
function displayState(raw,day){
  const phase=phaseForDay(day);
  if(raw==="OUT") return phase==="ACTIVE"?"OUT · RESTING":"RESTING";
  if(raw==="IN_NA") return (phase==="ACTIVE"||phase==="ENDED")?"IN · NO ATTACK":"SCHEDULED · NO ATTACK";
  if(phase==="ACTIVE") return "ATTACK REQUIRED";
  if(phase==="ENDED") return "IN LINEUP";
  return "SCHEDULED";
}
function statusClass(raw){return raw==="OUT"?"out":raw==="IN_NA"?"na":"in"}
function formatTime(d=new Date()){
  return new Intl.DateTimeFormat("en-GB",{hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false,timeZone:C.timeZoneIana}).format(d);
}
function setSync(msg,error=false){$("syncMeta").textContent=msg;$("syncDot").classList.toggle("error",error)}

function scoreIsLive(day){
  const phase=phaseForDay(day);
  return phase==="ACTIVE" || phase==="ENDED";
}
function completedAttacks(m, uptoDay=7){
  let count=0;
  for(let i=0;i<uptoDay;i++){
    if(scoreIsLive(i+1) && m.days[i]==="IN" && typeof m.stars[i]==="number") count++;
  }
  return count;
}
function eligibleAttacks(m){return m.days.filter(v=>v==="IN").length}
function warsIn(m){return m.days.filter(v=>v==="IN"||v==="IN_NA").length}
function totalStars(m, uptoDay=7){
  return m.stars.slice(0,uptoDay).reduce((a,v,i)=>a+(scoreIsLive(i+1)&&typeof v==="number"?v:0),0);
}
function efficiency(m, uptoDay=7){
  const a=completedAttacks(m,uptoDay); return a?totalStars(m,uptoDay)/a:null;
}
function weightedClanDestruction(){
  let totalWeight=0,total=0;
  members.forEach(m=>{
    const a=completedAttacks(m);
    if(a>0 && Number.isFinite(Number(m.avgDestruction))){
      total += Number(m.avgDestruction)*a;
      totalWeight += a;
    }
  });
  return totalWeight ? total/totalWeight : 0;
}
function dailyStars(day){
  return members.reduce((sum,m)=>sum+(typeof m.stars[day-1]==="number"?m.stars[day-1]:0),0);
}
function starVisual(v){
  if(typeof v!=="number") return "—";
  const n=clamp(Math.round(v),0,3);
  return `${"★".repeat(n)}${"☆".repeat(3-n)}`;
}
function rankingComparator(a,b,uptoDay=7){
  const ea=efficiency(a,uptoDay), eb=efficiency(b,uptoDay);
  if(ea===null && eb!==null) return 1;
  if(ea!==null && eb===null) return -1;
  if(ea!==null && eb!==null && eb!==ea) return eb-ea;
  const da=Number(a.avgDestruction)||0, db=Number(b.avgDestruction)||0;
  if(db!==da) return db-da;
  const sa=totalStars(a,uptoDay), sb=totalStars(b,uptoDay);
  if(sb!==sa) return sb-sa;
  return completedAttacks(b,uptoDay)-completedAttacks(a,uptoDay);
}
function performanceList(filter="TOTAL"){
  if(filter==="TOTAL") return [...members].sort((a,b)=>rankingComparator(a,b,7));
  const day=Number(filter.slice(1));
  return members
    .filter(m=>m.days[day-1]==="IN")
    .sort((a,b)=>{
      if(!scoreIsLive(day)) return members.indexOf(a)-members.indexOf(b);
      const sa=typeof a.stars[day-1]==="number"?a.stars[day-1]:-1;
      const sb=typeof b.stars[day-1]==="number"?b.stars[day-1]:-1;
      if(sb!==sa) return sb-sa;
      const da=Number(a.avgDestruction)||0,db=Number(b.avgDestruction)||0;
      if(db!==da) return db-da;
      return a.name.localeCompare(b.name);
    });
}

function renderOverview(){
  const total=members.reduce((s,m)=>s+totalStars(m),0);
  const completed=members.reduce((s,m)=>s+completedAttacks(m),0);
  const eligible=members.reduce((s,m)=>s+eligibleAttacks(m),0);
  const destruction=weightedClanDestruction();
  $("overviewStars").textContent=`${total} / ${C.maxCwlStars}`;
  $("overviewAttacks").textContent=`${completed} / ${eligible}`;
  $("overviewDestruction").textContent=`${destruction.toFixed(1)} / 100%`;
  $("starsBar").style.width=`${clamp(total/C.maxCwlStars*100,0,100)}%`;
  $("attacksBar").style.width=`${eligible?clamp(completed/eligible*100,0,100):0}%`;
  $("destructionBar").style.width=`${clamp(destruction,0,100)}%`;
}
function updateTimeline(){
  const now=new Date(),t=getTimeline(now);
  activeDay=t.current;
  if(!Number.isInteger(selectedDay)||selectedDay<1||selectedDay>7) selectedDay=activeDay;
  if(t.before){
    $("currentDayTitle").textContent="Day 1";$("currentPhase").textContent="UPCOMING";$("currentPhase").className="chip upcoming mono";
    $("currentCountdownLabel").textContent="Starts in";$("currentCountdown").textContent=timeLeft(dayStart(1),now);
  }else if(t.after){
    $("currentDayTitle").textContent="CWL Complete";$("currentPhase").textContent="ENDED";$("currentPhase").className="chip ended mono";
    $("currentCountdownLabel").textContent="Status";$("currentCountdown").textContent="FINAL";
  }else{
    $("currentDayTitle").textContent=`Day ${activeDay}`;$("currentPhase").textContent="ACTIVE";$("currentPhase").className="chip active mono";
    $("currentCountdownLabel").textContent="Ends in";$("currentCountdown").textContent=timeLeft(dayEnd(activeDay),now);
  }
  if(!t.after && activeDay<7){
    $("nextWarKicker").textContent="Next war";$("nextDayTitle").textContent=`Day ${activeDay+1}`;$("nextPhase").textContent="PREPARATION";$("nextPhase").className="chip prep mono";
    $("nextCountdownLabel").textContent="Starts in";$("nextCountdown").textContent=timeLeft(dayStart(activeDay+1),now);
  }else if(!t.after && activeDay===7){
    $("nextWarKicker").textContent="CWL status";$("nextDayTitle").textContent="Final Day";$("nextPhase").textContent="ACTIVE";$("nextPhase").className="chip active mono";
    $("nextCountdownLabel").textContent="CWL ends in";$("nextCountdown").textContent=timeLeft(dayEnd(7),now);
  }else{
    $("nextWarKicker").textContent="CWL status";$("nextDayTitle").textContent="Completed";$("nextPhase").textContent="ENDED";$("nextPhase").className="chip ended mono";
    $("nextCountdownLabel").textContent="Final state";$("nextCountdown").textContent="7 / 7";
  }
  renderSummary();renderLineupPhase();
}
function renderSummary(){
  if(!members.length)return;
  const ci=activeDay-1, ni=Math.min(6,activeDay);
  const cur=members.map(m=>m.days[ci]), next=members.map(m=>m.days[ni]);
  const curLine=cur.filter(v=>v==="IN"||v==="IN_NA").length, curNA=cur.filter(v=>v==="IN_NA").length;
  $("currentIn").textContent=`${curLine} in lineup`;
  $("currentAttack").textContent=`${curLine-curNA} attack required`;
  $("currentNoAttack").textContent=`${curNA} no attack`;
  if(activeDay<7){
    const nextLine=next.filter(v=>v==="IN"||v==="IN_NA").length,nextNA=next.filter(v=>v==="IN_NA").length;
    $("nextIn").textContent=`${nextLine} scheduled`;$("nextAttack").textContent=`${nextLine-nextNA} eligible attacks`;
  }else{
    $("nextIn").textContent=`${curLine} final lineup`;$("nextAttack").textContent=`${curLine-curNA} eligible attacks`;
  }
}
function buildDayTabs(){
  const root=$("dayTabs");root.innerHTML="";
  for(let d=1;d<=7;d++){
    const b=document.createElement("button");b.className=`day-tab${d===selectedDay?" active":""}`;b.type="button";b.textContent=`D${d}`;
    b.addEventListener("click",()=>{selectedDay=d;restingOpen=false;buildDayTabs();renderLineup();});root.appendChild(b);
  }
}
function renderLineupPhase(){if($("lineupPhase"))$("lineupPhase").textContent=phaseForDay(selectedDay)}
function memberRow(m,n,raw){
  const row=document.createElement("div");row.className="member-row";row.tabIndex=0;row.setAttribute("role","button");
  row.innerHTML=`<div class="member-index mono">${pad(n)}</div><div class="member-name"></div><div class="member-th mono">TH${m.th}</div><div class="member-status ${statusClass(raw)} mono">${displayState(raw,selectedDay)}</div>`;
  row.querySelector(".member-name").textContent=m.name;
  const open=()=>openDetail(m);row.addEventListener("click",open);row.addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();open()}});
  return row;
}
function renderLineup(){
  if(!members.length)return;
  const i=selectedDay-1, active=members.filter(m=>m.days[i]==="IN"), na=members.filter(m=>m.days[i]==="IN_NA"), out=members.filter(m=>m.days[i]==="OUT");
  $("lineupTitle").textContent=`Day ${selectedDay} Lineup`;$("lineupPhase").textContent=phaseForDay(selectedDay);
  $("lineupCount").textContent=`${active.length+na.length} / 30`;
  $("inList").replaceChildren();$("naList").replaceChildren();$("outList").replaceChildren();
  let n=1;active.forEach(m=>$("inList").appendChild(memberRow(m,n++,"IN")));na.forEach(m=>$("naList").appendChild(memberRow(m,n++,"IN_NA")));
  out.forEach((m,j)=>$("outList").appendChild(memberRow(m,j+1,"OUT")));
  $("naGroup").style.display=na.length?"block":"none";$("restingCount").textContent=out.length;
  $("restingContent").style.display=restingOpen?"block":"none";$("restingToggle").querySelector("span").textContent=restingOpen?"Hide resting members":"Show resting members";
}
function renderDailyBars(){
  const root=$("dailyBars");root.innerHTML="";
  const vals=Array.from({length:7},(_,i)=>dailyStars(i+1)),max=Math.max(90,...vals);
  vals.forEach((v,i)=>{
    const phase=phaseForDay(i+1), shown=phase==="UPCOMING"?"—":`${v} ★`;
    const row=document.createElement("div");row.className="daily-row";
    row.innerHTML=`<div class="d mono">D${i+1}</div><div class="daily-track"><span style="width:${phase==="UPCOMING"?0:clamp(v/max*100,0,100)}%"></span></div><div class="daily-value mono">${shown}</div>`;
    root.appendChild(row);
  });
  $("dailyTotalStars").textContent=`${members.reduce((s,m)=>s+totalStars(m),0)} ★ total`;
}
function renderTopThree(){
  const root=$("topThree");root.innerHTML="";
  performanceList("TOTAL").slice(0,3).forEach((m,i)=>{
    const e=efficiency(m),a=completedAttacks(m),s=totalStars(m);
    const el=document.createElement("div");el.className="top-item";
    el.innerHTML=`<div class="top-rank mono">${pad(i+1)}</div><div><div class="top-name"></div><div class="top-sub mono">${e===null?"EFFICIENCY —":`${e.toFixed(2)} ★/ATK`} · ${a} ATK · ${(Number(m.avgDestruction)||0).toFixed(1)}%</div></div><div class="top-stars mono">${s} ★</div>`;
    el.querySelector(".top-name").textContent=m.name;root.appendChild(el);
  });
}
function buildLeaderTabs(){
  const root=$("leaderTabs");root.innerHTML="";
  ["TOTAL","D1","D2","D3","D4","D5","D6","D7"].forEach(v=>{
    const b=document.createElement("button");b.type="button";b.className=`leader-tab${v===leaderFilter?" active":""}`;b.textContent=v;
    b.addEventListener("click",()=>{leaderFilter=v;buildLeaderTabs();renderLeaderboard()});root.appendChild(b);
  });
}
function renderLeaderboard(){
  const root=$("leaderboard");root.innerHTML="";const list=performanceList(leaderFilter);
  list.forEach((m,i)=>{
    const totalMode=leaderFilter==="TOTAL", day=totalMode?7:Number(leaderFilter.slice(1));
    const dailyLive=totalMode?true:scoreIsLive(day);
    const stars=totalMode?totalStars(m):(dailyLive&&typeof m.stars[day-1]==="number"?m.stars[day-1]:null);
    const attacks=totalMode?completedAttacks(m):(dailyLive&&typeof m.stars[day-1]==="number"&&m.days[day-1]==="IN"?1:0);
    const eff=totalMode?efficiency(m):(attacks?stars:null);
    const row=document.createElement("div");row.className="leader-row";row.tabIndex=0;row.setAttribute("role","button");
    row.innerHTML=`<div class="mono leader-muted">${pad(i+1)}</div><div class="leader-name"></div><div class="mono leader-muted">TH${m.th}</div><div class="stars-visual" title="${stars??"Pending"}">${stars===null?(totalMode?"PENDING":phaseForDay(day)==="UPCOMING"||phaseForDay(day)==="PREPARATION"?"UPCOMING":"PENDING"):totalMode?`${stars} ★`:starVisual(stars)}</div><div class="mono">${attacks}</div><div class="mono">${eff===null?"—":eff.toFixed(2)}</div><div class="mono">${(Number(m.avgDestruction)||0).toFixed(1)}%</div>`;
    row.querySelector(".leader-name").textContent=m.name;row.addEventListener("click",()=>openDetail(m));row.addEventListener("keydown",e=>{if(e.key==="Enter"){openDetail(m)}});
    root.appendChild(row);
  });
}
function renderSearch(q=""){
  const root=$("searchResults"),term=normKey(q);root.innerHTML="";
  if(!term){root.style.display="none";return}
  const matches=members.filter(m=>normKey(m.name).includes(term)).slice(0,12);root.style.display="block";
  if(!matches.length){root.innerHTML='<div class="result"><span>No member found</span></div>';return}
  matches.forEach(m=>{
    const b=document.createElement("button");b.className="result";b.type="button";
    b.innerHTML=`<span></span><small class="mono">TH${m.th} · ${totalStars(m)} ★</small>`;b.querySelector("span").textContent=m.name;
    b.addEventListener("click",()=>{$("searchInput").blur();openDetail(m)});root.appendChild(b);
  });
}
function memberDayDisplay(m,day){
  const raw=m.days[day-1],phase=phaseForDay(day),star=m.stars[day-1];
  if(phase==="UPCOMING") return {state:"UPCOMING",perf:"—"};
  if(raw==="OUT") return {state:"OUT",perf:"—"};
  if(raw==="IN_NA") return {state:"IN · NO ATTACK",perf:"—"};
  if(typeof star==="number") return {state:"IN",perf:starVisual(star)};
  return {state:"IN",perf:"PENDING"};
}
function openDetail(m){
  scrollYBeforeModal=window.scrollY;document.body.classList.add("modal-open");document.body.style.top=`-${scrollYBeforeModal}px`;
  $("detailName").textContent=m.name;$("detailMeta").textContent=`TH${m.th}`;
  const current=memberDayDisplay(m,activeDay),e=efficiency(m);
  let html=`<div class="detail-section-title mono">Current</div><div class="current-box"><div class="label mono">DAY ${activeDay}</div><strong>${displayState(m.days[activeDay-1],activeDay)}</strong></div>`;
  html+=`<div class="detail-section-title mono">Performance</div><div class="perf-stats">
  <div class="perf-stat"><span>Total Stars</span><b>${totalStars(m)} ★</b></div>
  <div class="perf-stat"><span>Wars IN</span><b>${warsIn(m)}</b></div>
  <div class="perf-stat"><span>Wars Attack</span><b>${eligibleAttacks(m)}</b></div>
  <div class="perf-stat"><span>Efficiency</span><b>${e===null?"—":`${e.toFixed(2)} ★/ATK`}</b></div>
  <div class="perf-stat"><span>Avg Destruction</span><b>${(Number(m.avgDestruction)||0).toFixed(1)}%</b></div></div>`;
  html+=`<div class="detail-section-title mono">7-Day Schedule</div><div class="schedule-list">`;
  for(let d=1;d<=7;d++){const info=memberDayDisplay(m,d);html+=`<div class="schedule-item"><div class="mono">D${d}</div><div class="phase mono">${info.state}</div><div class="state">${info.perf}</div></div>`}
  html+="</div>";$("detailBody").innerHTML=html;
  $("backdrop").classList.add("open");$("detail").classList.add("open");$("detail").setAttribute("aria-hidden","false");
  setTimeout(()=>$("closeDetail").focus(),10);
}
function closeDetail(){
  $("backdrop").classList.remove("open");$("detail").classList.remove("open");$("detail").setAttribute("aria-hidden","true");
  document.body.classList.remove("modal-open");document.body.style.top="";window.scrollTo(0,scrollYBeforeModal);
}
function renderAll(){
  renderOverview();updateTimeline();buildDayTabs();renderLineup();renderDailyBars();renderTopThree();buildLeaderTabs();renderLeaderboard();renderSearch($("searchInput").value);
}
async function loadAll({manual=false}={}){
  const btn=$("refreshBtn");if(btn.disabled)return;btn.disabled=true;btn.textContent=manual?"Refreshing…":"Loading…";setSync("Connecting to Google Sheets…");
  try{
    const [sr,tr,dr]=await Promise.all([
      fetch(csvUrl(C.sheets.schedule),{cache:"no-store"}),
      fetch(csvUrl(C.sheets.stars),{cache:"no-store"}),
      fetch(csvUrl(C.sheets.dashboard),{cache:"no-store"})
    ]);
    if(!sr.ok||!tr.ok||!dr.ok) throw new Error("One or more Google Sheets tabs could not be loaded.");
    const [st,tt,dt]=await Promise.all([sr.text(),tr.text(),dr.text()]);
    const schedule=parseSchedule(parseCsv(st)),stars=parseStars(parseCsv(tt)),dash=parseDashboard(parseCsv(dt));
    if(dash.timing) day1Start=dash.timing;
    members=mergeData(schedule,stars,dash.map);
    renderAll();setSync(`3 sheets synced · ${formatTime()} GMT+7`);btn.textContent="Data Updated";
  }catch(err){
    console.error(err);members=fallback.map(m=>({...m}));renderAll();setSync(`Using saved fallback · ${formatTime()} GMT+7`,true);btn.textContent="Refresh Failed";
  }finally{
    setTimeout(()=>{btn.disabled=false;btn.textContent="Refresh Data"},manual?900:300);
  }
}
function init(){
  $("clanLink").href=C.clanUrl;$("discordLink").href=C.discordUrl;
  const t=getTimeline();selectedDay=t.current;activeDay=t.current;
  $("searchInput").addEventListener("input",e=>renderSearch(e.target.value));
  $("restingToggle").addEventListener("click",()=>{restingOpen=!restingOpen;renderLineup()});
  $("refreshBtn").addEventListener("click",()=>loadAll({manual:true}));
  $("backdrop").addEventListener("click",closeDetail);$("closeDetail").addEventListener("click",closeDetail);
  document.addEventListener("keydown",e=>{if(e.key==="Escape")closeDetail()});
  renderAll();loadAll();
  setInterval(()=>{updateTimeline();renderDailyBars()},30000);
  refreshTimer=setInterval(()=>loadAll(),C.refreshIntervalMs);
}
document.addEventListener("DOMContentLoaded",init);
})();