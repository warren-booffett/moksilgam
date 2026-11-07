import JSZip from "jszip";
import html2canvas from "html2canvas";
import { openWorkbook, readMonth, readSummary, writeDay, saveWorkbook, derive, dayTotals, hasMonth } from "./workbook.js";
import { oneDriveConfigured, signedInAccount, signIn, signOut, oneDriveSource, localFileSource } from "./sources.js";
import { DEFAULT_PATH } from "./config.js";

/* ---------- 작은 유틸 ---------- */
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const DOW = ["일", "월", "화", "수", "목", "금", "토"];
const DOW_EN = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const pad = n => String(n).padStart(2, "0");
const isoOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = s => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const addDays = (iso, n) => { const d = parse(iso); d.setDate(d.getDate() + n); return isoOf(d); };
const todayISO = () => isoOf(new Date());
const toMin = h => (typeof h === "number" ? Math.round(h * 60) : null);
const toHour = m => (typeof m === "number" && isFinite(m) ? m / 60 : null);
const fmtH = h => (typeof h === "number" ? h.toFixed(2) + "시간" : "");
const fmtMin = m => { if (m == null) return ""; const h = Math.floor(m / 60), r = m % 60; return h ? (r ? `${h}시간 ${r}분` : `${h}시간`) : `${r}분`; };
const pct = r => (r == null ? "–" : Math.round(r * 100) + "%");
const store = {
  get(k, d) { try { const v = localStorage.getItem("mok." + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("mok." + k, JSON.stringify(v)); } catch {} },
};

/* ---------- 상태 ---------- */
const S = {
  source: null, wb: null, version: null, year: null,
  months: {},            // month → days[] (엑셀에서 읽은 그대로)
  summary: {},           // month → {monthTotal, cumulative}
  drafts: {},            // date → {tasks, gratitude, notes} (앱에서 고친 것, 아직 저장 전)
  date: todayISO(), tab: "day",
  status: { kind: "ok", text: "" },
  share: { selected: [], secs: new Set(["one", "tasks", "total", "grat"]), layout: null, month: null },
};

/* ---------- 데이터 접근 ---------- */
async function ensureMonth(m) {
  if (!S.wb || m < 1 || m > 12 || !hasMonth(S.wb, m)) return [];
  if (!S.months[m]) { S.months[m] = await readMonth(S.wb, m); S.summary[m] = await readSummary(S.wb, m); }
  return S.months[m];
}
const monthOf = iso => +iso.slice(5, 7);
async function ensureWeek(iso) {
  // 한 주가 두 달에 걸칠 수 있어서 주의 첫날·마지막날 달을 모두 읽어둠
  const start = addDays(iso, -parse(iso).getDay());
  for (const k of [start, addDays(start, 6)]) if (inYear(k)) await ensureMonth(monthOf(k));
}
const inYear = iso => +iso.slice(0, 4) === S.year;
function rawDay(iso) { return inYear(iso) ? (S.months[monthOf(iso)] || []).find(d => d.date === iso) : null; }
function view(iso) {
  // 화면에 보여줄 하루 데이터 (저장 안 한 수정이 있으면 그걸 우선)
  const d = rawDay(iso);
  if (!d) return null;
  const dr = S.drafts[iso];
  if (dr) return { ...d, tasks: dr.tasks, gratitude: dr.gratitude, notes: dr.notes, draft: true };
  return {
    ...d,
    tasks: d.tasks.map(t => ({ name: t.name, goal: toMin(t.goal), actual: toMin(t.actual), one: t.one })),
    gratitude: d.gratitude.slice(),
    notes: Object.fromEntries(d.notes.map(n => [n.k, n.v])),
  };
}
function draftOf(iso) {
  if (!S.drafts[iso]) { const v = viewDay(iso); S.drafts[iso] = { tasks: v.tasks.map(t => ({ ...t })), gratitude: v.gratitude.slice(), notes: { ...v.notes } }; }
  return S.drafts[iso];
}

/* ---------- 고정 루틴: 매일 같은 자리(원씽·목표 n)에 자동으로 채우는 목표 ---------- */
// 루틴은 이 기기(localStorage)에 저장. 기록 화면에만 미리 채워 보여주고, 손대거나 저장하면 엑셀에 들어감.
// 통계·올리기는 엑셀에 실제로 적힌 것만 씀 (미래 날짜 목표가 합계에 섞이지 않도록).
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
const SLOT_COUNT = 7; // 원씽 + 목표 1~6
const routines = () => (store.get("routines", []) || []).filter(r => r && typeof r === "object");
const saveRoutines = rs => store.set("routines", rs);
const routineOn = () => store.get("routineOn", true);
const isEmptyTask = t => !t.name?.trim() && t.goal == null && t.actual == null;
const slotLabel = k => (k === 0 ? "원씽" : `목표 ${k}`);
function routinesFor(iso) {
  if (!routineOn()) return [];
  const dow = parse(iso).getDay(), skip = store.get("routineSkip", {})[iso] || [];
  return routines().filter(r => r.name?.trim() && (r.days ?? ALL_DAYS).includes(dow) && !skip.includes(r.name.trim()));
}
// tasks 배열(그날 엑셀 칸 수만큼)에 루틴을 끼워 넣음. 정해진 자리가 비어 있으면 그 자리, 차 있으면 첫 빈 목표 자리.
function applyRoutines(tasks, iso) {
  for (const r of routinesFor(iso)) {
    const name = r.name.trim();
    if (tasks.some(t => t.name?.trim() === name)) continue;
    let k = Number.isInteger(r.slot) && tasks[r.slot] && isEmptyTask(tasks[r.slot]) ? r.slot : tasks.findIndex((t, j) => j > 0 && isEmptyTask(t));
    if (k < 0) continue;
    Object.assign(tasks[k], { name, goal: typeof r.goal === "number" ? r.goal : null, actual: null });
  }
  return tasks;
}
// 기록 화면용 하루 데이터: 저장 전 수정이 없으면 루틴을 미리 채움.
// 지난 날짜는 아무것도 안 적힌 날에만 채움 (이미 기록한 과거를 바꿔 보이지 않게).
function viewDay(iso) {
  const v = view(iso);
  if (!v || v.draft || !routinesFor(iso).length) return v;
  if (iso < todayISO() && !v.tasks.every(isEmptyTask)) return v;
  return { ...v, tasks: applyRoutines(v.tasks.map(t => ({ ...t })), iso) };
}
const isRoutineName = (iso, name) => !!name?.trim() && routines().some(r => r.name?.trim() === name.trim());
// 그날 루틴을 지우면 다시 채우지 않도록 기억 (30일 지난 기록은 정리)
function skipRoutine(iso, name) {
  const all = store.get("routineSkip", {}) || {}, cut = addDays(todayISO(), -30);
  for (const k of Object.keys(all)) if (k < cut) delete all[k];
  (all[iso] ||= []).includes(name) || all[iso].push(name);
  store.set("routineSkip", all);
}
const hoursTask = t => ({ name: t.name, goal: toHour(t.goal), actual: toHour(t.actual) });
const hasContent = v => v && (v.tasks.some(t => t.name) || v.gratitude.some(Boolean));
const dirtyCount = () => Object.keys(S.drafts).length;

/* ---------- 불러오기 / 저장 ---------- */
async function connect(source) {
  S.source = source;
  setStatus("busy", "엑셀 불러오는 중…");
  try {
    const { data, version } = await source.load();
    await adopt(data, version);
    if (source.kind === "onedrive") store.set("connected", true); // 다음에 켤 때 로그인 버튼 대신 '불러오는 중'을 보여줌
    setStatus("ok", `${source.label} · 불러옴 ${timeNow()}`);
  } catch (e) { setStatus("err", e.message || "불러오지 못했어요"); throw e; }
}
async function adopt(data, version) {
  S.wb = await openWorkbook(JSZip, data);
  S.version = version; S.months = {}; S.summary = {};
  const yearGuess = /(20\d\d)/.exec(S.source.label)?.[1];
  // 1월 시트의 첫 날짜로 연도 확인
  const jan = await ensureMonth(1);
  S.year = jan[0] ? +jan[0].date.slice(0, 4) : (+yearGuess || new Date().getFullYear());
  if (!inYear(S.date)) S.date = S.year < new Date().getFullYear() ? `${S.year}-12-31` : `${S.year}-01-01`;
  await ensureWeek(S.date);
  for (const iso of Object.keys(S.drafts)) if (inYear(iso)) await ensureMonth(monthOf(iso));
  render();
}

async function saveAll() {
  if (!dirtyCount() || !S.source) return;
  setStatus("busy", "엑셀에 저장하는 중…");
  const pending = JSON.parse(JSON.stringify(S.drafts));
  try {
    lastPull = Date.now();
    for (let attempt = 0; attempt < 3; attempt++) {
      // OneDrive: 항상 최신 파일을 받아서 그 위에 오늘 고친 날짜만 덮어씀 (다른 기기에서 바꾼 내용 보존)
      let wb = S.wb, version = S.version;
      if (S.source.kind === "onedrive") { const fresh = await S.source.load(); wb = await openWorkbook(JSZip, fresh.data); version = fresh.version; }
      for (const [iso, dr] of Object.entries(pending)) {
        const day = (await readMonth(wb, monthOf(iso))).find(d => d.date === iso);
        if (!day) throw new Error(`${iso} 칸을 엑셀에서 찾지 못했어요`);
        // 자리(원씽·목표 n)를 그대로 유지해서 씀. 뒤쪽 빈 칸만 잘라냄.
        const tasks = dr.tasks.map(t => ({ ...t, name: (t.name || "").trim() }));
        while (tasks.length && isEmptyTask(tasks[tasks.length - 1])) tasks.pop();
        await writeDay(wb, day, { tasks: tasks.map(hoursTask), gratitude: dr.gratitude, notes: dr.notes });
      }
      const bytes = await saveWorkbook(wb, "uint8array");
      try {
        const res = await S.source.save(bytes, version);
        for (const iso of Object.keys(pending)) delete S.drafts[iso];
        persistDrafts();
        await adopt(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), res.version);
        setStatus("ok", S.source.kind === "local" ? "수정된 엑셀 파일을 내려받았어요" : `${S.source.label} · 저장됨 ${timeNow()}`);
        toast(S.source.kind === "local" ? "수정된 파일을 내려받았어요" : "엑셀에 저장했어요");
        return;
      } catch (e) { if (!e.conflict) throw e; /* 그사이 다른 곳에서 바뀜 → 다시 받아서 재시도 */ }
    }
    throw new Error("다른 곳에서 파일이 계속 바뀌고 있어요. 잠시 뒤 다시 저장해 주세요.");
  } catch (e) {
    setStatus("err", e.message || "저장하지 못했어요");
    toast(e.message || "저장하지 못했어요");
  }
}
const timeNow = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
function persistDrafts() { store.set("drafts", S.drafts); }

