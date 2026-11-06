// 목실감 엑셀(.xlsx) 읽기/부분수정 엔진.
// 파일 전체를 다시 만들지 않고, 바꿀 셀의 XML만 고쳐서 서식·조건부서식·배경이미지를 그대로 보존한다.
// 브라우저와 Node 모두에서 동작 (JSZip 인스턴스를 주입받음).

const MONTH_SHEET = m => `${m}월`; // m: 1~12
const DAY_COLS = [2, 7, 12, 17, 22, 27, 32]; // B,G,L,Q,V,AA,AF (일~토 블록의 첫 열)
const NOTE_LABELS = ["확언", "잘한점", "아쉬운점", "반성할점"];

/* ---------- 주소 유틸 ---------- */
export function colName(n) { let s = ""; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }
export function colNum(s) { let n = 0; for (const ch of s) n = n * 26 + (ch.charCodeAt(0) - 64); return n; }
const addr = (c, r) => colName(c) + r;
const xmlEsc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const xmlUnesc = s => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d)).replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&amp;/g, "&");
export const serialToISO = n => { const d = new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86400000); return d.toISOString().slice(0, 10); };

/* ---------- 패키지 열기 ---------- */
export async function openWorkbook(JSZip, data) {
  const zip = await JSZip.loadAsync(data);
  const wbXml = await zip.file("xl/workbook.xml").async("string");
  const rels = await zip.file("xl/_rels/workbook.xml.rels").async("string");
  const relMap = {};
  for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = /Id="([^"]+)"/.exec(m[0])?.[1], target = /Target="([^"]+)"/.exec(m[0])?.[1];
    if (id && target) relMap[id] = target.startsWith("/") ? target.slice(1) : "xl/" + target.replace(/^\.\//, "");
  }
  const sheets = {};
  for (const m of wbXml.matchAll(/<sheet\b[^>]*>/g)) {
    const name = xmlUnesc(/name="([^"]+)"/.exec(m[0])[1]);
    const rid = /r:id="([^"]+)"/.exec(m[0])[1];
    sheets[name] = relMap[rid];
  }
  let sst = [];
  const sstFile = zip.file("xl/sharedStrings.xml");
  if (sstFile) {
    const x = await sstFile.async("string");
    sst = [...x.matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m =>
      [...m[1].matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(t => xmlUnesc(t[1])).join("")
    );
  }
  return { zip, sheets, sst, cache: {}, dirty: new Set() };
}

async function sheetXml(wb, name) {
  const path = wb.sheets[name];
  if (!path) throw new Error(`'${name}' 시트를 찾을 수 없어요`);
  if (!wb.cache[path]) wb.cache[path] = await wb.zip.file(path).async("string");
  return path;
}

/* ---------- 셀 파싱 ---------- */
const CELL_RE = /<c r="([A-Z]+)(\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
function parseCells(xml, sst) {
  const cells = new Map();
  for (const m of xml.matchAll(CELL_RE)) {
    const [, col, row, attrs, inner = ""] = m;
    const t = /\bt="([^"]+)"/.exec(attrs)?.[1];
    const vRaw = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
    let value = null;
    if (t === "s" && vRaw != null) value = sst[+vRaw] ?? "";
    else if (t === "inlineStr") value = [...inner.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(x => xmlUnesc(x[1])).join("");
    else if (t === "str" || t === "e") value = vRaw != null ? xmlUnesc(vRaw) : "";
    else if (t === "b") value = vRaw === "1";
    else if (vRaw != null && vRaw !== "") value = Number(vRaw);
    const fText = /<f(?:\s[^>]*)?>([\s\S]*?)<\/f>/.exec(inner)?.[1];
    cells.set(col + row, { col: colNum(col), row: +row, value, formula: /<f[\s>/]/.test(inner), fText: fText ? xmlUnesc(fText) : null });
  }
  return cells;
}
const txt = v => (v == null ? "" : String(v)).trim();

