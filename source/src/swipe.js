// 주간 날짜 줄(.week)을 마우스 드래그·터치 스와이프로 넘기기.
// 손가락/마우스를 따라 줄이 움직이고, 충분히 끌거나 빠르게 튕기면 한 주 이동, 아니면 제자리로 돌아감.
// 왼쪽으로 끌면 다음 주, 오른쪽으로 끌면 지난주. 드래그 직후의 클릭은 막아서 날짜가 잘못 눌리지 않게 함.
//
// bindWeekSwipe({ canShift(dir) → boolean, shift(dir) → Promise<boolean> })  dir: -1 지난주, +1 다음주

const START = 8;        // 이만큼(px) 움직여야 드래그로 인정 (그 전엔 그냥 탭/클릭)
const FLICK = 0.45;     // 튕기기 속도(px/ms)
const MIN_FLICK_DX = 24; // 튕기기로 인정할 최소 이동(px)
const EXIT_MS = 140;

export function bindWeekSwipe({ canShift, shift }) {
  let g = null;
  let busy = false; // 이동 애니메이션 중에는 새 드래그를 받지 않음

  const weekEl = () => document.querySelector(".week");
  const live = () => {
    if (!g.el.isConnected) g.el = weekEl(); // 드래그 중 화면이 다시 그려진 경우
    return g.el;
  };
  const reset = () => {
    if (g?.el) { g.el.classList.remove("dragging"); g.el.style.transform = ""; g.el.style.transition = ""; }
    document.documentElement.style.userSelect = "";
    g = null;
  };
  const swallowClick = () => {
    const stop = e => { e.stopPropagation(); e.preventDefault(); };
    document.addEventListener("click", stop, { capture: true, once: true });
    setTimeout(() => document.removeEventListener("click", stop, { capture: true }), 80);
  };

  document.addEventListener("pointerdown", e => {
    if (busy || g || !e.isPrimary || (e.pointerType === "mouse" && e.button !== 0)) return;
    const el = e.target.closest?.(".week");
    if (!el) return;
    g = { id: e.pointerId, el, x0: e.clientX, y0: e.clientY, dx: 0, drag: false, vx: 0, lx: e.clientX, lt: e.timeStamp };
  });

  document.addEventListener("pointermove", e => {
    if (!g || e.pointerId !== g.id) return;
    const dx = e.clientX - g.x0, dy = e.clientY - g.y0;
    if (!g.drag) {
      if (Math.abs(dx) < START && Math.abs(dy) < START) return;
      if (Math.abs(dy) > Math.abs(dx)) { g = null; return; } // 세로 스크롤은 그대로 둠
      g.drag = true;
      g.el.classList.add("dragging");
      document.documentElement.style.userSelect = "none";
      try { g.el.setPointerCapture(e.pointerId); } catch {}
    }
    const el = live();
    if (!el) return reset();
    // 최근 속도 (튕기기 판정용)
    const dt = e.timeStamp - g.lt;
    if (dt > 0) g.vx = 0.8 * g.vx + 0.2 * ((e.clientX - g.lx) / dt);
    g.lx = e.clientX; g.lt = e.timeStamp;
    g.dx = dx;
    // 더 갈 수 없는 쪽(해가 바뀌는 주)은 고무줄처럼 뻑뻑하게
    const dir = dx < 0 ? 1 : -1;
    el.style.transform = `translateX(${canShift(dir) ? dx : dx * 0.25}px)`;
  });

  async function finish(e, cancelled) {
    if (!g || e.pointerId !== g.id) return;
    const s = g;
    if (!s.drag) { g = null; return; }
    swallowClick();
    const el = live();
    if (!el) return reset();
    try { el.releasePointerCapture(s.id); } catch {}
    const w = el.clientWidth || 320, dir = s.dx < 0 ? 1 : -1;
    const commit = !cancelled && canShift(dir) &&
      (Math.abs(s.dx) > Math.min(70, w * 0.2) || (Math.abs(s.vx) > FLICK && Math.abs(s.dx) > MIN_FLICK_DX));
    busy = true;
    el.classList.remove("dragging");
    el.style.transition = `transform ${EXIT_MS}ms ease-out`;
    try {
      if (commit) {
        const out = -dir * w;
        el.style.transform = `translateX(${out}px)`;
        await new Promise(r => setTimeout(r, EXIT_MS));
        reset();
        if (await shift(dir)) { // 새 주가 반대쪽에서 들어옴
          weekEl()?.animate([{ transform: `translateX(${-out}px)`, opacity: 0.2 }, { transform: "translateX(0)", opacity: 1 }], { duration: 180, easing: "ease-out" });
        }
      } else {
        el.style.transform = "translateX(0)";
        await new Promise(r => setTimeout(r, EXIT_MS));
        reset();
      }
    } finally { busy = false; }
  }
  document.addEventListener("pointerup", e => finish(e, false));
  document.addEventListener("pointercancel", e => finish(e, true));
}