/* ---------- 상태 표시 ---------- */
function setStatus(kind, text) { S.status = { kind, text }; const el = $("#sync"); if (el) paintSync(el); }
function paintSync(el) {
  const k = dirtyCount() && S.status.kind === "ok" ? "dirty" : S.status.kind;
  el.className = "sync " + k;
  el.innerHTML = `<i></i><span>${esc(k === "dirty" ? `저장 안 한 날짜 ${dirtyCount()}개` : S.status.text)}</span>`;
}
let toastTimer;
function toast(msg) {
  let el = $(".toast"); if (!el) { el = document.createElement("div"); el.className = "toast"; el.setAttribute("role", "status"); document.body.appendChild(el); }
  el.textContent = msg; el.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => (el.hidden = true), 2200);
}

/* ---------- 렌더 ---------- */
const ICON = {
  day: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3.5" y="4.5" width="17" height="16" rx="3"/><path d="M8 2.5v4M16 2.5v4M3.5 9.5h17M8 14l2.5 2.5L16 12"/></svg>',
  share: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 15V3.5M7.5 8 12 3.5 16.5 8"/><path d="M5 12.5v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/></svg>',
  routine: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 11.5a8 8 0 0 1 13.7-5.6L20 8.2M20 3.5v4.7h-4.7M20 12.5a8 8 0 0 1-13.7 5.6L4 15.8M4 20.5v-4.7h4.7"/></svg>',
  stats: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 20.5h16M7 17v-5M12 17V7M17 17v-8"/></svg>',
};

function render() {
  const app = $("#app");
  if (!S.wb && S.booting) { app.innerHTML = bootHTML(); return; }
  if (!S.wb) { app.innerHTML = welcomeHTML(); bindWelcome(); return; }
  app.innerHTML = `
    <div class="shell">
      <div class="top">
        <div class="top-row">
          <h1>목실감</h1>
          <div id="sync" class="sync"></div>
          <button class="icon-btn" id="openSettings" aria-label="설정">⚙</button>
        </div>
        ${S.tab === "day" ? weekHTML() : ""}
      </div>
      <main id="main">${S.tab === "day" ? dayHTML() : S.tab === "routine" ? routineHTML() : S.tab === "share" ? shareHTML() : statsHTML()}</main>
    </div>
    <div class="savebar" ${dirtyCount() ? "" : "hidden"}><button id="saveBtn">엑셀에 저장 (${dirtyCount()})</button></div>
    <nav class="tabbar" aria-label="화면"><div class="in">
      ${[["day", "기록"], ["routine", "루틴"], ["share", "올리기"], ["stats", "통계"]].map(([k, l]) => `<button data-tab="${k}" ${S.tab === k ? 'aria-current="page"' : ""}>${ICON[k]}${l}</button>`).join("")}
    </div></nav>
    <div id="offscreen" aria-hidden="true"></div>`;
  paintSync($("#sync"));
  if (S.tab === "day") bindDay();
  if (S.tab === "share") bindShare();
  if (S.tab === "routine") bindRoutine();
  autosize();
}

