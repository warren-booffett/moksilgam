/* 목실감 – 목표·실천·감사 개인 기록 PWA
 * 데이터는 localStorage에만 저장 (서버 없음).
 * 구조: { "YYYY-MM-DD": { goal, action, thanks, updatedAt } }
 */
(() => {
  'use strict';

  const STORAGE_KEY = 'moksilgam:v1';
  const BACKUP_KEY = 'moksilgam:lastBackup';
  const FIELDS = ['goal', 'action', 'thanks'];
  const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

  const $ = (id) => document.getElementById(id);

  // ---------- 날짜 유틸 (로컬 시간 기준) ----------
  const toKey = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const fromKey = (k) => {
    const [y, m, d] = k.split('-').map(Number);
    return new Date(y, m - 1, d);
  };
  const addDays = (k, n) => {
    const d = fromKey(k);
    d.setDate(d.getDate() + n);
    return toKey(d);
  };
  const todayKey = () => toKey(new Date());
  const formatKey = (k) => {
    const d = fromKey(k);
    return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')} (${WEEKDAYS[d.getDay()]})`;
  };

  // ---------- 저장소 (에러 시에도 앱은 동작) ----------
  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (e) {
      console.error('불러오기 실패', e);
      return {};
    }
  }
  function persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      return true;
    } catch (e) {
      console.error('저장 실패', e);
      toast('⚠️ 저장에 실패했어요. 저장 공간이나 비공개 모드를 확인해주세요.');
      return false;
    }
  }

  let data = load();
  let current = todayKey();

  const hasContent = (e) => !!e && FIELDS.some((f) => (e[f] || '').trim());

  // ---------- 연속 기록일 ----------
  function calcStreak() {
    // 오늘 아직 안 썼으면 어제부터 계산 (오늘 쓰기 전에 스트릭이 0으로 보이지 않게)
    let k = todayKey();
    if (!hasContent(data[k])) k = addDays(k, -1);
    let n = 0;
    while (hasContent(data[k])) {
      n++;
      k = addDays(k, -1);
    }
    return n;
  }
  function calcBestStreak(keys) {
    let best = 0, run = 0, prev = null;
    for (const k of keys) {
      run = prev && addDays(prev, 1) === k ? run + 1 : 1;
      best = Math.max(best, run);
      prev = k;
    }
    return best;
  }

  // ---------- 기록 화면 ----------
  function renderWrite() {
    $('dateLabel').textContent = current === todayKey() ? `오늘 · ${formatKey(current)}` : formatKey(current);
    $('datePicker').value = current;
    $('datePicker').max = todayKey();
    $('nextDay').disabled = current >= todayKey();
    const e = data[current] || {};
    FIELDS.forEach((f) => {
      $(f).value = e[f] || '';
      autosize($(f));
    });
    $('savedMsg').textContent = e.updatedAt ? `저장됨 ${new Date(e.updatedAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}` : '';
    $('streakNum').textContent = calcStreak();
  }

  let saveTimer = null;
  function onInput(ev) {
    autosize(ev.target);
    $('savedMsg').textContent = '입력 중…';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveCurrent, 400);
  }
  function saveCurrent() {
    clearTimeout(saveTimer);
    const entry = {};
    FIELDS.forEach((f) => (entry[f] = $(f).value));
    if (hasContent(entry)) {
      entry.updatedAt = Date.now();
      data[current] = entry;
    } else {
      delete data[current];
    }
    if (persist()) {
      $('savedMsg').textContent = entry.updatedAt ? '저장됨' : '';
      $('streakNum').textContent = calcStreak();
    }
  }

  function autosize(el) {
    el.style.height = 'auto';
    el.style.height = `${Math.max(72, el.scrollHeight)}px`;
  }

  function goTo(k) {
    saveCurrent();
    if (k > todayKey()) k = todayKey();
    current = k;
    renderWrite();
  }

  // ---------- 카톡 공유용 텍스트 ----------
  function buildShareText(k) {
    const e = data[k] || {};
    const block = (title, v) => `${title}\n${(v || '').trim() || '-'}`;
    return [
      `[목실감] ${formatKey(k)}`,
      '',
      block('🎯 목표', e.goal),
      '',
      block('✅ 실천', e.action),
      '',
      block('🙏 감사', e.thanks),
    ].join('\n');
  }
  async function share() {
    saveCurrent();
    const text = buildShareText(current);
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        fallbackCopy(text);
      }
      toast('복사했어요. 카톡에 붙여넣기 하세요.');
    } catch (e) {
      // 클립보드 권한 거부 시: 공유 시트 → 그것도 안 되면 수동 복사
      if (navigator.share) {
        try { await navigator.share({ text }); return; } catch (_) { /* 사용자가 취소 */ }
      }
      fallbackCopy(text);
      toast('복사했어요.');
    }
  }
  function fallbackCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }

  // ---------- 지난 기록 ----------
  function renderHistory() {
    const keys = Object.keys(data).filter((k) => hasContent(data[k])).sort();
    const thisMonth = todayKey().slice(0, 7);
    $('stats').innerHTML = `
      <div class="stat"><b>${calcStreak()}</b><span>연속 기록</span></div>
      <div class="stat"><b>${calcBestStreak(keys)}</b><span>최장 연속</span></div>
      <div class="stat"><b>${keys.filter((k) => k.startsWith(thisMonth)).length}</b><span>이번 달</span></div>`;

    const list = $('historyList');
    list.textContent = '';
    $('historyEmpty').hidden = keys.length > 0;
    keys.reverse().forEach((k) => {
      const e = data[k];
      const li = document.createElement('li');
      const date = document.createElement('div');
      date.className = 'h-date';
      date.textContent = formatKey(k);
      const preview = document.createElement('div');
      preview.className = 'h-preview';
      preview.textContent = (e.goal || e.action || e.thanks || '').trim().split('\n')[0];
      li.append(date, preview);
      li.addEventListener('click', () => {
        current = k;
        switchView('viewWrite');
      });
      list.appendChild(li);
    });
  }

  // ---------- 백업 ----------
  function exportData() {
    saveCurrent();
    const blob = new Blob([JSON.stringify({ app: 'moksilgam', version: 1, exportedAt: new Date().toISOString(), entries: data }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `moksilgam-backup-${todayKey()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    try { localStorage.setItem(BACKUP_KEY, String(Date.now())); } catch (_) {}
    renderSettings();
    toast('백업 파일을 저장했어요.');
  }

  async function importData(file) {
    try {
      const json = JSON.parse(await file.text());
      const entries = json && json.entries && typeof json.entries === 'object' ? json.entries : json;
      const valid = Object.entries(entries).filter(([k, v]) => /^\d{4}-\d{2}-\d{2}$/.test(k) && v && typeof v === 'object');
      if (!valid.length) throw new Error('유효한 기록이 없음');
      // 병합: 같은 날짜는 더 최근에 수정된 쪽을 유지
      let added = 0;
      for (const [k, v] of valid) {
        const clean = { updatedAt: Number(v.updatedAt) || 0 };
        FIELDS.forEach((f) => (clean[f] = typeof v[f] === 'string' ? v[f] : ''));
        if (!data[k] || (data[k].updatedAt || 0) < clean.updatedAt) {
          data[k] = clean;
          added++;
        }
      }
      persist();
      renderWrite();
      toast(`${added}일치 기록을 불러왔어요.`);
    } catch (e) {
      console.error(e);
      toast('⚠️ 백업 파일을 읽지 못했어요.');
    }
  }

  function renderSettings() {
    let last = null;
    try { last = localStorage.getItem(BACKUP_KEY); } catch (_) {}
    $('lastBackup').textContent = last ? `마지막 백업: ${new Date(Number(last)).toLocaleString('ko-KR')}` : '아직 백업한 적이 없어요.';
  }

  // ---------- 탭 / 토스트 ----------
  function switchView(id) {
    if (id !== 'viewWrite') saveCurrent();
    document.querySelectorAll('.view').forEach((v) => (v.hidden = v.id !== id));
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === id));
    if (id === 'viewWrite') renderWrite();
    if (id === 'viewHistory') renderHistory();
    if (id === 'viewSettings') renderSettings();
    window.scrollTo(0, 0);
  }

  let toastTimer = null;
  function toast(msg) {
    const el = $('toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.hidden = true), 2200);
  }

  // ---------- 이벤트 연결 ----------
  FIELDS.forEach((f) => $(f).addEventListener('input', onInput));
  $('prevDay').addEventListener('click', () => goTo(addDays(current, -1)));
  $('nextDay').addEventListener('click', () => goTo(addDays(current, 1)));
  $('dateLabel').addEventListener('click', () => {
    const p = $('datePicker');
    if (p.showPicker) { try { p.showPicker(); return; } catch (_) {} }
    p.focus();
    p.click();
  });
  $('datePicker').addEventListener('change', (e) => e.target.value && goTo(e.target.value));
  $('shareBtn').addEventListener('click', share);
  $('exportBtn').addEventListener('click', exportData);
  $('importInput').addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    if (f) importData(f);
    e.target.value = '';
  });
  document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => switchView(t.dataset.view)));

  // 앱이 백그라운드로 갈 때 즉시 저장
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') saveCurrent();
    // 자정을 넘겨 다시 열었을 때 '오늘'로 이동
    else if (current < todayKey() && !hasContent(data[current])) goTo(todayKey());
  });

  renderWrite();

  // ---------- 오프라인 지원 ----------
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW 등록 실패', e));
    });
  }
})();
