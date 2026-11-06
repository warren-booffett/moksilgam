// 엑셀 파일을 어디서 읽고 어디에 저장할지: OneDrive(정식) 또는 기기에서 직접 연 파일(체험용)
import { PublicClientApplication, InteractionRequiredAuthError } from "@azure/msal-browser";
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
export async function signIn() { await (await getMsal()).loginRedirect({ scopes: SCOPES, prompt: "select_account" }); }
export async function signOut() { const m = await getMsal(); await m.logoutRedirect({ account: m.getActiveAccount() }); }

async function token() {
  const m = await getMsal();
  const account = m.getActiveAccount();
  if (!account) throw new Error("먼저 Microsoft 계정으로 로그인해 주세요");
  try { return (await m.acquireTokenSilent({ scopes: SCOPES, account })).accessToken; }
  catch (e) { if (e instanceof InteractionRequiredAuthError) { await m.acquireTokenRedirect({ scopes: SCOPES }); } throw e; }
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