/* ----- 시작 화면 ----- */
// 이미 연결해 둔 기기: 로그인 버튼 대신 불러오는 중 화면 (로그인 확인·엑셀 받기가 끝나면 바로 기록 화면)
function bootHTML() {
  return `<div class="shell"><div class="welcome"><h1>목실감</h1>
    <p class="sync busy" style="justify-self:start"><i></i><span>OneDrive에서 엑셀 불러오는 중…</span></p></div></div>`;
}
function welcomeHTML() {
  const od = oneDriveConfigured();
  return `<div class="shell"><div class="welcome">
    <h1>목실감</h1>
    <p>OneDrive의 목실감 엑셀을 그대로 원본으로 써요. 앱에서 적으면 엑셀 칸에 저장되고, 서식과 수식은 그대로 남아요.</p>
    ${od ? `<button class="primary" id="msLogin">Microsoft 계정으로 연결</button>` : `<p class="hint">OneDrive 연결은 아직 설정 전이에요. 지금은 엑셀 파일을 직접 열어서 체험할 수 있어요.</p>`}
    <label class="secondary filepick" style="text-align:center">엑셀 파일 직접 열기<input type="file" id="pickFile" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"></label>
    <button class="secondary" id="trySample" hidden>샘플 파일로 체험</button>
    <p class="err" id="wErr"></p>
  </div></div>`;
}
function bindWelcome() {
  $("#msLogin")?.addEventListener("click", () => signIn());
  $("#pickFile").addEventListener("change", e => { const f = e.target.files[0]; if (f) connect(localFileSource(f)).catch(err => ($("#wErr").textContent = err.message)); });
  // 개발용 샘플은 로컬 dev 서버에만 있음 (배포 사이트는 없는 파일에도 index.html을 돌려주므로 형식까지 확인)
  fetch("sample.xlsx", { method: "HEAD" }).then(r => { if (r.ok && !/html/.test(r.headers.get("content-type") || "")) $("#trySample").hidden = false; }).catch(() => {});
  $("#trySample").addEventListener("click", async () => {
    const blob = await (await fetch("sample.xlsx")).blob();
    connect(localFileSource(new File([blob], "2026 목실감 (샘플).xlsx", { lastModified: Date.now() }))).catch(err => ($("#wErr").textContent = err.message));
  });
}

/* ----- 주간 날짜 줄 ----- */
function weekHTML() {
  const d = parse(S.date), start = addDays(S.date, -d.getDay());
  const t = todayISO();
  let html = `<div class="week"><button class="nav" data-wk="-7" aria-label="지난주">‹</button>`;
  for (let i = 0; i < 7; i++) {
    const iso = addDays(start, i), dd = parse(iso), v = inYear(iso) ? view(iso) : null;
    const cls = ["wd", i === 0 && "sun", i === 6 && "sat", iso === S.date && "sel", iso === t && "today", hasContent(v) && "has", S.drafts[iso] && "unsaved"].filter(Boolean).join(" ");
    html += `<button class="${cls}" data-date="${iso}" ${v ? "" : "disabled"} aria-label="${dd.getMonth() + 1}월 ${dd.getDate()}일"><small>${DOW[i]}</small><b class="num">${dd.getDate()}</b><span class="dot"></span></button>`;
  }
  return html + `<button class="nav" data-wk="7" aria-label="다음주">›</button></div>`;
}

/* ----- 하루 기록 ----- */
function dayHTML() {
  const v = viewDay(S.date);
  if (!v) return `<div class="empty">${S.date} 칸을 엑셀에서 찾지 못했어요.</div>`;
  const dt = parse(S.date), tot = dayTotals(v.tasks.map(hoursTask));
  const slots = v.taskRows.length;
  const tasks = v.tasks.map((t, i) => ({ ...t, i })).filter(t => t.name || t.goal != null || t.actual != null || t.i === 0);
  const noteKeys = Object.keys(v.notes);
  return `
    <div class="daytitle"><h2>${dt.getMonth() + 1}월 ${dt.getDate()}일 (${DOW[dt.getDay()]})</h2>
      <span class="meta">${S.date === todayISO() ? "오늘" : ""}${S.drafts[S.date] ? " · 저장 전" : ""}</span></div>
    <div class="summary" id="sum">${summaryInner(tot)}</div>

    <div class="section-h"><span>원씽 · 목표 &amp; 실적</span><button id="loadPrev">어제 목표 불러오기</button></div>
    <div class="tasks" id="tasks">${tasks.map(t => taskHTML(t, t.i)).join("")}
      ${tasks.length < slots ? `<button class="add-task" id="addTask">＋ 목표 추가 <span class="hint">(${tasks.length}/${slots})</span></button>` : ""}
    </div>

    <div class="section-h"><span>감사일기</span><span class="hint">월부 감사일기로 복사는 '올리기'에서</span></div>
    <div class="grat">${v.gratitude.map((g, i) => `<div class="gline"><b class="num">${i + 1}</b><textarea rows="1" data-g="${i}" placeholder="오늘 감사한 일">${esc(g)}</textarea></div>`).join("")}</div>

    ${noteKeys.length ? `<div class="section-h"><span>확언 · 돌아보기</span></div>
    <div class="notes">${noteKeys.map(k => `<div class="note"><label for="n-${k}">${k}</label><textarea id="n-${k}" rows="1" data-n="${k}">${esc(v.notes[k])}</textarea></div>`).join("")}</div>` : ""}
    <div style="height:70px"></div>`;
}
function summaryInner(tot) {
  return `<div class="nums num">
      <div><small>목표</small><strong>${fmtMin(toMin(tot.goal)) || "0분"}</strong></div>
      <div><small>실제</small><strong style="color:var(--accent)">${fmtMin(toMin(tot.actual)) || "0분"}</strong></div>
      <div><small>달성률</small><strong>${pct(tot.rate)}</strong></div></div>
    <div class="bar ${tot.rate >= 1 ? "ok" : ""}"><i style="width:${Math.min(1, tot.rate || 0) * 100}%"></i></div>`;
}
function taskHTML(t, i) {
  const { status, rate } = derive(hoursTask(t));
  const st = status === "v" ? "v" : status === "실패" ? "f" : "";
  return `<div class="task ${t.one ? "one" : ""}" data-i="${i}">
    <div class="task-head">
      <span class="chip-st ${st}" data-st>${status || "–"}</span>
      ${t.one ? '<span class="tag-one">원씽</span>' : ""}${isRoutineName(S.date, t.name) ? '<span class="tag-rt">루틴</span>' : ""}
      <input class="task-name ${status === "v" ? "done" : ""}" data-f="name" value="${esc(t.name)}" placeholder="${t.one ? "오늘의 원씽" : "목표"}" aria-label="목표 이름">
      ${t.one ? "" : `<button class="del" data-del aria-label="이 목표 지우기">×</button>`}
    </div>
    <div class="times">
      <div class="tfield"><label>목표</label><div class="row"><input inputmode="numeric" data-f="goal" value="${t.goal ?? ""}" placeholder="0" aria-label="목표 분"><span>분</span></div><div class="hm" data-hm="goal">${fmtMin(t.goal)}</div></div>
      <div class="tfield actual"><label>실제</label><div class="row"><input inputmode="numeric" data-f="actual" value="${t.actual ?? ""}" placeholder="0" aria-label="실제 분"><span>분</span></div><div class="hm" data-hm="actual">${fmtMin(t.actual)}</div></div>
    </div>
    <div class="quick">${[10, 20, 30, 60].map(m => `<button data-add="${m}">+${m < 60 ? m + "분" : "1시간"}</button>`).join("")}<button class="reset" data-done>목표만큼</button><button class="reset" data-clear>실제 지우기</button></div>
    <div class="rate-row"><div class="bar ${rate >= 1 ? "ok" : ""}"><i data-bar style="width:${Math.min(1, rate || 0) * 100}%"></i></div><span class="num" data-rate>${rate == null ? "" : pct(rate)}</span></div>
  </div>`;
}
function refreshTask(i) {
  const card = $(`.task[data-i="${i}"]`); if (!card) return;
  const t = draftOf(S.date).tasks[i];
  const { status, rate } = derive(hoursTask(t));
  const st = $("[data-st]", card); st.textContent = status || "–"; st.className = "chip-st " + (status === "v" ? "v" : status === "실패" ? "f" : "");
  $(".task-name", card).classList.toggle("done", status === "v");
  $("[data-bar]", card).style.width = Math.min(1, rate || 0) * 100 + "%";
  $("[data-bar]", card).parentElement.classList.toggle("ok", rate >= 1);
  $("[data-rate]", card).textContent = rate == null ? "" : pct(rate);
  $('[data-hm="goal"]', card).textContent = fmtMin(t.goal);
  $('[data-hm="actual"]', card).textContent = fmtMin(t.actual);
  $('[data-f="actual"]', card).value = t.actual ?? "";
  refreshChrome();
}
function refreshChrome() {
  const v = viewDay(S.date);
  $("#sum").innerHTML = summaryInner(dayTotals(v.tasks.map(hoursTask)));
  const sb = $(".savebar"); sb.hidden = !dirtyCount(); $("#saveBtn").textContent = `엑셀에 저장 (${dirtyCount()})`;
  const wd = $(`.wd[data-date="${S.date}"]`); if (wd) { wd.classList.add("unsaved"); wd.classList.toggle("has", hasContent(view(S.date))); }
  paintSync($("#sync"));
  persistDrafts();
}
function bindDay() {
  const main = $("#main");
  main.addEventListener("input", e => {
    const el = e.target, card = el.closest(".task");
    if (card) {
      const i = +card.dataset.i, t = draftOf(S.date).tasks[i], f = el.dataset.f;
      if (f === "name") t.name = el.value;
      else { const n = el.value.replace(/[^\d]/g, ""); t[f] = n === "" ? null : Math.min(1440, +n); }
      refreshTask(i);
    } else if (el.dataset.g != null) { draftOf(S.date).gratitude[+el.dataset.g] = el.value; refreshChrome(); }
    else if (el.dataset.n) { draftOf(S.date).notes[el.dataset.n] = el.value; refreshChrome(); }
    if (el.tagName === "TEXTAREA") grow(el);
  });
  main.addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    const card = b.closest(".task");
    if (card) {
      const i = +card.dataset.i, t = draftOf(S.date).tasks[i];
      if (b.dataset.add) { t.actual = (t.actual || 0) + +b.dataset.add; refreshTask(i); }
      else if (b.hasAttribute("data-done")) { if (t.goal != null) { t.actual = t.goal; refreshTask(i); } }
      else if (b.hasAttribute("data-clear")) { t.actual = null; refreshTask(i); }
      else if (b.hasAttribute("data-del")) {
        // 자리를 당기지 않고 그 칸만 비움 (루틴·목표가 늘 같은 자리에 있도록)
        const d = draftOf(S.date);
        if (isRoutineName(S.date, t.name)) skipRoutine(S.date, t.name.trim());
        d.tasks[i] = { name: "", goal: null, actual: null, one: t.one }; render();
      }
      return;
    }
    if (b.id === "addTask") {
      const d = draftOf(S.date), slot = d.tasks.findIndex((t, k) => k > 0 && !t.name && t.goal == null && t.actual == null);
      if (slot > 0) { d.tasks[slot].name = " "; render(); const inp = $(`.task[data-i="${slot}"] .task-name`); d.tasks[slot].name = ""; inp.value = ""; inp.focus(); }
    }
    if (b.id === "loadPrev") loadPrevGoals();
  });
}
async function loadPrevGoals() {
  // 직전에 기록이 있는 날의 목표 이름·목표 시간을 복사 (실제 시간은 비움)
  let iso = addDays(S.date, -1), src = null;
  for (let k = 0; k < 14 && inYear(iso); k++, iso = addDays(iso, -1)) { await ensureMonth(monthOf(iso)); const v = view(iso); if (v && v.tasks.some(t => t.name)) { src = v; break; } }
  if (!src) { toast("불러올 이전 목표가 없어요"); return; }
  const d = draftOf(S.date);
  const own = d.tasks.some(t => t.name?.trim() && !isRoutineName(S.date, t.name)); // 루틴만 있으면 확인 없이 진행
  if (own && !d._confirmPrev) { d._confirmPrev = true; toast("이미 적은 목표가 있어요. 덮어쓰려면 한 번 더 누르세요"); return; }
  delete d._confirmPrev;
  // 같은 자리 그대로 복사 (실제 시간은 비움), 그다음 오늘 루틴을 빈 자리에 채움
  d.tasks = d.tasks.map((t, k) => (src.tasks[k]?.name ? { name: src.tasks[k].name, goal: src.tasks[k].goal, actual: null, one: t.one } : { name: "", goal: null, actual: null, one: t.one }));
  applyRoutines(d.tasks, S.date);
  const lost = src.tasks.slice(d.tasks.length).filter(t => t.name).length;
  if (lost) toast(`칸이 ${d.tasks.length}개라 ${lost}개는 빠졌어요`);
  render(); toast(`${parse(src.date).getMonth() + 1}/${parse(src.date).getDate()} 목표를 불러왔어요`);
}
function grow(el) { el.style.height = "auto"; el.style.height = el.scrollHeight + "px"; }
function autosize() { document.querySelectorAll(".gline textarea, .note textarea").forEach(grow); }

