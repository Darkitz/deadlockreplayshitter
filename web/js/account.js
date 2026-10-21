// Your account and the players you follow, remembered in this browser only (localStorage).
// Nothing about them is in the site's code or on any server. Changes fire a "dldi-account"
// event on window.

const ME = "dldi.account";
const FOLLOW = "dldi.follow";
const STEAM64_BASE = 76561197960265728n;

const read = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k, v) => {
  try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* storage blocked */ }
  window.dispatchEvent(new Event("dldi-account"));
};

/** SteamID64 or SteamID3 -> account id (string), or null */
export function toAccount(raw) {
  if (!/^\d{1,20}$/.test(String(raw ?? "").trim())) return null;
  const n = BigInt(String(raw).trim());
  const acc = n > 0xffffffffn ? n - STEAM64_BASE : n;
  return acc > 0n && acc <= 0xffffffffn ? String(acc) : null;
}

export const storedAccount = () => read(ME) || null;
/** remember (or with null forget) your account */
export const setStoredAccount = (id) => write(ME, id == null ? null : String(id));

/** account ids you follow, in the order you followed them */
export function followed() {
  try { return (JSON.parse(read(FOLLOW)) || []).map(String); } catch { return []; }
}
export const isFollowed = (id) => followed().includes(String(id));
export function setFollowed(id, on) {
  const list = followed().filter((x) => x !== String(id));
  if (on) list.push(String(id));
  write(FOLLOW, list.length ? JSON.stringify(list) : null);
}

/** you first, then everyone you follow */
export function people() {
  const me = storedAccount();
  return [...new Set([me, ...followed()].filter(Boolean))];
}

/** #/?account=… remembers (or with an empty value forgets) your account; true when it was there */
export function applyAccountParam(params) {
  if (!params.has("account")) return false;
  const raw = params.get("account").trim();
  if (!raw) setStoredAccount(null);
  else if (toAccount(raw)) setStoredAccount(toAccount(raw));
  // keep the id out of the address bar and history
  params.delete("account");
  history.replaceState(null, "", `${location.pathname}${location.search}#/${params.size ? `?${params}` : ""}`);
  return true;
}
