(() => {
"use strict";

const C = window.PODCLASH_CONFIG;

let members = [];
let selectedDay = 6;
let leaderFilter = "TOTAL";
let restingOpen = false;
let activeDay = 6;
let day1Start = new Date(C.fallbackDay1StartIso);
let scrollYBeforeModal = 0;

const $ = id => document.getElementById(id);
const pad = n => String(n).padStart(2,"0");
const clamp = (n,a,b) => Math.min(b,Math.max(a,n));

const normalize = s => String(s ?? "")
  .normalize("NFKD")
  .replace(/[\u0300-\u036f]/g,"")
  .toLowerCase()
  .replace(/\s+/g," ")
  .trim();

const normKey = s => normalize(s).replace(/[İIı]/g,"i");

function csvUrl(sheet){
  const params = new URLSearchParams({
    tqx: "out:csv",
    sheet,
    _: String(Date.now())
  });
  return `https://docs.google.com/spreadsheets/d/${encodeURIComponent(C.spreadsheetId)}/gviz/tq?${params}`;
}

function parseCsv(text){
  const rows=[];
  let row=[], field="", quoted=false;

  for(let i=0;i<text.length;i++){
    const ch=text[i], next=text[i+1];

    if(quoted){
      if(ch === '"' && next === '"'){
        field += '"';
        i++;
      }else if(ch === '"'){
        quoted=false;
      }else{
        field+=ch;
      }
    }else{
      if(ch === '"'){
        quoted=true;
      }else if(ch === ","){
        row.push(field);
        field="";
      }else if(ch === "\n"){
        row.push(field.replace(/\r$/,""));
        rows.push(row);
        row=[];
        field="";
      }else{
        field+=ch;
      }
    }
  }

  if(field.length || row.length){
    row.push(field.replace(/\r$/,""));
    rows.push(row);
  }

  return rows;
}

function headerIndex(rows, required){
  return rows.findIndex(r =>
    required.every(req =>
      r.some(c => normalize(c) === normalize(req))
    )
  );
}

function normalizeStatus(v){
  const s=normalize(v).replace(/[–—]/g,"-");

  if(s.includes("in") && s.includes("n/a")) return "IN_NA";
  if(s==="in") return "IN";
  if(s==="out") return "OUT";

  return null;
}

function parseSchedule(rows){
  const hi=headerIndex(rows,["Member Name","Town Hall","Day 1"]);
  if(hi<0) throw new Error("Schedule header not found.");

  const h=rows[hi].map(normalize);
  const ni=h.indexOf("member name");
  const ti=h.indexOf("town hall");
  const dayCols=Array.from({length:7},(_,i)=>h.indexOf(`day ${i+1}`));

  const out=[];

  for(const r of rows.slice(hi+1)){
    const name=String(r[ni]||"").trim();
    if(!name) continue;

    if(normalize(name).includes("total active")) break;

    const th=Number(String(r[ti]||"").match(/\d+/)?.[0]);
    if(!th) continue;

    const days=dayCols.map(i=>normalizeStatus(r[i]));

    // Only accept actual member rows with all seven schedule cells recognizable.
    if(days.some(v=>!v)) continue;

    out.push({name,th,days});
  }

  return out;
}

function parseStarCell(v){
  const raw=String(v??"").trim();

  if(raw==="") return null;

  const n=Number(raw);
  if(Number.isFinite(n) && n>=0 && n<=3){
    // 0 is a completed attack with zero stars.
    return n;
  }

  const s=normalize(raw).replace(/[–—]/g,"-");

  if(s.includes("in") && s.includes("n/a")) return "IN_NA";
  if(s==="out") return "OUT";
  if(s==="in") return "IN"; // pending / not attacked yet

  return null;
}

function parseStars(rows){
  const hi=headerIndex(rows,["Member Name","Town Hall","D1 Stars"]);
  if(hi<0) throw new Error("Total Stars header not found.");

  const h=rows[hi].map(normalize);
  const ni=h.indexOf("member name");
  const dayCols=Array.from({length:7},(_,i)=>h.indexOf(`d${i+1} stars`));

  // The sheet currently labels this "Avg Destruction %", but its values
  // are cumulative CoC destruction points such as 500, 496, 463, etc.
  let destructionCol=h.indexOf("total destruction");
  if(destructionCol<0) destructionCol=h.indexOf("total destruction %");
  if(destructionCol<0) destructionCol=h.indexOf("avg destruction %");

  const map=new Map();

  for(const r of rows.slice(hi+1)){
    const name=String(r[ni]||"").trim();
    if(!name) continue;

    if(normalize(name).includes("total stars per day")) break;

    const stars=dayCols.map(i=>parseStarCell(r[i]));

    let totalDestruction=0;
    if(destructionCol>=0){
      const raw=String(r[destructionCol]??"")
        .replace(/%/g,"")
        .replace(/,/g,"")
        .trim();

      const n=Number(raw);
      if(Number.isFinite(n)) totalDestruction=n;
    }

    map.set(normKey(name),{
      stars,
      totalDestruction
    });
  }

  return map;
}

function parseDashboardTiming(rows){
  for(const r of rows){
    const label=normalize(r[0]);

    if(
      label==="cwl day 1 start" ||
      label==="day 1 start" ||
      label==="cwl day1 start"
    ){
      const value=String(r[1]||"").trim();
      const d=new Date(value);

      if(!Number.isNaN(d.getTime())){
        return d;
      }
    }
  }

  return null;
}

function mergeData(schedule,starMap){
  return schedule.map(m=>{
    const starData=starMap.get(normKey(m.name));

    return {
      ...m,
      stars: starData?.stars || [null,null,null,null,null,null,null],
      totalDestruction: starData?.totalDestruction || 0
    };
  });
}

/* -------------------- CWL TIME -------------------- */

function getTimeline(now=new Date()){
  const start=new Date(day1Start);
  const end=new Date(start.getTime()+7*86400000);

  if(now<start){
    return {current:1,before:true,after:false,start,end};
  }

  if(now>=end){
    return {current:7,before:false,after:true,start,end};
  }

  return {
    current:Math.floor((now-start)/86400000)+1,
    before:false,
    after:false,
    start,
    end
  };
}

function dayStart(day){
  return new Date(day1Start.getTime()+(day-1)*86400000);
}

function dayEnd(day){
  return new Date(day1Start.getTime()+day*86400000);
}

function phaseForDay(day,now=new Date()){
  if(now>=dayEnd(day)) return "ENDED";
  if(now>=dayStart(day)) return "ACTIVE";

  const t=getTimeline(now);

  if(!t.before && day===t.current+1) return "PREPARATION";

  return "UPCOMING";
}

function timeLeft(target,now=new Date()){
  const diff=Math.max(0,target-now);
  const totalSeconds=Math.floor(diff/1000);

  const hours=Math.floor(totalSeconds/3600);
  const minutes=Math.floor((totalSeconds%3600)/60);
  const seconds=totalSeconds%60;

  return `${pad(hours)}H ${pad(minutes)}M ${pad(seconds)}S`;
}

function formatTime(d=new Date()){
  return new Intl.DateTimeFormat("en-GB",{
    hour:"2-digit",
    minute:"2-digit",
    second:"2-digit",
    hour12:false,
    timeZone:C.timeZoneIana
  }).format(d);
}

/* -------------------- MEMBER DATA -------------------- */

function completedAttacks(m,uptoDay=7){
  let count=0;

  for(let i=0;i<uptoDay;i++){
    if(m.days[i]==="IN" && typeof m.stars[i]==="number"){
      count++;
    }
  }

  return count;
}

function eligibleAttacks(m){
  return m.days.filter(v=>v==="IN").length;
}

function warsIn(m){
  return m.days.filter(v=>v==="IN" || v==="IN_NA").length;
}

function totalStars(m,uptoDay=7){
  return m.stars
    .slice(0,uptoDay)
    .reduce((sum,v)=>sum+(typeof v==="number"?v:0),0);
}

function efficiency(m,uptoDay=7){
  const attacks=completedAttacks(m,uptoDay);
  return attacks ? totalStars(m,uptoDay)/attacks : null;
}

function playerAvgDestruction(m){
  const attacks=completedAttacks(m);

  if(!attacks) return null;

  return (Number(m.totalDestruction)||0)/attacks;
}

function totalClanDestruction(){
  return members.reduce(
    (sum,m)=>sum+(Number(m.totalDestruction)||0),
    0
  );
}

function dailyStars(day){
  return members.reduce(
    (sum,m)=>sum+(typeof m.stars[day-1]==="number"?m.stars[day-1]:0),
    0
  );
}

function starVisual(v){
  if(typeof v!=="number") return "—";

  const n=clamp(Math.round(v),0,3);

  return `${"★".repeat(n)}${"☆".repeat(3-n)}`;
}

/* -------------------- STATUS DISPLAY -------------------- */

function memberDayDisplay(m,day){
  const raw=m.days[day-1];
  const phase=phaseForDay(day);
  const star=m.stars[day-1];

  if(raw==="OUT"){
    return {state:"REST",perf:"—"};
  }

  if(raw==="IN_NA"){
    return {state:"NO ATTACK",perf:"—"};
  }

  if(phase==="UPCOMING" || phase==="PREPARATION"){
    return {state:"UPCOMING",perf:"—"};
  }

  // Numeric 0/1/2/3 means attack result has actually been entered.
  if(typeof star==="number"){
    return {state:"IN",perf:starVisual(star)};
  }

  // IN or blank in the Total Stars sheet = not attacked / not entered yet.
  if(raw==="IN" && phase==="ACTIVE"){
    return {state:"ATTACK REQUIRED",perf:"PENDING"};
  }

  if(raw==="IN" && phase==="ENDED"){
    return {state:"IN",perf:"NO DATA"};
  }

  return {state:"IN",perf:"PENDING"};
}

function lineupStatus(m,day){
  const raw=m.days[day-1];
  const phase=phaseForDay(day);
  const star=m.stars[day-1];

  if(raw==="OUT") return "REST";
  if(raw==="IN_NA") return "NO ATTACK";

  if(phase==="ACTIVE"){
    if(typeof star==="number") return "ATTACK RECORDED";
    return "ATTACK REQUIRED";
  }

  if(phase==="ENDED") return "IN LINEUP";

  return "SCHEDULED";
}

function statusClass(raw){
  return raw==="OUT"?"out":raw==="IN_NA"?"na":"in";
}

/* -------------------- RANKING -------------------- */

function rankingComparator(a,b,uptoDay=7){
  const ea=efficiency(a,uptoDay);
  const eb=efficiency(b,uptoDay);

  if(ea===null && eb!==null) return 1;
  if(ea!==null && eb===null) return -1;
  if(ea!==null && eb!==null && eb!==ea) return eb-ea;

  const aa=completedAttacks(a,uptoDay);
  const ab=completedAttacks(b,uptoDay);

  const da=aa ? (Number(a.totalDestruction)||0)/aa : null;
  const db=ab ? (Number(b.totalDestruction)||0)/ab : null;

  if(da===null && db!==null) return 1;
  if(da!==null && db===null) return -1;
  if(da!==null && db!==null && db!==da) return db-da;

  const sa=totalStars(a,uptoDay);
  const sb=totalStars(b,uptoDay);

  if(sb!==sa) return sb-sa;

  return ab-aa;
}

function performanceList(filter="TOTAL"){
  if(filter==="TOTAL"){
    return [...members].sort((a,b)=>rankingComparator(a,b,7));
  }

  const day=Number(filter.slice(1));

  return members
    .filter(m=>m.days[day-1]==="IN")
    .sort((a,b)=>{
      const sa=typeof a.stars[day-1]==="number"?a.stars[day-1]:-1;
      const sb=typeof b.stars[day-1]==="number"?b.stars[day-1]:-1;

      if(sb!==sa) return sb-sa;

      const da=playerAvgDestruction(a)??0;
      const db=playerAvgDestruction(b)??0;

      if(db!==da) return db-da;

      return a.name.localeCompare(b.name);
    });
}

/* -------------------- RENDER -------------------- */

function setSync(msg,error=false){
  $("syncMeta").textContent=msg;
  $("syncDot").classList.toggle("error",error);
}

function renderOverview(){
  const stars=members.reduce((sum,m)=>sum+totalStars(m),0);
  const completed=members.reduce((sum,m)=>sum+completedAttacks(m),0);
  const eligible=members.reduce((sum,m)=>sum+eligibleAttacks(m),0);

  const destruction=totalClanDestruction();
  const maxDestruction=C.maxCwlDestruction || 21000;

  $("overviewStars").textContent=`${stars} / ${C.maxCwlStars}`;
  $("overviewAttacks").textContent=`${completed} / ${eligible}`;
  $("overviewDestruction").textContent=
    `${Math.round(destruction).toLocaleString("en-US")} / ${maxDestruction.toLocaleString("en-US")}`;

  $("starsBar").style.width=
    `${clamp(stars/C.maxCwlStars*100,0,100)}%`;

  $("attacksBar").style.width=
    `${eligible?clamp(completed/eligible*100,0,100):0}%`;

  $("destructionBar").style.width=
    `${clamp(destruction/maxDestruction*100,0,100)}%`;
}

function updateTimeline(){
  const now=new Date();
  const t=getTimeline(now);

  activeDay=t.current;

  if(!Number.isInteger(selectedDay) || selectedDay<1 || selectedDay>7){
    selectedDay=activeDay;
  }

  if(t.before){
    $("currentDayTitle").textContent="Day 1";
    $("currentPhase").textContent="UPCOMING";
    $("currentPhase").className="chip upcoming mono";
    $("currentCountdownLabel").textContent="Starts in";
    $("currentCountdown").textContent=timeLeft(dayStart(1),now);
  }else if(t.after){
    $("currentDayTitle").textContent="CWL Complete";
    $("currentPhase").textContent="ENDED";
    $("currentPhase").className="chip ended mono";
    $("currentCountdownLabel").textContent="Status";
    $("currentCountdown").textContent="FINAL";
  }else{
    $("currentDayTitle").textContent=`Day ${activeDay}`;
    $("currentPhase").textContent="ACTIVE";
    $("currentPhase").className="chip active mono";
    $("currentCountdownLabel").textContent="Ends in";
    $("currentCountdown").textContent=timeLeft(dayEnd(activeDay),now);
  }

  if(!t.after && activeDay<7){
    $("nextWarKicker").textContent="Next war";
    $("nextDayTitle").textContent=`Day ${activeDay+1}`;
    $("nextPhase").textContent="PREPARATION";
    $("nextPhase").className="chip prep mono";
    $("nextCountdownLabel").textContent="Starts in";
    $("nextCountdown").textContent=timeLeft(dayStart(activeDay+1),now);
  }else if(!t.after && activeDay===7){
    $("nextWarKicker").textContent="CWL status";
    $("nextDayTitle").textContent="Final Day";
    $("nextPhase").textContent="ACTIVE";
    $("nextPhase").className="chip active mono";
    $("nextCountdownLabel").textContent="CWL ends in";
    $("nextCountdown").textContent=timeLeft(dayEnd(7),now);
  }else{
    $("nextWarKicker").textContent="CWL status";
    $("nextDayTitle").textContent="Completed";
    $("nextPhase").textContent="ENDED";
    $("nextPhase").className="chip ended mono";
    $("nextCountdownLabel").textContent="Final state";
    $("nextCountdown").textContent="7 / 7";
  }

  renderSummary();
  renderLineupPhase();
}

function renderSummary(){
  if(!members.length) return;

  const ci=activeDay-1;
  const ni=Math.min(6,activeDay);

  const current=members.filter(m=>
    m.days[ci]==="IN" || m.days[ci]==="IN_NA"
  );

  const currentNA=current.filter(m=>m.days[ci]==="IN_NA").length;
  const currentRequired=current.filter(m=>
    m.days[ci]==="IN" && typeof m.stars[ci]!=="number"
  ).length;

  $("currentIn").textContent=`${current.length} in lineup`;
  $("currentAttack").textContent=`${currentRequired} attack required`;
  $("currentNoAttack").textContent=`${currentNA} no attack`;

  if(activeDay<7){
    const next=members.filter(m=>
      m.days[ni]==="IN" || m.days[ni]==="IN_NA"
    );

    const nextNA=next.filter(m=>m.days[ni]==="IN_NA").length;

    $("nextIn").textContent=`${next.length} scheduled`;
    $("nextAttack").textContent=`${next.length-nextNA} eligible attacks`;
  }
}

function buildDayTabs(){
  const root=$("dayTabs");
  root.innerHTML="";

  for(let d=1;d<=7;d++){
    const b=document.createElement("button");
    b.className=`day-tab${d===selectedDay?" active":""}`;
    b.type="button";
    b.textContent=`D${d}`;

    b.addEventListener("click",()=>{
      selectedDay=d;
      restingOpen=false;
      buildDayTabs();
      renderLineup();
    });

    root.appendChild(b);
  }
}

function renderLineupPhase(){
  if($("lineupPhase")){
    $("lineupPhase").textContent=phaseForDay(selectedDay);
  }
}

function memberRow(m,n,raw){
  const row=document.createElement("div");

  row.className="member-row";
  row.tabIndex=0;
  row.setAttribute("role","button");

  row.innerHTML=`
    <div class="member-index mono">${pad(n)}</div>
    <div class="member-name"></div>
    <div class="member-th mono">TH${m.th}</div>
    <div class="member-status ${statusClass(raw)} mono">${lineupStatus(m,selectedDay)}</div>
  `;

  row.querySelector(".member-name").textContent=m.name;

  const open=()=>openDetail(m);

  row.addEventListener("click",open);
  row.addEventListener("keydown",e=>{
    if(e.key==="Enter" || e.key===" "){
      e.preventDefault();
      open();
    }
  });

  return row;
}

function renderLineup(){
  if(!members.length) return;

  const i=selectedDay-1;
  const active=members.filter(m=>m.days[i]==="IN");
  const na=members.filter(m=>m.days[i]==="IN_NA");
  const out=members.filter(m=>m.days[i]==="OUT");

  $("lineupTitle").textContent=`Day ${selectedDay} Lineup`;
  $("lineupPhase").textContent=phaseForDay(selectedDay);
  $("lineupCount").textContent=`${active.length+na.length} / 30`;

  $("inList").replaceChildren();
  $("naList").replaceChildren();
  $("outList").replaceChildren();

  let n=1;

  active.forEach(m=>$("inList").appendChild(memberRow(m,n++,"IN")));
  na.forEach(m=>$("naList").appendChild(memberRow(m,n++,"IN_NA")));
  out.forEach((m,j)=>$("outList").appendChild(memberRow(m,j+1,"OUT")));

  $("naGroup").style.display=na.length?"block":"none";
  $("restingCount").textContent=out.length;
  $("restingContent").style.display=restingOpen?"block":"none";

  $("restingToggle").querySelector("span").textContent=
    restingOpen?"Hide resting members":"Show resting members";
}

function renderDailyBars(){
  const root=$("dailyBars");
  root.innerHTML="";

  const vals=Array.from({length:7},(_,i)=>dailyStars(i+1));
  const max=Math.max(90,...vals);

  vals.forEach((v,i)=>{
    const phase=phaseForDay(i+1);

    let shown;
    let width;

    if(phase==="UPCOMING" || phase==="PREPARATION"){
      shown="—";
      width=0;
    }else{
      shown=`${v} ★`;
      width=clamp(v/max*100,0,100);
    }

    const row=document.createElement("div");
    row.className="daily-row";
    row.innerHTML=`
      <div class="d mono">D${i+1}</div>
      <div class="daily-track"><span style="width:${width}%"></span></div>
      <div class="daily-value mono">${shown}</div>
    `;

    root.appendChild(row);
  });

  $("dailyTotalStars").textContent=
    `${members.reduce((s,m)=>s+totalStars(m),0)} ★ total`;
}

function renderTopThree(){
  const root=$("topThree");
  root.innerHTML="";

  performanceList("TOTAL").slice(0,3).forEach((m,i)=>{
    const e=efficiency(m);
    const attacks=completedAttacks(m);
    const stars=totalStars(m);
    const destruction=playerAvgDestruction(m);

    const el=document.createElement("div");
    el.className="top-item";

    el.innerHTML=`
      <div class="top-rank mono">${pad(i+1)}</div>
      <div>
        <div class="top-name"></div>
        <div class="top-sub mono">
          ${e===null?"EFFICIENCY —":`${e.toFixed(2)} ★/ATK`}
          · ${attacks} ATK
          · ${destruction===null?"—":`${destruction.toFixed(1)} / 100`}
        </div>
      </div>
      <div class="top-stars mono">${stars} ★</div>
    `;

    el.querySelector(".top-name").textContent=m.name;
    root.appendChild(el);
  });
}

function buildLeaderTabs(){
  const root=$("leaderTabs");
  root.innerHTML="";

  ["TOTAL","D1","D2","D3","D4","D5","D6","D7"].forEach(v=>{
    const b=document.createElement("button");

    b.type="button";
    b.className=`leader-tab${v===leaderFilter?" active":""}`;
    b.textContent=v;

    b.addEventListener("click",()=>{
      leaderFilter=v;
      buildLeaderTabs();
      renderLeaderboard();
    });

    root.appendChild(b);
  });
}

function renderLeaderboard(){
  const root=$("leaderboard");
  root.innerHTML="";

  const list=performanceList(leaderFilter);

  list.forEach((m,i)=>{
    const totalMode=leaderFilter==="TOTAL";
    const day=totalMode?7:Number(leaderFilter.slice(1));

    const stars=totalMode
      ? totalStars(m)
      : (typeof m.stars[day-1]==="number"?m.stars[day-1]:null);

    const attacks=totalMode
      ? completedAttacks(m)
      : (typeof m.stars[day-1]==="number" && m.days[day-1]==="IN" ? 1 : 0);

    const eff=totalMode
      ? efficiency(m)
      : (attacks?stars:null);

    const avgDest=playerAvgDestruction(m);

    const row=document.createElement("div");
    row.className="leader-row";
    row.tabIndex=0;
    row.setAttribute("role","button");

    let starText;

    if(totalMode){
      starText=`${stars} ★`;
    }else{
      const info=memberDayDisplay(m,day);
      starText=typeof m.stars[day-1]==="number"
        ? starVisual(m.stars[day-1])
        : info.perf;
    }

    row.innerHTML=`
      <div class="mono leader-muted">${pad(i+1)}</div>
      <div class="leader-name"></div>
      <div class="mono leader-muted">TH${m.th}</div>
      <div class="stars-visual">${starText}</div>
      <div class="mono">${attacks}</div>
      <div class="mono">${eff===null?"—":eff.toFixed(2)}</div>
      <div class="mono">${avgDest===null?"—":`${avgDest.toFixed(1)}/100`}</div>
    `;

    row.querySelector(".leader-name").textContent=m.name;

    row.addEventListener("click",()=>openDetail(m));
    row.addEventListener("keydown",e=>{
      if(e.key==="Enter") openDetail(m);
    });

    root.appendChild(row);
  });
}

function renderSearch(q=""){
  const root=$("searchResults");
  const term=normKey(q);

  root.innerHTML="";

  if(!term){
    root.style.display="none";
    return;
  }

  const matches=members
    .filter(m=>normKey(m.name).includes(term))
    .slice(0,12);

  root.style.display="block";

  if(!matches.length){
    root.innerHTML='<div class="result"><span>No member found</span></div>';
    return;
  }

  matches.forEach(m=>{
    const b=document.createElement("button");

    b.className="result";
    b.type="button";

    b.innerHTML=`
      <span></span>
      <small class="mono">TH${m.th} · ${totalStars(m)} ★</small>
    `;

    b.querySelector("span").textContent=m.name;

    b.addEventListener("click",()=>{
      $("searchInput").blur();
      openDetail(m);
    });

    root.appendChild(b);
  });
}

function openDetail(m){
  scrollYBeforeModal=window.scrollY;

  document.body.classList.add("modal-open");
  document.body.style.top=`-${scrollYBeforeModal}px`;

  $("detailName").textContent=m.name;
  $("detailMeta").textContent=`TH${m.th}`;

  const e=efficiency(m);
  const avgDest=playerAvgDestruction(m);

  let html=`
    <div class="detail-section-title mono">Current</div>
    <div class="current-box">
      <div class="label mono">DAY ${activeDay}</div>
      <strong>${memberDayDisplay(m,activeDay).state}</strong>
    </div>
  `;

  html+=`
    <div class="detail-section-title mono">Performance</div>
    <div class="perf-stats">
      <div class="perf-stat">
        <span>Total Stars</span>
        <b>${totalStars(m)} ★</b>
      </div>

      <div class="perf-stat">
        <span>Wars IN</span>
        <b>${warsIn(m)}</b>
      </div>

      <div class="perf-stat">
        <span>Wars Attack</span>
        <b>${completedAttacks(m)}</b>
      </div>

      <div class="perf-stat">
        <span>Efficiency</span>
        <b>${e===null?"—":`${e.toFixed(2)} ★/ATK`}</b>
      </div>

      <div class="perf-stat">
        <span>Total Destruction</span>
        <b>${Math.round(Number(m.totalDestruction)||0)}</b>
      </div>

      <div class="perf-stat">
        <span>Avg Destruction</span>
        <b>${avgDest===null?"—":`${avgDest.toFixed(1)} / 100`}</b>
      </div>
    </div>
  `;

  html+=`
    <div class="detail-section-title mono">7-Day Schedule</div>
    <div class="schedule-list">
  `;

  for(let d=1;d<=7;d++){
    const info=memberDayDisplay(m,d);

    html+=`
      <div class="schedule-item">
        <div class="mono">D${d}</div>
        <div class="phase mono">${info.state}</div>
        <div class="state">${info.perf}</div>
      </div>
    `;
  }

  html+="</div>";

  $("detailBody").innerHTML=html;

  $("backdrop").classList.add("open");
  $("detail").classList.add("open");
  $("detail").setAttribute("aria-hidden","false");

  setTimeout(()=>$("closeDetail").focus(),10);
}

function closeDetail(){
  $("backdrop").classList.remove("open");
  $("detail").classList.remove("open");
  $("detail").setAttribute("aria-hidden","true");

  document.body.classList.remove("modal-open");
  document.body.style.top="";

  window.scrollTo(0,scrollYBeforeModal);
}

function renderAll(){
  renderOverview();
  updateTimeline();
  buildDayTabs();
  renderLineup();
  renderDailyBars();
  renderTopThree();
  buildLeaderTabs();
  renderLeaderboard();
  renderSearch($("searchInput").value);
}

/* -------------------- LIVE GOOGLE SHEETS -------------------- */

async function fetchCsv(sheet){
  const response=await fetch(csvUrl(sheet),{cache:"no-store"});

  if(!response.ok){
    throw new Error(`${sheet}: HTTP ${response.status}`);
  }

  const text=await response.text();

  // Google sometimes returns an HTML permission page instead of CSV.
  if(/^\s*<!doctype html/i.test(text) || /^\s*<html/i.test(text)){
    throw new Error(`${sheet}: Google returned HTML instead of CSV. Check sharing/publish access.`);
  }

  return parseCsv(text);
}

async function loadAll({manual=false}={}){
  const btn=$("refreshBtn");

  if(btn.disabled) return;

  btn.disabled=true;
  btn.textContent=manual?"Refreshing…":"Loading…";

  setSync("Connecting to Google Sheets…");

  try{
    // Schedule + Total Stars are required.
    const [scheduleRows,starRows]=await Promise.all([
      fetchCsv(C.sheets.schedule),
      fetchCsv(C.sheets.stars)
    ]);

    const schedule=parseSchedule(scheduleRows);
    const starMap=parseStars(starRows);

    if(!schedule.length){
      throw new Error("No member rows found in 7-Day Rolling Schedule.");
    }

    members=mergeData(schedule,starMap);

    // Dashboard timing is optional. Its failure must NOT break live roster/stars.
    try{
      const dashboardRows=await fetchCsv(C.sheets.dashboard);
      const timing=parseDashboardTiming(dashboardRows);

      if(timing){
        day1Start=timing;
      }
    }catch(dashboardErr){
      console.warn("Dashboard timing unavailable; using configured CWL time.",dashboardErr);
    }

    renderAll();

    setSync(`LIVE · 2 data sheets synced · ${formatTime()} GMT+7`);

    btn.textContent="Data Updated";

  }catch(err){
    console.error("POD CLASH live sync failed:",err);

    // No Excel/fallback roster is loaded.
    setSync(`LIVE DATA UNAVAILABLE · ${formatTime()} GMT+7`,true);

    btn.textContent="Refresh Failed";

  }finally{
    setTimeout(()=>{
      btn.disabled=false;
      btn.textContent="Refresh Data";
    },manual?900:300);
  }
}

/* -------------------- INIT -------------------- */

function init(){
  $("clanLink").href=C.clanUrl;
  $("discordLink").href=C.discordUrl;

  const t=getTimeline();
  selectedDay=t.current;
  activeDay=t.current;

  $("searchInput").addEventListener("input",e=>
    renderSearch(e.target.value)
  );

  $("restingToggle").addEventListener("click",()=>{
    restingOpen=!restingOpen;
    renderLineup();
  });

  $("refreshBtn").addEventListener("click",()=>
    loadAll({manual:true})
  );

  $("backdrop").addEventListener("click",closeDetail);
  $("closeDetail").addEventListener("click",closeDetail);

  document.addEventListener("keydown",e=>{
    if(e.key==="Escape") closeDetail();
  });

  // Draw timer immediately, then load live spreadsheet.
  updateTimeline();
  buildDayTabs();

  loadAll();

  // Countdown changes every second.
  setInterval(()=>{
    const previousDay=activeDay;

    updateTimeline();

    // If the CWL rolls into the next day while the page is open,
    // move the selected schedule to the new active day automatically.
    if(activeDay!==previousDay){
      selectedDay=activeDay;
      buildDayTabs();
      renderLineup();
      renderDailyBars();
      renderLeaderboard();
    }
  },1000);

  // Live spreadsheet refresh every 60 seconds.
  setInterval(()=>loadAll(),C.refreshIntervalMs);
}

document.addEventListener("DOMContentLoaded",init);

})();