/* ----- 올리기 (캡처 + 제목 + 감사일기 텍스트) ----- */
const SECTIONS = [["one", "원씽"], ["tasks", "목표 & 실적"], ["total", "합계"], ["grat", "감사일기"]];
const LAYOUTS = [["h", "가로로 나란히"], ["v", "세로로 쌓기"], ["each", "날짜마다 따로"]];
function shareHTML() {
  const sh = S.share;
  if (!sh.layout) sh.layout = store.get("layout", "h"); // 기본: 가로로 나란히 (마지막 선택 기억)
  if (sh.month == null) sh.month = monthOf(S.date);
  if (!sh.inited) { sh.inited = true; if (!sh.selected.length) sh.selected = [S.date]; } // 처음 열 때만 오늘 선택
  const y = S.year, m = sh.month - 1, first = new Date(y, m, 1).getDay(), last = new Date(y, m + 1, 0).getDate();
  let cal = DOW.map(d => `<div class="dow">${d}</div>`).join("") + "<div></div>".repeat(first);
  for (let d = 1; d <= last; d++) {
    const iso = `${y}-${pad(m + 1)}-${pad(d)}`, v = view(iso);
    cal += `<button class="d ${hasContent(v) ? "has" : ""} ${sh.selected.includes(iso) ? "sel" : ""} ${iso === todayISO() ? "today" : ""}" data-pick="${iso}" ${v ? "" : "disabled"}>${d}</button>`;
  }
  return `<div class="stack">
    <div class="panel"><h3>날짜 <span>${sh.selected.length}일 선택</span></h3>
      <div class="monthbar"><button class="icon-btn" data-sm="-1" ${sh.month <= 1 ? "disabled" : ""} aria-label="이전 달">‹</button><strong>${y}년 ${sh.month}월</strong><button class="icon-btn" data-sm="1" ${sh.month >= 12 ? "disabled" : ""} aria-label="다음 달">›</button></div>
      <div class="cal">${cal}</div>
      <div class="chips"><button class="chip" data-q="yt">어제·오늘</button><button class="chip" data-q="t">오늘</button><button class="chip" data-q="clear">선택 해제</button></div>
    </div>
    <div class="panel"><h3>이미지에 넣을 항목</h3>
      <div class="chips">${SECTIONS.map(([k, l]) => `<button class="chip" data-sec="${k}" aria-pressed="${sh.secs.has(k)}">${l}</button>`).join("")}</div>
      <div class="chips">${LAYOUTS.map(([k, l]) => `<button class="chip" data-lay="${k}" aria-pressed="${sh.layout === k}">${l}</button>`).join("")}</div>
      <div class="copyrow" style="align-items:center"><label class="hint" for="nick" style="white-space:nowrap">이름</label><input class="field" id="nick" value="${esc(store.get("nick", "워렌부핏"))}" placeholder="워렌부핏"><span class="hint" style="white-space:nowrap">님의</span></div>
      <div class="stage" id="stage"><div class="scaler" id="scaler"></div></div>
      <button class="primary" id="goWeolbu">월부에 올리기</button>
      <button class="secondary" id="makeImg">이미지만 만들기</button>
    </div>
    <div class="panel"><h3>글 제목</h3>
      <label class="hint" for="suffix">제목 뒤에 붙일 말 · ${new Date().getMonth() + 1}월 기본값으로 기억돼요</label>
      <input class="field" id="suffix" value="${esc(getSuffix())}" placeholder="예: 독서TF/재테입2기 5늘부터9십살까지부자되조 워렌부핏">
      <div class="copyrow"><input class="field" id="titleOut" readonly style="font-weight:600"><button class="cbtn" data-copy="titleOut">복사</button></div>
    </div>
    <div class="panel"><h3>감사일기 텍스트 <span>월부 감사일기에 붙여넣기</span></h3><div id="gratOut" class="stack"></div></div>
    <div style="height:10px"></div>
  </div>`;
}
const cleanLine = s => String(s).replace(/[\t\r\n]+/g, " ").replace(/\s{2,}/g, " ").trim();
function fmtRange(keys) {
  const ds = keys.map(parse).sort((a, b) => a - b), runs = [];
  ds.forEach(d => { const l = runs[runs.length - 1]; if (l && Math.round((d - l[l.length - 1]) / 86400000) === 1) l.push(d); else runs.push([d]); });
  return runs.map(r => { const a = r[0], b = r[r.length - 1], A = `${a.getMonth() + 1}.${a.getDate()}`; return r.length === 1 ? A : a.getMonth() === b.getMonth() ? `${A}~${b.getDate()}` : `${A}~${b.getMonth() + 1}.${b.getDate()}`; }).join(", ");
}
// 제목 꼬리말: 이번 달에 입력한 값이 이번 달 기본값. 새 달이 되면 마지막으로 쓴 값을 이어받아 시작.
const DEFAULT_SUFFIX = "독서TF/재테입2기 5늘부터9십살까지부자되조 워렌부핏";
const monthKey = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
function getSuffix() {
  const m = store.get(`suffix.${monthKey()}`, null);
  if (m != null) return m;
  return store.get("suffix.last", null) ?? store.get("suffix", null) ?? DEFAULT_SUFFIX;
}
function setSuffix(v) { store.set(`suffix.${monthKey()}`, v); store.set("suffix.last", v); }
function buildTitle() {
  const sel = S.share.selected; if (!sel.length) return "";
  let s = ($("#suffix")?.value ?? getSuffix()).trim();
  if (s && !/^\[.*\]$/.test(s)) s = `[${s}]`;
  return `${fmtRange(sel)} 목실감${s ? " " + s : ""}`;
}
/* 공유 이미지: 월부 목실감 공유 카드와 어울리는 파스텔 그라데이션 + 흰 카드.
   목표/실적은 내 엑셀 포맷(상태·목표·실제·달성률) 그대로, 감사일기는 번호 목록. */