/* ---------- 월 시트 구조 읽기 ---------- */
// 반환: [{ date, col, dateRow, taskRows:[r...], sumRow, noteRows:{확언:r..}, gratRows:[r...], tasks, sum, gratitude, notes }]
export async function readMonth(wb, month) {
  const name = MONTH_SHEET(month);
  const path = await sheetXml(wb, name);
  const cells = parseCells(wb.cache[path], wb.sst);
  const get = (c, r) => cells.get(addr(c, r))?.value ?? null;

  // 날짜 행: B열에 수식으로 계산된 날짜 시리얼이 있는 행
  const maxRow = Math.max(...[...cells.values()].map(c => c.row));
  const dateRows = [];
  for (let r = 1; r <= maxRow; r++) {
    const c = cells.get(addr(2, r));
    if (c && c.formula && typeof c.value === "number" && c.value > 40000) dateRows.push(r);
  }

  const days = [];
  dateRows.forEach((r0, i) => {
    const rEnd = i + 1 < dateRows.length ? dateRows[i + 1] - 1 : maxRow;
    // 행 라벨(A열, 병합 고려해서 위에서 이어받음)
    let label = "";
    const rowLabel = {};
    for (let r = r0 + 1; r <= rEnd; r++) { const a = txt(get(1, r)).replace(/\s/g, ""); if (a) label = a; rowLabel[r] = label; }

    for (const c of DAY_COLS) {
      const serial = get(c, r0);
      if (typeof serial !== "number") continue;
      const date = serialToISO(serial);
      if (+date.slice(5, 7) !== month) continue; // 앞뒤 달 날짜는 그 달 시트에서 관리
      const day = { date, sheet: name, col: c, dateRow: r0, taskRows: [], sumRow: null, noteRows: {}, gratRows: [], tasks: [], sum: null, gratitude: [], notes: [] };
      for (let r = r0 + 1; r <= rEnd; r++) {
        const st = txt(get(c, r)), lab = rowLabel[r];
        if (/합계/.test(st)) { day.sumRow = r; day.sum = { goal: get(c + 2, r), actual: get(c + 3, r) }; continue; }
        if (lab === "감사일기") { day.gratRows.push(r); continue; }
        if (NOTE_LABELS.includes(lab)) { day.noteRows[lab] = r; continue; }
        if (!day.sumRow && (lab === "원씽" || lab.startsWith("목표"))) day.taskRows.push({ row: r, one: lab === "원씽" });
      }
      // 합계 수식(SUM(D11:D18) 등)에 들어가지 않는 줄은 적어도 합계에 안 잡히므로 입력 칸에서 제외
      const sumF = day.sumRow && cells.get(addr(c + 2, day.sumRow))?.fText;
      const sm = sumF && /SUM\(\$?[A-Z]+\$?(\d+):\$?[A-Z]+\$?(\d+)\)/i.exec(sumF);
      if (sm) { const lo = +sm[1], hi = +sm[2]; day.taskRows = day.taskRows.filter(t => t.row >= lo && t.row <= hi); }
      day.tasks = day.taskRows.map(({ row, one }) => ({
        row, one,
        name: txt(get(c + 1, row)),
        goal: num(get(c + 2, row)),
        actual: num(get(c + 3, row)),
      }));
      day.gratitude = day.gratRows.map(r => txt(get(c + 1, r)));
      day.notes = Object.entries(day.noteRows).map(([k, r]) => ({ k, row: r, v: txt(get(c, r)) }));
      days.push(day);
    }
  });
  days.sort((a, b) => a.date.localeCompare(b.date));
  return days;
}
const num = v => (typeof v === "number" ? v : null);

// 월 시트 상단(숨김 행)의 이번 달 합계 K2, 누적 투자시간 K4 (엑셀이 마지막으로 계산한 값)
export async function readSummary(wb, month) {
  const path = await sheetXml(wb, MONTH_SHEET(month));
  const cells = parseCells(wb.cache[path], wb.sst);
  return { monthTotal: num(cells.get("K2")?.value), cumulative: num(cells.get("K4")?.value) };
}

export const hasMonth = (wb, month) => !!wb.sheets[MONTH_SHEET(month)];

