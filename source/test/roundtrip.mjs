// 사용법: node test/roundtrip.mjs <원본.xlsx> <결과.xlsx> <비교용 nov.json>
import fs from "node:fs";
import JSZip from "jszip";
import { openWorkbook, readMonth, writeDay, saveWorkbook } from "../src/workbook.js";

const [src, out, ref] = process.argv.slice(2);
const wb = await openWorkbook(JSZip, fs.readFileSync(src));
const days = await readMonth(wb, 11);

// 1) 읽기 검증: 엑셀 COM으로 뽑은 값과 비교
const expected = JSON.parse(fs.readFileSync(ref, "utf8").replace(/^﻿/, ""));
let mismatch = 0;
for (const e of expected) {
  const d = days.find(x => x.date === e.date);
  if (!d) { console.log("MISSING", e.date); mismatch++; continue; }
  const eg = [].concat(e.gratitude || []);
  const et = [].concat(e.tasks || []);
  const gotT = d.tasks.filter(t => t.name);
  const gotG = d.gratitude.filter(Boolean);
  if (gotG.join("|") !== eg.join("|")) { console.log("GRAT DIFF", e.date); mismatch++; }
  if (gotT.map(t => t.name).join("|") !== et.map(t => t.name).join("|")) { console.log("TASK DIFF", e.date, gotT.map(t => t.name), et.map(t => t.name)); mismatch++; }
  et.forEach((t, i) => { const g = gotT[i]; if (g && ((g.actual ?? null) !== (t.actual ?? null) || (g.goal ?? null) !== (t.goal ?? null))) { console.log("NUM DIFF", e.date, t.name, g, t); mismatch++; } });
}
console.log(`days=${days.length} taskRows(11/5)=${days.find(d => d.date === "2026-11-05").taskRows.length} gratRows=${days[0].gratRows.length} mismatches=${mismatch}`);

// 2) 쓰기: 11/5 목표 수정 + 감사일기 입력 (테스트용 값)
const d5 = days.find(d => d.date === "2026-11-05");
const tasks = d5.tasks.filter(t => t.name).map(t => ({ name: t.name, goal: t.goal, actual: t.actual }));
tasks[2].actual = 0.5;          // 독서 30분
tasks[4].actual = 0.25;         // 재테입 활동 15분
tasks.push({ name: "앱 테스트 <&> \"따옴표\"", goal: 1, actual: 1.5 });
await writeDay(wb, d5, { tasks, gratitude: ["테스트 감사 1", "테스트 감사 2 & <특수문자>"] });
fs.writeFileSync(out, await saveWorkbook(wb, "nodebuffer"));

// 3) 다시 열어서 값 확인
const wb2 = await openWorkbook(JSZip, fs.readFileSync(out));
const d5b = (await readMonth(wb2, 11)).find(d => d.date === "2026-11-05");
console.log("after:", JSON.stringify(d5b.tasks.map(t => [t.name, t.goal, t.actual])), JSON.stringify(d5b.gratitude));