const BAR = ["#fcdcb6", "#f8cfd4", "#cfdcf8", "#c3eedb", "#e3d4f7"];
const W_DOW = ["월", "화", "수", "목", "금", "토", "일"];
// 워렌부핏 캐릭터 (배경 제거한 스티커). 제목 오른쪽에서 카드 위로 살짝 걸치게 배치
const DECO_GOAL = `<img class="wchar goal" src="scene-goal.png" alt="">`;
const DECO_GRAT = `<img class="wchar grat" src="scene-grat.png" alt="">`;
const SMILE = `<svg width="46" height="46" viewBox="0 0 46 46" aria-hidden="true"><circle cx="23" cy="23" r="19" fill="none" stroke="#9aa1ad" stroke-width="2.6"/><circle cx="17" cy="19" r="2" fill="#9aa1ad"/><circle cx="29" cy="19" r="2" fill="#9aa1ad"/><path d="M15.5 27.5c4.5 5 10.5 5 15 0" fill="none" stroke="#9aa1ad" stroke-width="2.6" stroke-linecap="round"/></svg>`;

function weekStripHTML(iso) {
  const d = parse(iso), start = addDays(iso, -((d.getDay() + 6) % 7)), t = todayISO();
  let lab = "", num = "";
  for (let i = 0; i < 7; i++) {
    const k = addDays(start, i), on = k === iso, today = k === t && !on;
    lab += `<span class="${on || k === t ? "strong" : ""}">${W_DOW[i]}</span>`;
    num += `<span class="n${on ? " sel" : today ? " today" : ""}">${parse(k).getDate()}</span>`;
  }
  return `<div class="wweek">${lab}${num}</div>`;
}
function dayShotHTML(iso) {
  const v = view(iso), dt = parse(iso), sec = S.share.secs, nick = esc(store.get("nick", "워렌부핏") || "");
  const yy = String(dt.getFullYear()).slice(2);
  const tasks = v.tasks.filter(t => t.name && ((t.one && sec.has("one")) || (!t.one && sec.has("tasks"))));
  const showGoal = tasks.length || sec.has("total");
  const g = v.gratitude.map(cleanLine).filter(Boolean);
  const rateCell = (r, status) => {
    const cls = r == null ? "none" : r >= 1 ? "ok" : "low";
    return `<span class="wrate ${cls}">${r == null ? "–" : pct(r)}</span>`;
  };
  const row = (t, i) => {
    const { status, rate } = derive(hoursTask(t));
    const st = status === "v" ? `<span class="wst ok">✓</span>` : status === "실패" ? `<span class="wst no">실패</span>` : "";
    return `<div class="wrow${t.one ? " one" : ""}"><i class="wbar" style="background:${t.one ? "#2bb3bb" : BAR[i % BAR.length]}"></i>
      <div class="wname">${st}${t.one ? '<span class="wone">원씽</span>' : ""}<span class="${status === "v" ? "done" : ""}">${esc(t.name)}</span></div>
      <span class="wt">${fmtMin(t.goal) || "–"}</span><span class="wt act">${fmtMin(t.actual) || "–"}</span>${rateCell(rate, status)}</div>`;
  };
  let h = `<section class="wday"><div class="wdate">${yy}년 ${dt.getMonth() + 1}월 ${dt.getDate()}일(${DOW[dt.getDay()]})</div>`;
  if (showGoal) {
    h += `<div class="whead goal"><div><small>${nick}님의</small><b>목표/실적</b></div>${DECO_GOAL}</div>
      <div class="wcard">${weekStripHTML(iso)}
        <div class="wcols"><span></span><span>목표</span><span>실제</span><span>달성률</span></div>
        ${tasks.map(row).join("") || '<div class="wempty">적은 목표가 없어요</div>'}`;
    if (sec.has("total")) {
      const tot = dayTotals(v.tasks.map(hoursTask));
      h += `<div class="wrow total"><div class="wname">합계</div><span class="wt">${fmtMin(toMin(tot.goal)) || "–"}</span><span class="wt act">${fmtMin(toMin(tot.actual)) || "–"}</span>${rateCell(tot.rate)}</div>`;
    }
    h += `</div>`;
  }
  if (sec.has("grat") && g.length) {
    h += `<div class="whead grat"><div><small>${nick}님의</small><b>감사일기</b></div>${DECO_GRAT}</div>
      <div class="wcard wgrat"><div class="wsmile">${SMILE}</div>${g.map((x, i) => `<p>${i + 1}. ${esc(x)}</p>`).join("")}</div>`;
  }
  return h + `</section>`;
}
const shotHTML = (keys, layout = "v") => `<div class="wshot${layout === "h" && keys.length > 1 ? " h" : ""}">${keys.map(dayShotHTML).join("")}</div>`;
function paintShare() {
  const sh = S.share, sc = $("#scaler");
  sc.innerHTML = !sh.selected.length ? `<div class="empty" style="width:100%">달력에서 날짜를 골라주세요</div>` : sh.layout === "each" ? `<div style="display:grid;gap:12px">${sh.selected.map(k => shotHTML([k])).join("")}</div>` : shotHTML(sh.selected, sh.layout);
  const stage = $("#stage"); sc.style.transform = "none";
  const s = Math.min(1, stage.clientWidth / (sc.scrollWidth || 1)); sc.style.transform = `scale(${s})`; stage.style.height = Math.ceil(sc.scrollHeight * s) + "px";
  $("#titleOut").value = buildTitle() || "날짜를 고르면 제목이 만들어져요";
  const items = sh.selected.map(k => [k, view(k)]).filter(([, v]) => v && v.gratitude.some(Boolean));
  $("#gratOut").innerHTML = items.length ? items.map(([k, v]) => { const dt = parse(k); const text = v.gratitude.map(cleanLine).filter(Boolean).map((g, i) => `${i + 1}. ${g}`).join("\n");
    return `<div style="display:grid;gap:6px"><div style="display:flex;justify-content:space-between;align-items:center;font-weight:600">${dt.getMonth() + 1}월 ${dt.getDate()}일 (${DOW[dt.getDay()]})<button class="cbtn" data-copy="g-${k}">복사</button></div><textarea class="field" id="g-${k}" readonly rows="${Math.min(12, text.split("\n").length * 2 + 1)}">${esc(text)}</textarea></div>`; }).join("")
    : `<div class="empty" style="padding:8px">고른 날짜에 감사일기가 없어요</div>`;
}
function bindShare() {
  paintShare();
  const main = $("#main"), sh = S.share;
  main.addEventListener("click", async e => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.pick) { const k = b.dataset.pick, i = sh.selected.indexOf(k); i >= 0 ? sh.selected.splice(i, 1) : sh.selected.push(k); sh.selected.sort(); rerenderShare(); }
    else if (b.dataset.sm) { sh.month += +b.dataset.sm; await ensureMonth(sh.month); rerenderShare(); }
    else if (b.dataset.q) { const t = todayISO(); sh.selected = b.dataset.q === "clear" ? [] : (b.dataset.q === "t" ? [t] : [addDays(t, -1), t]).filter(k => view(k)); rerenderShare(); }
    else if (b.dataset.sec) { sh.secs.has(b.dataset.sec) ? sh.secs.delete(b.dataset.sec) : sh.secs.add(b.dataset.sec); rerenderShare(); }
    else if (b.dataset.lay) { sh.layout = b.dataset.lay; store.set("layout", sh.layout); rerenderShare(); }
    else if (b.dataset.copy) copyFrom($("#" + CSS.escape(b.dataset.copy)), b);
    else if (b.id === "makeImg") makeImages(b, "image");
    else if (b.id === "goWeolbu") makeImages(b, "upload");
  });
  $("#suffix").addEventListener("input", e => { setSuffix(e.target.value); $("#titleOut").value = buildTitle(); });
  $("#nick").addEventListener("change", e => { store.set("nick", e.target.value.trim()); paintShare(); });
}
function rerenderShare() {
  // #main 노드를 새로 바꿔 끼워서 이벤트 리스너가 겹치지 않게
  const y = scrollY, old = $("#main"), fresh = old.cloneNode(false);
  fresh.innerHTML = shareHTML(); old.replaceWith(fresh); bindShare(); scrollTo(0, y);
}
async function copyFrom(el, btn) {
  let ok = false;
  try { await navigator.clipboard.writeText(el.value); ok = true; } catch { el.focus(); el.select(); try { ok = document.execCommand("copy"); } catch {} }
  const old = btn.textContent; btn.textContent = ok ? "복사됨" : "길게 눌러 복사"; btn.classList.toggle("done", ok);
  setTimeout(() => { btn.textContent = old; btn.classList.remove("done"); }, 1500);
}
// 월부 목실감 게시판 글쓰기 화면 (게시판이 '부동산 / 매일실천 / 목실감'으로 미리 선택돼서 열림)
const WEOLBU_WRITE = "https://weolbu.com/community/form?nav=2041";

