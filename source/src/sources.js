// 엑셀 파일을 어디서 읽고 어디에 저장할지: OneDrive(정식) 또는 기기에서 직접 연 파일(체험용)
import { PublicClientApplication } from "@azure/msal-browser";
import { CLIENT_ID, AUTHORITY, SCOPES } from "./config.js";

const GRAPH = "https://graph.microsoft.com/v1.0";
const SIMPLE_UPLOAD_LIMIT = 4 * 1024 * 1024;

let msal = null;
export const oneDriveConfigured = () => !!CLIENT_ID;

async function getMsal() {
  if (!msal) {
    msal = new PublicClientApplication({
      auth: { clientId: CLIENT_ID, authority: AUTHORITY, redirectUri: location.origin + location.pathname.replace(/index\.html$/, "") }, // index.html로 열어도 Azure에 등록된 폴더 주소로 맞춤
      cache: { cacheLocation: "localStorage" },
      // 보이지 않는 창으로 조용히 갱신할 때 기다리는 시간 (기본 10초 → 5초). 막혀 있으면 빨리 포기하고 다시 로그인으로 넘어감
      system: { iframeHashTimeout: 5000 },
    });
    await msal.initialize();
    const res = await msal.handleRedirectPromise();
    if (res?.account) msal.setActiveAccount(res.account);
    else if (!msal.getActiveAccount() && msal.getAllAccounts()[0]) msal.setActiveAccount(msal.getAllAccounts()[0]);
  }
  return msal;
}

export async function signedInAccount() {
  if (!oneDriveConfigured()) return null;
  return (await getMsal()).getActiveAccount();
}
// 예전에 쓰던 계정이 있으면 계정 고르기 화면 없이 그 계정으로 바로 진행
export async function signIn() {
  const m = await getMsal(), known = m.getActiveAccount() || m.getAllAccounts()[0];
  await m.loginRedirect(known ? { scopes: SCOPES, loginHint: known.username } : { scopes: SCOPES, prompt: "select_account" });
}
export async function signOut() { const m = await getMsal(); await m.logoutRedirect({ account: m.getActiveAccount() }); }

async function token() {
  const m = await getMsal();
  const account = m.getActiveAccount();
  if (!account) throw needLogin();
  try { return (await m.acquireTokenSilent({ scopes: SCOPES, account })).accessToken; }
  catch (e) {
    // 브라우저 앱(SPA)의 갱신 토큰은 Microsoft 정책상 24시간이라, 그 뒤엔 조용한 갱신이 실패할 수 있음
    // (폰 브라우저가 로그인 창 쿠키를 막는 경우 포함). 여기서는 페이지를 옮기지 않고 알리기만 하고,
    // Microsoft에 다녀올지(reauth)는 화면 쪽에서 정함 (쓰는 도중에 갑자기 화면이 넘어가지 않도록).
    if (!navigator.onLine) throw new Error("인터넷 연결을 확인해 주세요");
    throw needLogin();
  }
}
const needLogin = () => Object.assign(new Error("로그인이 필요해요"), { needLogin: true });

// 같은 계정으로 Microsoft에 다녀오기. '로그인 상태 유지'가 되어 있으면 비밀번호 없이 바로 돌아옴.
// 설정 문제로 무한 반복하지 않도록 자동 호출(auto)은 2분에 한 번만.
export async function reauth({ auto = false } = {}) {
  if (auto) {
    const last = +(sessionStorage.getItem("mok.reauth") || 0);
    if (Date.now() - last < 120000) return false;
    sessionStorage.setItem("mok.reauth", String(Date.now()));
  }
  const m = await getMsal(), account = m.getActiveAccount() || m.getAllAccounts()[0];
  if (!account) await signIn();
  else await m.acquireTokenRedirect({ scopes: SCOPES, account, loginHint: account.username });
  return new Promise(() => {}); // 페이지가 Microsoft로 넘어가는 동안 화면을 그대로 둠
}

