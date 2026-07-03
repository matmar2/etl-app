import { uploadAttachment } from '../api/client';
import { db } from './schema';

// Queue a photo locally when offline; flushed by flushAttachments() on sync.
export async function queueAttachment(body: any): Promise<void> {
  const dbc = await db();
  await dbc.runAsync('INSERT OR REPLACE INTO attachments (id, dirty, payload) VALUES (?,1,?)',
    body.id, JSON.stringify(body));
}

export async function flushAttachments(): Promise<number> {
  const dbc = await db();
  const rows = await dbc.getAllAsync<{ id: string; payload: string }>(
    'SELECT id, payload FROM attachments WHERE dirty = 1');
  let sent = 0;
  for (const r of rows) {
    try { await uploadAttachment(JSON.parse(r.payload)); await dbc.runAsync('UPDATE attachments SET dirty = 0 WHERE id = ?', r.id); sent++; }
    catch { /* still offline — leave queued */ }
  }
  return sent;
}