async function renderFiles() {
  const sh = S.share;
  await document.fonts?.ready;
  const groups = sh.layout === "each" ? sh.selected.map(k => [k]) : [sh.selected], off = $("#offscreen"), files = [];
  for (const g of groups) {
    off.innerHTML = shotHTML(g, sh.layout);
    await Promise.all([...off.querySelectorAll("img")].map(i => i.decode().catch(() => {}))); // 그림 로드 대기
    const canvas = await html2canvas(off.firstElementChild, { scale: 3, backgroundColor: "#c3eef3", logging: false });
    const blob = await new Promise(r => canvas.toBlob(r, "image/png"));
    files.push(new File([blob], `목실감_${g.map(k => k.slice(5).replace("-", "")).join("_")}.png`, { type: "image/png" }));
  }
  off.innerHTML = "";
  return files;
}
async function makeImages(btn, mode) {
  if (!S.share.selected.length) return;
  const label = btn.textContent; btn.disabled = true; btn.textContent = "만드는 중…";
  try { showImages(await renderFiles(), mode); }
  catch (e) { toast("이미지를 만들지 못했어요"); }
  finally { btn.disabled = false; btn.textContent = label; }
}

// 제목(글자)과 이미지를 한 번에 클립보드에 넣음 → 월부 제목 칸엔 제목, 본문 칸엔 이미지가 붙여넣어짐
async function copyTitleAndImage(title, file) {
  if (!navigator.clipboard?.write || !window.ClipboardItem) return false;
  try {
    await navigator.clipboard.write([new ClipboardItem({ "text/plain": new Blob([title], { type: "text/plain" }), "image/png": file })]);
    return true;
  } catch { return false; }
}

