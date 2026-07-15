import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { syncPush } from '../api/client';
import { getSector, pullSector, updateSector } from '../db/sectors';
import { theme } from '../theme';
import { confirmAction } from '../util/confirm';

export const hhmm = (iso?: string) => (iso ? new Date(iso).toISOString().slice(11, 16) + 'z' : '—');
// minutes -> h:mm (flight/block hours)
export const hm = (min?: number | null) => (min == null ? '—' : `${Math.floor(min / 60)}:${String(Math.round(min % 60)).padStart(2, '0')}`);
const mins = (a?: string, b?: string) =>
  a && b ? Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000)) : undefined;
export const num = (v: any) => (v === '' || v == null ? null : Number(v));
// Strip anything that isn't a number from an input value. decimals=true keeps a single '.'
// (integer fields pass decimals=false). Use in onChangeText so numeric fields reject letters/paste.
export const numericOnly = (v: string, decimals = true): string => {
  let s = (v || '').replace(decimals ? /[^0-9.]/g : /[^0-9]/g, '');
  if (decimals) {                                   // keep only the first decimal point
    const i = s.indexOf('.');
    if (i >= 0) s = s.slice(0, i + 1) + s.slice(i + 1).replace(/\./g, '');
  }
  return s;
};
// thousands separators for read-only figures (e.g. 12,300 · 1,234.5). Never use on an editable input value.
export const fmt = (v: any) => { const x = Number(v); return (v === '' || v == null || isNaN(x)) ? '' : x.toLocaleString('en-US', { maximumFractionDigits: 1 }); };
// airframe hours (TSN) as H:MM with thousands separators on the hours, e.g. 47,484:58
export const fmtHM = (hours: any) => {
  const x = Number(hours);
  if (hours === '' || hours == null || isNaN(x)) return '—';
  const total = Math.round(x * 60);
  const hh = Math.floor(total / 60), mm = total % 60;
  return hh.toLocaleString('en-US') + ':' + String(mm).padStart(2, '0');
};
const round1 = (x: number) => Math.round(x * 10) / 10;
export { round1 };

const OOOI_LABEL: Record<string, string> = {
  off_block: 'Off Blocks', takeoff: 'Take-off', landing: 'Landed', on_block: 'On Blocks',
};

export function useSector(sectorId: string) {
  const [s, setS] = useState<any>(null);
  const [msg, setMsg] = useState('');

  async function reload() { setS(await getSector(sectorId)); }                 // local (instant)
  async function refresh() { setS(await pullSector(sectorId)); }               // pull-on-open (server-authoritative)
  useEffect(() => { reload(); refresh(); }, [sectorId]);

  async function save(patch: any) {
    const next = await updateSector(sectorId, patch);
    setS(next); setMsg('Saved');
    syncPush().then(() => setMsg('Saved ✓ synced')).catch(() => setMsg('Saved · offline (queued)'));
  }
  async function setTime(field: string, iso: string) {
    const n = { ...s, [field]: iso };
    await save({ [field]: iso, block_time_min: mins(n.off_block, n.on_block), flight_time_min: mins(n.takeoff, n.landing) });
  }
  const stamp = (f: string) => setTime(f, new Date().toISOString());
  function setManual(field: string, t: string) {
    const m = /^(\d{1,2}):?(\d{2})$/.exec(t.trim());
    if (!m || !s) return;
    const date = s.flight_date || new Date().toISOString().slice(0, 10);
    setTime(field, `${date}T${m[1].padStart(2, '0')}:${m[2]}:00Z`);
  }
  // Clear an OOOI time (e.g. return-to-stand: clear Off-blocks and re-stamp on the next push-back).
  async function clearTime(field: string) {
    if (!s) return;
    const n = { ...s, [field]: null };
    await save({ [field]: null, block_time_min: mins(n.off_block, n.on_block), flight_time_min: mins(n.takeoff, n.landing) });
  }
  return { s, msg, save, stamp, setManual, clearTime, reload, refresh };
}

// Schedule / ETA: ETA = STA shifted by the departure delay (actual off-block vs STD).
export function schedule(s: any): { sta?: string; eta?: string; delayMin: number; arrived: boolean } {
  if (!s?.sta) return { delayMin: 0, arrived: !!s?.on_block };
  const sta = new Date(s.sta).getTime();
  let delayMs = 0;
  if (s.std && s.off_block) delayMs = Math.max(0, new Date(s.off_block).getTime() - new Date(s.std).getTime());
  return { sta: s.sta, eta: s.on_block || new Date(sta + delayMs).toISOString(), delayMin: Math.round(delayMs / 60000), arrived: !!s.on_block };
}