async function graph(path, init = {}) {
  const res = await fetch(GRAPH + path, { ...init, headers: { Authorization: `Bearer ${await token()}`, ...(init.headers || {}) } });
  return res;
}
const encPath = p => p.split("/").filter(Boolean).map(encodeURIComponent).join("/");

export function oneDriveSource(filePath) {
  let itemId = null;
  return {
    kind: "onedrive",
    path: filePath,
    label: filePath.split("/").pop(),
    async load() {
      const res = await graph(`/me/drive/root:/${encPath(filePath)}?select=id,name,eTag,size,lastModifiedDateTime,@microsoft.graph.downloadUrl`);
      if (res.status === 404) throw new Error(`OneDrive에서 '${filePath}' 파일을 찾지 못했어요. 설정에서 경로를 확인해 주세요.`);
      if (!res.ok) throw new Error(`OneDrive 파일 정보를 가져오지 못했어요 (${res.status})`);
      const meta = await res.json();
      itemId = meta.id;
      const bin = await fetch(meta["@microsoft.graph.downloadUrl"]);
      if (!bin.ok) throw new Error(`파일을 내려받지 못했어요 (${bin.status})`);
      return { data: await bin.arrayBuffer(), version: meta.eTag, modified: meta.lastModifiedDateTime };
    },
    // version(eTag)이 그사이 바뀌었으면 412 → 호출한 쪽에서 다시 받아서 재적용
    async save(bytes, version) {
      if (bytes.byteLength > SIMPLE_UPLOAD_LIMIT) return uploadLarge(itemId, bytes, version);
      const res = await graph(`/me/drive/items/${itemId}/content`, {
        method: "PUT",
        headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ...(version ? { "If-Match": version } : {}) },
        body: bytes,
      });
      if (res.status === 412) { const e = new Error("conflict"); e.conflict = true; throw e; }
      if (res.status === 423) throw new Error("엑셀에서 파일이 잠겨 있어요. PC나 다른 기기의 엑셀에서 파일을 닫고 다시 저장해 주세요.");
      if (!res.ok) throw new Error(`OneDrive에 저장하지 못했어요 (${res.status})`);
      const meta = await res.json();
      return { version: meta.eTag, modified: meta.lastModifiedDateTime };
    },
  };
}

async function uploadLarge(itemId, bytes, version) {
  const s = await graph(`/me/drive/items/${itemId}/createUploadSession`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(version ? { "If-Match": version } : {}) },
    body: JSON.stringify({ item: { "@microsoft.graph.conflictBehavior": "replace" } }),
  });
  if (s.status === 412) { const e = new Error("conflict"); e.conflict = true; throw e; }
  if (!s.ok) throw new Error(`OneDrive 업로드를 시작하지 못했어요 (${s.status})`);
  const { uploadUrl } = await s.json();
  const CHUNK = 320 * 1024 * 10; // 3.2MB (320KB의 배수)
  let meta = null;
  for (let start = 0; start < bytes.byteLength; start += CHUNK) {
    const end = Math.min(start + CHUNK, bytes.byteLength);
    const r = await fetch(uploadUrl, { method: "PUT", headers: { "Content-Range": `bytes ${start}-${end - 1}/${bytes.byteLength}` }, body: bytes.slice(start, end) });
    if (!r.ok && r.status !== 202) throw new Error(`OneDrive에 저장하지 못했어요 (${r.status})`);
    if (r.status === 200 || r.status === 201) meta = await r.json();
  }
  return { version: meta?.eTag, modified: meta?.lastModifiedDateTime };
}

// 체험용: 기기에서 고른 파일 → 저장하면 수정된 파일을 내려받기
export function localFileSource(file) {
  return {
    kind: "local",
    label: file.name,
    async load() { return { data: await file.arrayBuffer(), version: null, modified: new Date(file.lastModified).toISOString() }; },
    async save(bytes) {
      const blob = new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: file.name });
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      return { version: null, modified: new Date().toISOString() };
    },
  };
}