function showImages(files, mode) {
  const urls = files.map(f => URL.createObjectURL(f));
  const ov = document.createElement("div"); ov.className = "overlay";
  const canShare = navigator.canShare?.({ files });
  const title = buildTitle();
  const upload = mode === "upload";
  ov.innerHTML = `<div class="sheet-modal" role="dialog" aria-label="${upload ? "월부에 올리기" : "이미지"}"><div class="head"><strong>${upload ? "월부에 올릴 준비 완료" : `이미지 ${files.length}장`}</strong><button class="icon-btn" data-x aria-label="닫기">✕</button></div>
    ${upload ? `
      <div class="panel" style="gap:8px"><h3>제목</h3><div style="font-weight:700">${esc(title)}</div></div>
      <button class="primary" data-go>복사하고 월부 글쓰기 열기</button>
      <ol class="steps">
        <li>월부 글쓰기 화면이 열리면 <b>제목 칸</b>을 길게 눌러 <b>붙여넣기</b></li>
        <li><b>내용 칸</b>을 길게 눌러 <b>붙여넣기</b> → 이미지가 들어가요</li>
        <li>확인하고 <b>등록</b></li>
      </ol>
      ${files.length > 1 ? `<p class="hint">이미지가 ${files.length}장이라 첫 장만 복사돼요. 나머지는 아래에서 저장해서 월부의 사진 버튼으로 넣어주세요.</p>` : ""}
      <p class="hint" data-fallback hidden>이 브라우저는 이미지 복사를 지원하지 않아요. 제목만 복사했어요. 아래 [사진에 저장]으로 저장한 뒤, 월부 글쓰기의 사진 버튼으로 넣어주세요.</p>` : ""}
    ${canShare ? `<button class="${upload ? "secondary" : "primary"}" data-share>사진에 저장 · 공유</button>` : `<p class="hint">이미지를 길게 눌러 저장하거나, 아래 버튼으로 내려받으세요.</p>`}
    ${urls.map((u, i) => `<img src="${u}" alt="${esc(files[i].name)}"><a class="secondary" style="text-align:center;text-decoration:none;display:block" href="${u}" download="${esc(files[i].name)}">${esc(files[i].name)} 내려받기</a>`).join("")}</div>`;
  document.body.appendChild(ov);
  const close = () => { ov.remove(); urls.forEach(URL.revokeObjectURL); };
  ov.addEventListener("click", async e => {
    if (e.target === ov || e.target.closest("[data-x]")) return close();
    if (e.target.closest("[data-share]")) { try { await navigator.share({ files }); } catch {} }
    const go = e.target.closest("[data-go]");
    if (go) {
      // 클립보드 쓰기와 새 창 열기는 같은 탭(사용자 동작) 안에서 바로 해야 막히지 않음
      const copying = copyTitleAndImage(title, files[0]);
      window.open(WEOLBU_WRITE, "_blank", "noopener");
      const ok = await copying;
      if (!ok) { try { await navigator.clipboard.writeText(title); } catch {} $("[data-fallback]", ov).hidden = false; }
      go.textContent = ok ? "복사됨 · 월부에서 붙여넣으세요" : "제목만 복사됨";
      toast(ok ? "제목과 이미지를 복사했어요" : "제목을 복사했어요");
    }
  });
}

/* ----- 고정 루틴 ----- */
function routineHTML() {
  const rs = routines(), on = routineOn();
  const opts = sel => Array.from({ length: SLOT_COUNT }, (_, k) => `<option value="${k}" ${k === sel ? "selected" : ""}>${slotLabel(k)}</option>`).join("");
  const today = routinesFor(todayISO());
  return `<div class="stack">
    <div class="panel"><h3>고정 루틴 <span>${rs.length}개</span></h3>
      <p class="hint" style="margin:0">여기 적은 목표는 <b>기록</b> 화면의 정해진 자리에 매일 자동으로 채워져요. 실제 시간만 적고 저장하면 엑셀에 들어가요.</p>
      <label class="switch"><input type="checkbox" id="rtOn" ${on ? "checked" : ""}><span>매일 자동으로 채우기</span></label>
      ${on && rs.length ? `<div class="hint">오늘(${DOW[new Date().getDay()]}) 채워질 루틴 ${today.length}개</div>` : ""}
    </div>
    ${rs.map((r, i) => `<div class="panel rt" data-r="${i}">
      <div class="rt-head">
        <select class="field rt-slot" data-rf="slot" aria-label="자리">${opts(r.slot)}</select>
        <input class="field" data-rf="name" value="${esc(r.name)}" placeholder="예: 임장 보고서 쓰기" aria-label="루틴 이름">
        <button class="del" data-rdel aria-label="이 루틴 지우기">×</button>
      </div>
      <div class="rt-row"><label for="rg-${i}">목표</label><input class="field num rt-goal" id="rg-${i}" inputmode="numeric" data-rf="goal" value="${r.goal ?? ""}" placeholder="0"><span class="hint">분</span>
        <div class="quick">${[30, 60, 120].map(m => `<button data-rset="${m}">${m < 60 ? m + "분" : m / 60 + "시간"}</button>`).join("")}</div></div>
      <div class="rt-days" role="group" aria-label="반복 요일">${DOW.map((d, k) => `<button class="chip ${k === 0 ? "sun" : k === 6 ? "sat" : ""}" data-rday="${k}" aria-pressed="${(r.days ?? ALL_DAYS).includes(k)}">${d}</button>`).join("")}</div>
    </div>`).join("")}
    ${rs.length < SLOT_COUNT ? `<button class="add-task" id="rtAdd">＋ 루틴 추가</button>` : ""}
    <p class="hint" style="margin:0 2px">· 정해진 자리가 이미 차 있으면 첫 빈 목표 자리에 들어가요.<br>· 기록 화면에서 루틴을 ×로 지우면 그날은 다시 채우지 않아요.<br>· 지난 날짜는 아무것도 안 적힌 날에만 채워져요.<br>· 루틴 목록은 이 기기에 저장돼요.</p>
  </div>`;
}
function bindRoutine() {
  const main = $("#main");
  const upd = (i, f) => { const rs = routines(); if (rs[i]) { f(rs[i]); saveRoutines(rs); } };
  main.addEventListener("input", e => {
    const el = e.target, card = el.closest(".rt"); if (!card || !el.dataset.rf) return;
    const i = +card.dataset.r, f = el.dataset.rf;
    if (f === "name") upd(i, r => (r.name = el.value));
    else if (f === "goal") { const n = el.value.replace(/[^\d]/g, ""); if (n !== el.value) el.value = n; upd(i, r => (r.goal = n === "" ? null : Math.min(1440, +n))); }
  });
  main.addEventListener("change", e => {
    const el = e.target;
    if (el.id === "rtOn") { store.set("routineOn", el.checked); render(); return; }
    const card = el.closest(".rt"); if (card && el.dataset.rf === "slot") upd(+card.dataset.r, r => (r.slot = +el.value));
  });
  main.addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.id === "rtAdd") {
      const rs = routines(), used = new Set(rs.map(r => r.slot));
      const slot = [1, 2, 3, 4, 5, 6, 0].find(k => !used.has(k)) ?? 1;
      rs.push({ name: "", goal: null, slot, days: ALL_DAYS.slice() }); saveRoutines(rs); render();
      $(`.rt[data-r="${rs.length - 1}"] [data-rf="name"]`)?.focus();
      return;
    }
    const card = b.closest(".rt"); if (!card) return;
    const i = +card.dataset.r;
    if (b.hasAttribute("data-rdel")) { const rs = routines(); rs.splice(i, 1); saveRoutines(rs); render(); }
    else if (b.dataset.rset) { upd(i, r => (r.goal = +b.dataset.rset)); $('[data-rf="goal"]', card).value = b.dataset.rset; }
    else if (b.dataset.rday != null) {
      const k = +b.dataset.rday;
      upd(i, r => { const s = new Set(r.days ?? ALL_DAYS); s.has(k) ? s.delete(k) : s.add(k); r.days = [...s].sort(); });
      b.setAttribute("aria-pressed", String(b.getAttribute("aria-pressed") !== "true"));
    }
  });
}

