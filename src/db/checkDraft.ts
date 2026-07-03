// Persist an in-progress 2/10-day check (task sign-offs + field values) per aircraft+kind,
// so a mechanic who leaves the page and comes back resumes where they left off.
// Uses the portable secureStore wrapper (Keychain on native, localStorage on web).
import * as store from '../api/secureStore';

const key = (reg: string, kind: string) => `chkdraft:${reg}:${kind}`;

export async function saveCheckDraft(reg: string, kind: string, data: any): Promise<void> {
  try { await store.setItem(key(reg, kind), JSON.stringify(data)); } catch {}
}
export async function loadCheckDraft(reg: string, kind: string): Promise<any | null> {
  try { const v = await store.getItem(key(reg, kind)); return v ? JSON.parse(v) : null; } catch { return null; }
}
export async function clearCheckDraft(reg: string, kind: string): Promise<void> {
  try { await store.deleteItem(key(reg, kind)); } catch {}
}