export function NumField({ label, value, onChange, bad, onLayout, decimals = true }: any) {
  return (
    <View style={styles.field} onLayout={onLayout}>
      <Text style={styles.lbl}>{label}</Text>
      <TextInput style={[styles.input, bad ? { borderColor: '#d7263d', borderWidth: 2 } : null]} value={value == null ? '' : String(value)}
        keyboardType="decimal-pad" inputMode={decimals ? 'decimal' : 'numeric'}
        onChangeText={(v) => onChange(numericOnly(v, decimals))} />
    </View>
  );
}

// OOOI stamp tiles + manual inputs for the given fields.
export function OOOISection({ s, fields, stamp, setManual, clear, disabled }: any) {
  return (
    <>
      <View style={styles.oooiRow}>
        {fields.map((f: string) => (
          <TouchableOpacity key={f} style={[styles.oooiBtn, disabled && { opacity: 0.4 }]} disabled={disabled} onPress={() => stamp(f)}
            onLongPress={!disabled && clear ? async () => { if (await confirmAction(`Clear ${OOOI_LABEL[f]} time?\n(e.g. delay / return to stand — re-stamp on the next push-back)`)) clear(f); } : undefined}>
            <Text style={styles.oooiLbl}>{OOOI_LABEL[f]}</Text>
            <Text style={styles.oooiVal}>{hhmm(s[f])}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <View style={styles.oooiRow}>
        {fields.map((f: string) => (
          <TextInput key={`${f}-${s[f]}`} style={[styles.oooiInput, disabled && { opacity: 0.4 }]} editable={!disabled} keyboardType="numbers-and-punctuation"
            defaultValue={s[f] ? hhmm(s[f]).replace('z', '') : ''} placeholder="hh:mm" placeholderTextColor={theme.sub}
            onEndEditing={(e) => setManual(f, e.nativeEvent.text)} />
        ))}
      </View>
      {!disabled ? <Text style={styles.sub}>Tap to stamp now{clear ? ' · long-press to clear (return to stand)' : ''} · or type the UTC time to correct.</Text> : null}
    </>
  );
}

export const sx = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.bg },
  title: { color: theme.text, fontSize: 20, fontWeight: '800' },
  sub: { color: theme.sub, marginTop: 4 },
  msg: { color: theme.green, marginTop: 6 },
  // modern section header — uppercase label with a hairline divider
  section: { color: theme.text, fontWeight: '800', fontSize: 13, letterSpacing: 1.2, textTransform: 'uppercase',
    marginTop: 22, marginBottom: 10, paddingBottom: 6, borderBottomWidth: 1, borderBottomColor: theme.border },
  // grouped content panel
  card: { backgroundColor: theme.panel, borderWidth: 1, borderColor: theme.border, borderRadius: 12, padding: 14, marginTop: 2 },
  subhead: { color: theme.sub, fontSize: 11, fontWeight: '800', letterSpacing: 0.6, textTransform: 'uppercase', marginTop: 6, marginBottom: 8 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginVertical: 6, maxWidth: 320 },
  save: { borderRadius: 8, padding: 13, alignItems: 'center', marginTop: 10, maxWidth: 360, backgroundColor: theme.green },
  saveText: { color: '#fff', fontWeight: '700' },
});

const styles = StyleSheet.create({
  field: { width: 150, marginBottom: 10 },
  lbl: { color: theme.sub, fontSize: 12, marginBottom: 4 },
  input: { backgroundColor: theme.tile, color: theme.text, borderWidth: 1, borderColor: theme.border, borderRadius: 8, padding: 10 },
  sub: { color: theme.sub, marginTop: 4 },
  oooiRow: { flexDirection: 'row', gap: 10, marginTop: 4 },
  oooiBtn: { flex: 1, maxWidth: 210, backgroundColor: theme.tile, borderWidth: 1, borderColor: theme.border, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 12, alignItems: 'center' },
  oooiLbl: { color: theme.sub, fontSize: 12 },
  oooiVal: { color: theme.text, fontWeight: '800', fontSize: 16, marginTop: 2 },
  oooiInput: { flex: 1, maxWidth: 210, backgroundColor: theme.tile, color: theme.text, borderWidth: 1, borderColor: theme.border, borderRadius: 8, padding: 8, textAlign: 'center' },
});