/* ----- 통계 ----- */
function statsHTML() {
  const m = monthOf(S.date), days = S.months[m] || [], sum = S.summary[m] || {};
  const weeks = {};
  for (const d of days) {
    const v = view(d.date), t = dayTotals(v.tasks.map(hoursTask)), key = d.dateRow;
    (weeks[key] ||= { from: d.date, to: d.date, goal: 0, actual: 0 });
    weeks[key].to = d.date; weeks[key].goal += t.goal; weeks[key].actual += t.actual;
  }
  const monthActual = Object.values(weeks).reduce((s, w) => s + w.actual, 0);
  const monthGoal = Object.values(weeks).reduce((s, w) => s + w.goal, 0);
  const cumulative = sum.cumulative != null && sum.monthTotal != null ? sum.cumulative - sum.monthTotal + monthActual : null;
  const ws = Object.values(weeks).map((w, i) => { const r = w.goal ? w.actual / w.goal : null; const a = parse(w.from), b = parse(w.to);
    return `<div class="stats-week"><span>${i + 1}주차<br><small class="hint">${a.getMonth() + 1}/${a.getDate()}~${b.getDate()}</small></span><div class="bar ${r >= 1 ? "ok" : ""}"><i style="width:${Math.min(1, r || 0) * 100}%"></i></div><span class="num" style="text-align:right">${w.actual.toFixed(1)} / ${w.goal.toFixed(1)}h<br><small class="hint">${pct(r)}</small></span></div>`; }).join("");
  return `<div class="stack">
    <div class="panel"><h3>${m}월 투자 시간</h3><div class="big num">${monthActual.toFixed(1)}시간</div><div class="hint">목표 ${monthGoal.toFixed(1)}시간 · 달성률 ${pct(monthGoal ? monthActual / monthGoal : null)}</div></div>
    <div class="panel"><h3>누적 투자 시간 <span>1만 시간의 법칙</span></h3>
      <div class="big num">${cumulative == null ? "–" : cumulative.toFixed(1) + "시간"}</div>
      <div class="bar ok"><i style="width:${Math.min(1, (cumulative || 0) / 10000) * 100}%"></i></div>
      <div class="hint">${cumulative == null ? "" : `${pct(cumulative / 10000)} 달성 · `}엑셀 누적값에 이번 달 앱 기록을 반영한 값이에요</div></div>
    <div class="panel"><h3>주차별</h3>${ws || '<div class="empty">기록이 없어요</div>'}</div>
  </div>`;
}

/* ----- 설정 ----- */
async function openSettings() {
  const acct = await signedInAccount().catch(() => null);
  const ov = document.createElement("div"); ov.className = "overlay";
  ov.innerHTML = `<div class="sheet-modal" role="dialog" aria-label="설정"><div class="head"><strong>설정</strong><button class="icon-btn" data-x aria-label="닫기">✕</button></div>
    <div class="panel"><h3>연결된 파일</h3><div>${esc(S.source?.label || "-")} <span class="hint">${S.source?.kind === "onedrive" ? "OneDrive" : "기기에서 연 파일 (저장하면 내려받기)"}</span></div></div>
    ${oneDriveConfigured() ? `<div class="panel"><h3>OneDrive 파일 경로</h3><input class="field" id="pathIn" value="${esc(store.get("path", DEFAULT_PATH))}"><button class="secondary" id="pathSave">이 경로로 다시 불러오기</button>
      <div class="hint">${acct ? `${esc(acct.username)} 로 로그인됨` : "로그인 전"}</div>${acct ? `<button class="secondary" id="logout">로그아웃</button>` : `<button class="primary" id="login">Microsoft 계정으로 연결</button>`}</div>` : ""}
    <div class="panel"><h3>다른 파일 열기</h3><label class="secondary filepick" style="text-align:center">엑셀 파일 직접 열기<input type="file" id="pick2" accept=".xlsx"></label></div>
    <button class="secondary" id="reload">엑셀에서 다시 불러오기</button>
  </div>`;
  document.body.appendChild(ov);
  const close = () => ov.remove();
  ov.addEventListener("click", async e => {
    if (e.target === ov || e.target.closest("[data-x]")) return close();
    const id = e.target.closest("button")?.id;
    if (id === "login") signIn();
    if (id === "logout") { store.set("connected", false); signOut(); }
    if (id === "pathSave") { store.set("path", $("#pathIn").value.trim()); close(); connect(oneDriveSource(store.get("path", DEFAULT_PATH))).catch(() => {}); }
    if (id === "reload") { if (dirtyCount()) { toast("저장 안 한 기록이 있어요. 먼저 저장해 주세요"); return; } close(); connect(S.source).catch(() => {}); }
  });
  $("#pick2", ov).addEventListener("change", e => { const f = e.target.files[0]; if (f) { close(); S.drafts = {}; connect(localFileSource(f)).catch(() => {}); } });
}

/* ---------- 전역 이벤트 ---------- */
document.addEventListener("click", async e => {
  const b = e.target.closest("button"); if (!b) return;
  if (b.dataset.tab) { S.tab = b.dataset.tab; if (S.tab === "share") S.share.month = monthOf(S.date); render(); scrollTo(0, 0); }
  else if (b.dataset.date) { S.date = b.dataset.date; render(); }
  else if (b.dataset.wk) { const n = addDays(S.date, +b.dataset.wk); if (inYear(n)) { await ensureWeek(n); S.date = n; render(); } }
  else if (b.id === "saveBtn") { b.disabled = true; await saveAll(); render(); }
  else if (b.id === "openSettings") openSettings();
});
addEventListener("beforeunload", e => { if (dirtyCount()) { e.preventDefault(); e.returnValue = ""; } });

// 앱을 다시 화면에 띄우면(다른 앱 갔다 오기, 폰 잠금 해제) OneDrive 엑셀을 새로 읽어서
// PC 엑셀에서 적은 내용을 가져옴. 저장 안 한 기록이 있으면 덮어쓰지 않도록 건너뜀.
let lastPull = Date.now(), pulling = false;
async function pullIfChanged() {
  if (pulling || !S.source || S.source.kind !== "onedrive" || dirtyCount() || S.status.kind === "busy") return;
  if (Date.now() - lastPull < 20000) return;
  pulling = true; lastPull = Date.now();
  try {
    const { data, version } = await S.source.load();
    if (version && version === S.version) { setStatus("ok", `${S.source.label} · 최신 상태 ${timeNow()}`); return; }
    const keep = { tab: S.tab, y: scrollY };
    await adopt(data, version);
    S.tab = keep.tab; render(); scrollTo(0, keep.y);
    setStatus("ok", `${S.source.label} · 엑셀 변경 반영 ${timeNow()}`);
    toast("엑셀에서 바뀐 내용을 불러왔어요");
  } catch (e) { setStatus("err", e.message || "다시 불러오지 못했어요"); }
  finally { pulling = false; }
}
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") pullIfChanged(); });
addEventListener("focus", pullIfChanged);

/* ---------- 시작 ---------- */
(async function boot() {
  S.drafts = store.get("drafts", {}) || {};
  S.booting = oneDriveConfigured() && store.get("connected", false);
  render();
  if (oneDriveConfigured()) {
    let err = "";
    try {
      const acct = await signedInAccount();
      if (acct) await connect(oneDriveSource(store.get("path", DEFAULT_PATH)));
      else store.set("connected", false);
    } catch (e) { err = e.message || "불러오지 못했어요"; }
    S.booting = false;
    if (!S.wb) { render(); const el = $("#wErr"); if (el && err) el.textContent = err; }
  }
  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
})();
