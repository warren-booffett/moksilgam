// 날짜 줄(.days)을 마우스로 끌어서 연속으로 스크롤 (터치는 브라우저 기본 스크롤을 그대로 씀).
// 끄는 동안 날짜가 손을 따라 하루 단위로 쭉 흐르고, 놓으면 관성으로 더 흘러간 뒤 날짜 칸에 맞춰 멈춤.
// 드래그 직후의 클릭은 막아서 날짜가 잘못 선택되지 않게 함.

const START = 5;      // 이만큼(px) 움직여야 드래그로 인정 (그 전엔 그냥 클릭)
const TAU = 325;      // 관성 감쇠 시간(ms): 클수록 오래 미끄러짐

// 칸 위치는 번호×칸폭으로 계산하면 안 됨: 브라우저가 칸 폭을 1/64px로 내림해서 수백 칸 뒤엔 몇 px씩 어긋남.
// 그래서 실제 칸 위치를 읽음.
export const cellLeft = (el, k) => {
  const c = el.children[Math.max(0, Math.min(el.children.length - 1, k))];
  return c.getBoundingClientRect().left - el.getBoundingClientRect().left + el.scrollLeft;
};
// 현재 스크롤 위치에서 가장 가까운 칸 번호
export const nearestCell = el => {
  let k = Math.round(el.scrollLeft / (el.clientWidth / 7));
  k = Math.max(0, Math.min(el.children.length - 1, k));
  while (k > 0 && cellLeft(el, k) > el.scrollLeft) k--;
  while (k < el.children.length - 1 && cellLeft(el, k + 1) <= el.scrollLeft) k++;
  return el.scrollLeft - cellLeft(el, k) > (cellLeft(el, k + 1) - cellLeft(el, k)) / 2 ? Math.min(k + 1, el.children.length - 1) : k;
};

export function bindStripDrag() {
  let g = null, raf = 0;

  const strip = () => document.querySelector(".days");
  const stopInertia = () => { cancelAnimationFrame(raf); raf = 0; };
  const swallowClick = () => {
    const stop = e => { e.stopPropagation(); e.preventDefault(); };
    document.addEventListener("click", stop, { capture: true, once: true });
    setTimeout(() => document.removeEventListener("click", stop, { capture: true }), 80);
  };
  // 가장 가까운 날짜 칸에 맞춰 부드럽게 멈춘 뒤 스냅 복구
  const settle = el => {
    el.scrollTo({ left: cellLeft(el, nearestCell(el)), behavior: "smooth" });
    setTimeout(() => el.classList.remove("dragging"), 220);
  };

  document.addEventListener("pointerdown", e => {
    if (e.pointerType !== "mouse" || e.button !== 0 || !e.isPrimary) return; // 터치·펜은 기본 스크롤
    const el = e.target.closest?.(".days");
    if (!el) return;
    stopInertia();
    g = { id: e.pointerId, el, x0: e.clientX, left0: el.scrollLeft, drag: false, v: 0, lx: e.clientX, lt: e.timeStamp };
    el.classList.add("dragging"); // 끄는 동안 스냅 끔 (안 끄면 스냅이 드래그와 싸움)
  });

  document.addEventListener("pointermove", e => {
    if (!g || e.pointerId !== g.id) return;
    if (!g.el.isConnected) g.el = strip(); // 드래그 중 화면이 다시 그려진 경우
    if (!g.el) { g = null; return; }
    const dx = e.clientX - g.x0;
    if (!g.drag) {
      if (Math.abs(dx) < START) return;
      g.drag = true;
      document.documentElement.style.userSelect = "none";
      try { g.el.setPointerCapture(e.pointerId); } catch {}
    }
    const dt = e.timeStamp - g.lt;
    if (dt > 0) g.v = 0.75 * g.v + 0.25 * ((e.clientX - g.lx) / dt); // px/ms, 오른쪽이 +
    g.lx = e.clientX; g.lt = e.timeStamp;
    g.el.scrollLeft = g.left0 - dx;
  });

  const end = e => {
    if (!g || e.pointerId !== g.id) return;
    const s = g; g = null;
    document.documentElement.style.userSelect = "";
    if (!s.el.isConnected) s.el = strip();
    if (!s.el) return;
    try { s.el.releasePointerCapture(s.id); } catch {}
    if (!s.drag) { s.el.classList.remove("dragging"); return; }
    swallowClick();
    // 멈춘 채로 놓았으면 속도 0으로 간주
    let v = e.timeStamp - s.lt > 80 ? 0 : s.v;
    let last = performance.now();
    const step = now => {
      const el = strip();
      if (!el) return;
      const dt = Math.min(now - last, 40); last = now;
      const before = el.scrollLeft;
      el.scrollLeft = before - v * dt;
      v *= Math.exp(-dt / TAU);
      if (Math.abs(v) < 0.03 || el.scrollLeft === before) { raf = 0; settle(el); return; }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
  };
  document.addEventListener("pointerup", end);
  document.addEventListener("pointercancel", end);
}