/* ---------- 셀 쓰기 (XML 부분 수정) ---------- */
function cellXml(ref, style, value) {
  const s = style ? ` s="${style}"` : "";
  if (value == null || value === "") return `<c r="${ref}"${s}/>`;
  if (typeof value === "number") return `<c r="${ref}"${s}><v>${value}</v></c>`;
  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${xmlEsc(value)}</t></is></c>`;
}

function setCell(xml, ref, value) {
  const re = new RegExp(`<c r="${ref}"([^>]*?)(?:/>|>([\\s\\S]*?)</c>)`);
  const m = re.exec(xml);
  if (m) {
    if (/<f[\s>/]/.test(m[2] || "")) throw new Error(`${ref}는 수식 칸이라 덮어쓰지 않아요`);
    const style = /\bs="(\d+)"/.exec(m[1])?.[1];
    return xml.slice(0, m.index) + cellXml(ref, style, value) + xml.slice(m.index + m[0].length);
  }
  // 셀이 없으면 행 안에 열 순서에 맞게 끼워 넣기
  const [, col, row] = /^([A-Z]+)(\d+)$/.exec(ref);
  const rowRe = new RegExp(`<row r="${row}"[^>]*?(?:/>|>([\\s\\S]*?)</row>)`);
  const rm = rowRe.exec(xml);
  if (!rm) throw new Error(`${row}행을 찾을 수 없어요`);
  const target = colNum(col);
  const rowXml = rm[0];
  if (rowXml.endsWith("/>")) {
    const opened = rowXml.slice(0, -2) + ">" + cellXml(ref, null, value) + "</row>";
    return xml.slice(0, rm.index) + opened + xml.slice(rm.index + rowXml.length);
  }
  let insertAt = rowXml.lastIndexOf("</row>");
  for (const cm of rowXml.matchAll(/<c r="([A-Z]+)\d+"/g)) {
    if (colNum(cm[1]) > target) { insertAt = cm.index; break; }
  }
  const newRow = rowXml.slice(0, insertAt) + cellXml(ref, null, value) + rowXml.slice(insertAt);
  return xml.slice(0, rm.index) + newRow + xml.slice(rm.index + rowXml.length);
}

// patch: { tasks: [{name, goal, actual}], gratitude: [str], notes: {확언: str, ...} }
// tasks 배열 길이는 엑셀 칸 수까지만 반영. 남는 칸은 비움.
export async function writeDay(wb, day, patch) {
  const path = await sheetXml(wb, day.sheet);
  let xml = wb.cache[path];
  const c = day.col;
  if (patch.tasks) {
    if (patch.tasks.length > day.taskRows.length) throw new Error(`이 날은 목표를 최대 ${day.taskRows.length}개까지 적을 수 있어요`);
    day.taskRows.forEach(({ row }, i) => {
      const t = patch.tasks[i] || {};
      xml = setCell(xml, addr(c + 1, row), t.name || "");
      xml = setCell(xml, addr(c + 2, row), isNum(t.goal) ? t.goal : "");
      xml = setCell(xml, addr(c + 3, row), isNum(t.actual) ? t.actual : "");
    });
  }
  if (patch.gratitude) {
    if (patch.gratitude.length > day.gratRows.length) throw new Error(`감사일기는 최대 ${day.gratRows.length}개예요`);
    day.gratRows.forEach((row, i) => { xml = setCell(xml, addr(c + 1, row), patch.gratitude[i] || ""); });
  }
  if (patch.notes) {
    for (const [k, v] of Object.entries(patch.notes)) {
      const row = day.noteRows[k];
      if (row) xml = setCell(xml, addr(c, row), v || "");
    }
  }
  wb.cache[path] = xml;
  wb.dirty.add(path);
}
const isNum = v => typeof v === "number" && isFinite(v);

/* ---------- 저장 ---------- */
export async function saveWorkbook(wb, type = "uint8array") {
  for (const path of wb.dirty) wb.zip.file(path, wb.cache[path]);
  if (wb.dirty.size) {
    // 수식 결과(v/실패, 달성률, 합계, 누적시간)를 엑셀이 열 때 다시 계산하도록 표시
    let w = await wb.zip.file("xl/workbook.xml").async("string");
    w = w.replace(/<calcPr\b([^>]*?)\/>/, (m, a) => /fullCalcOnLoad/.test(a) ? m : `<calcPr${a} fullCalcOnLoad="1"/>`);
    wb.zip.file("xl/workbook.xml", w);
  }
  return wb.zip.generateAsync({ type, compression: "DEFLATE", compressionOptions: { level: 6 } });
}

/* ---------- 앱이 직접 계산하는 값 (엑셀 수식과 같은 규칙) ---------- */
export function derive(task) {
  if (!isNum(task.actual)) return { status: "", rate: null };
  const rate = isNum(task.goal) && task.goal > 0 ? task.actual / task.goal : 0;
  return { status: task.actual >= (task.goal ?? 0) ? "v" : "실패", rate };
}
export function dayTotals(tasks) {
  const goal = tasks.reduce((s, t) => s + (isNum(t.goal) ? t.goal : 0), 0);
  const actual = tasks.reduce((s, t) => s + (isNum(t.actual) ? t.actual : 0), 0);
  return { goal, actual, rate: goal > 0 ? actual / goal : null };
}
