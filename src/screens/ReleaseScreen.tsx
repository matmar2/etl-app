import React, { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { aircraftStatus, can, CheckStatus, Correction, currentAircraft, DefectBrief, listCorrections, MfaRequired, raiseCorrection, ReleaseStatus, releaseSector, releaseStatus, requestCrsReset, sectorDetail, sectorTlHtml } from '../api/client';
import { finalizeServiceable } from '../util/finalize';
import RoBanner from '../components/RoBanner';
import { getSector, localReleaseStatus, markLocalReleased } from '../db/sectors';
import { getSectorDefects } from '../db/defects';
import { airPrint, bluetoothAvailable, bluetoothPrint, printHtml, shareHtml, sharePdf } from '../print';
import SignaturePad from '../components/SignaturePad';
import { theme } from '../theme';

// Assemble the TL from the server, or fall back to the local cache when offline.
async function tlData(sectorId: string) {
  try { return await sectorDetail(sectorId); }
  catch {
    const sector = await getSector(sectorId);
    const defects = await getSectorDefects(sectorId);
    return { sector, aircraft: { registration: sector?.aircraft_id }, defects, signatures: [] };
  }
}

const KIND: Record<string, string> = {
  nil: 'NIL DEFECT', deferred: 'Deferred (MEL/HIL)', rectified: 'Defect rectified', with_defects: 'Released with defects',
};

export default function ReleaseScreen({ route, navigation }: any) {
  const { sectorId } = route.params;
  const [st, setSt] = useState<ReleaseStatus | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [finalize, setFinalize] = useState<{ frac: number; label: string } | null>(null);   // post-release progress
  const [signing, setSigning] = useState(false);     // signature pad open
  const [sig, setSig] = useState<string | null>(null);
  const [otp, setOtp] = useState('');
  const [needOtp, setNeedOtp] = useState(false);
  const [signer, setSigner] = useState('');
  const [licence, setLicence] = useState('');
  const [showReset, setShowReset] = useState(false);
  const [resetReason, setResetReason] = useState('');
  const isMech = can('release', 'crs');

  const [checks, setChecks] = useState<CheckStatus[]>([]);
  const [corrections, setCorrections] = useState<Correction[]>([]);
  const [corr, setCorr] = useState({ field: '', new_value: '', reason: '' });
  const [showCorr, setShowCorr] = useState(false);
  const load = useCallback(() => {
    releaseStatus(sectorId).then(setSt)                                    // online → authoritative
      .catch(() => localReleaseStatus(sectorId).then(setSt).catch(() => setMsg('Release page unavailable offline for this sector.')));
    listCorrections(sectorId).then(setCorrections).catch(() => {});
    const reg = currentAircraft()?.registration;
    if (reg) aircraftStatus(reg).then((x) => setChecks(x.checks || [])).catch(() => {});
  }, [sectorId]);

  async function submitCorrection() {
    if (!corr.reason.trim()) { setMsg('Enter a reason for the correction.'); return; }
    try {
      await raiseCorrection(sectorId, { field: corr.field.trim() || undefined, new_value: corr.new_value.trim() || undefined, reason: corr.reason.trim() });
      setCorr({ field: '', new_value: '', reason: '' }); setShowCorr(false); setMsg('Correction raised ✓'); load();
    } catch (e: any) { setMsg(`Failed: ${e.message}`); }
  }
  async function submitResetRequest() {
    if (resetReason.trim().length < 15) { setMsg('Enter a full reason (at least 15 characters) for the CRS reset.'); return; }
    try { await requestCrsReset(sectorId, resetReason.trim()); setResetReason(''); setShowReset(false); setMsg('CRS reset requested — pending CAMO Manager approval.'); load(); }
    catch (e: any) { setMsg(/departed|correction/i.test(e?.message || '') ? 'Aircraft has departed / closed — the CRS cannot be reset. Raise a correction instead.' : (e?.message || 'Could not submit the reset request.')); }
  }
  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Sign first, then submit the release with signature (+ MFA code).
  async function submitRelease(signature: string) {
    setBusy(true); setMsg('');
    try {
      const r: any = await releaseSector(sectorId, {
        note: note.trim() || undefined, signer_name: signer.trim() || undefined,
        licence_no: licence.trim() || undefined, signature_image: signature, otp: otp.trim() || undefined,
      });
      setSig(null); setOtp(''); setNeedOtp(false);
      if (r?.queued) {
        const kind = st?.deferred?.length ? 'deferred' : (st?.serviceable ? 'nil' : 'rectified');
        await markLocalReleased(sectorId, { by: signer.trim() || undefined, kind, note: note.trim() || undefined }).catch(() => {});
        setSt((prev: any) => prev ? { ...prev, released: true, release: { by: signer.trim() || undefined, kind, note: note.trim() || undefined } } : prev);
        setMsg('CRS released offline — will sync when back online ✓');
      } else {
        setMsg(`Released · ${KIND[r.kind] || r.kind}`); load();
      }
      // Walk record→sync→serviceability so the crew see the aircraft cleared for departure.
      setFinalize({ frac: 0.15, label: 'Issuing the CRS…' });
      const reg = currentAircraft()?.registration;
      if (reg) {
        const { status } = await finalizeServiceable(reg, setFinalize, {
          finalLabel: (online, svc) => online
            ? (svc === false ? '✓ Released — deferred item(s) remain on the Hold Item List' : '✓ Released — aircraft cleared for departure')
            : '✓ Released offline — syncs when back online',
        });
        if (status?.checks) setChecks(status.checks);
        setTimeout(() => setFinalize(null), 2800);
      } else { setFinalize(null); }
      Alert.alert('Before leaving the aircraft',
        'Confirm before you leave:\n\n•  all flight-crew iPads are synced\n•  the tech log is backed up to the server (when you reconnect)');
    } catch (e: any) {
      if (e instanceof MfaRequired) { setSig(signature); setNeedOtp(true); setMsg('Enter your authenticator code to release.'); }
      else if (/licen[cs]e/i.test(e.message || '')) { setSig(signature); setMsg(`${e.message}. Correct the licence and release again.`); }   // keep the signature — retry the licence only
      else setMsg(`Failed: ${e.message}`);
    } finally { setBusy(false); }
  }

  async function print(kind: 'air' | 'pdf' | 'bt', doc: 'tl' | 'cabin' | 'hil' = 'tl') {
    try {
      // For the full TL, prefer the server-rendered complete form (carry-over defects,
      // all fields, logo); fall back to the local renderer when offline.
      if (doc === 'tl' && kind !== 'bt') {
        try {
          const { html } = await sectorTlHtml(sectorId);
          if (kind === 'air') return await printHtml(html);
          return await shareHtml(html);
        } catch { /* offline → local render below */ }
      }
      const data = await tlData(sectorId);
      if (kind === 'air') await airPrint(data, doc);
      else if (kind === 'pdf') await sharePdf(data, doc);
      else await bluetoothPrint(data);
    } catch (e: any) { Alert.alert('Print', e.message); }
  }

  if (!st) return <View style={s.wrap}>{msg ? <Text style={s.sub}>{msg}</Text> : <><ActivityIndicator color={theme.accent} /><Text style={s.sub}>Loading…</Text></>}</View>;

  const svc = st.serviceable;
  return (
    <ScrollView style={s.wrap} contentContainerStyle={{ padding: 16, width: '100%', maxWidth: 860, alignSelf: 'center' }} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
      <View style={[s.banner, { backgroundColor: svc ? '#11351d' : '#3a1111', borderColor: svc ? theme.green : theme.red }]}>
        <Text style={[s.bannerTxt, { color: svc ? theme.green : theme.red }]}>
          {svc ? '● AIRCRAFT SERVICEABLE' : '▲ AIRCRAFT UNSERVICEABLE'}
        </Text>
        <Text style={s.sub}>{svc ? 'No defect holds dispatch.' : 'Open technical defect(s) hold the aircraft.'}</Text>
      </View>

      {checks.length ? (
        <View style={{ flexDirection: 'row', gap: 10, marginBottom: 4 }}>
          {checks.map((c) => {
            const pending = !c.baseline;
            const color = (pending || c.expired) ? theme.red : (c.days_left != null && c.days_left <= 1 ? '#ffb84d' : theme.green);
            return (
              <View key={c.kind} style={{ flex: 1, borderWidth: 1, borderColor: color, borderRadius: 8, padding: 10 }}>
                <Text style={{ color: theme.text, fontWeight: '800', fontSize: 13 }}>{c.label}</Text>
                <Text style={{ color, fontSize: 11, marginTop: 2, fontWeight: '700' }}>
                  {pending ? 'Pending — due ASAP' : c.expired ? `OVERDUE · was ${c.due?.slice(0, 10)}` : `Due ${c.due?.slice(0, 10)} · ${c.days_left}d ${c.hours_left != null ? `${Math.round((c.hours_left % 24))}h` : ''} left`}
                </Text>
              </View>
            );
          })}
        </View>
      ) : null}

      <Group title={`Blocking defects (${st.blockers.length})`} items={st.blockers} empty="None"
        color={theme.red} nav={navigation} />
      <Group title={`Deferred · HIL (${st.deferred.length})`} items={st.deferred} empty="None"
        color={theme.accent} nav={navigation} />

      <Text style={s.section}>Maintenance release (CRS)</Text>
      {st.released ? (
        <View style={[s.relCard, { borderColor: st.release.serviceable ? theme.green : theme.red }]}>
          <Text style={s.relKind}>{KIND[st.release.kind || ''] || st.release.kind}</Text>
          <Text style={s.sub}>Aircraft {st.release.serviceable ? 'serviceable' : 'unserviceable'} at release · {st.release.at?.slice(0, 16).replace('T', ' ')}</Text>
          {st.release.note ? <Text style={s.sub}>Note: {st.release.note}</Text> : null}
          {st.reset_request?.status === 'pending' ? (
            <Text style={[s.sub, { color: theme.accent, marginTop: 8 }]}>⏳ CRS reset requested by {st.reset_request.by} — pending CAMO Manager approval.{'\n'}Reason: {st.reset_request.reason}</Text>
          ) : st.reset_request?.status === 'rejected' ? (
            <Text style={[s.sub, { color: theme.red, marginTop: 8 }]}>CRS reset request was rejected by CAMO{st.reset_request.review_note ? ` — ${st.reset_request.review_note}` : ''}. The CRS stands.</Text>
          ) : isMech ? (
            !showReset ? (
              <TouchableOpacity style={[s.btn, { backgroundColor: theme.tile, borderWidth: 1, borderColor: theme.red, marginTop: 10 }]} onPress={() => { setShowReset(true); setMsg(''); }}>
                <Text style={[s.btnTxt, { color: theme.red }]}>Request CRS reset (CAMO approval)</Text>
              </TouchableOpacity>
            ) : (
              <View style={{ marginTop: 10 }}>
                <Text style={s.sub}>A CRS can only be reset with a full written reason, approved by the CAMO Manager. Allowed before the aircraft departs.</Text>
                <TextInput style={[s.input, { minHeight: 70 }]} value={resetReason} onChangeText={setResetReason} multiline
                  placeholder="Full reason for resetting this CRS…" placeholderTextColor={theme.sub} />
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <TouchableOpacity style={[s.btn, { flex: 1, backgroundColor: theme.tile, borderWidth: 1, borderColor: theme.border }]} onPress={() => { setShowReset(false); setResetReason(''); }}>
                    <Text style={s.btnTxt}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[s.btn, { flex: 2, backgroundColor: theme.red }]} onPress={submitResetRequest}>
                    <Text style={s.btnTxt}>Submit reset request to CAMO</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )
          ) : null}
        </View>
      ) : (
        <Text style={s.sub}>Not yet released.</Text>
      )}

      {!isMech ? <RoBanner text="only certifying staff (mechanic) may issue a CRS release" /> : null}
      {isMech && (
        <>
          <TextInput style={s.input} value={signer} onChangeText={setSigner} placeholder="Mechanic name *" placeholderTextColor={theme.sub} />
          <TextInput style={s.input} value={licence} onChangeText={setLicence} placeholder="Licence / Part-145 auth no. *" placeholderTextColor={theme.sub} autoCapitalize="characters" />
          <TextInput style={s.input} value={note} onChangeText={setNote} placeholder="Release note (optional)…" placeholderTextColor={theme.sub} multiline />
          <Text style={s.sub}>A CRS release requires the mechanic name, licence, a signature and MFA. The licence must match your registered licence on file.</Text>
          {needOtp ? (
            <TextInput style={s.input} value={otp} onChangeText={setOtp} keyboardType="number-pad"
              placeholder="Authenticator code" placeholderTextColor={theme.sub} />
          ) : null}
          <TouchableOpacity style={[s.btn, { backgroundColor: st.blockers.length ? '#444' : theme.green }]} disabled={busy || st.blockers.length > 0}
            onPress={() => {
              if (st.blockers.length) { setMsg('Defer (MEL/HIL) or rectify the open defect(s) before release.'); return; }
              if (!signer.trim() || !licence.trim()) { setMsg('Enter mechanic name and licence first.'); return; }
              sig ? submitRelease(sig) : setSigning(true);   // reuse an already-captured signature (MFA / licence retry)
            }}>
            <Text style={[s.btnTxt, st.blockers.length ? { color: theme.sub } : null]}>{busy ? 'Releasing…' : needOtp ? 'Verify & release' : st.released ? 'Re-release flight (CRS)' : 'Sign & release flight (CRS)'}</Text>
          </TouchableOpacity>
          {st.blockers.length ? <Text style={[s.sub, { color: theme.red }]}>Cannot release: {st.blockers.length} open defect(s) must be deferred (MEL/HIL) or rectified first.</Text> : null}
        </>
      )}
      {finalize ? (
        <View style={{ marginTop: 12, backgroundColor: theme.panel, borderWidth: 1, borderColor: theme.border, borderRadius: 10, padding: 12 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
            <Text style={{ color: theme.text, fontSize: 13, fontWeight: '700', flexShrink: 1, marginRight: 8 }}>{finalize.label}</Text>
            <Text style={{ color: theme.green, fontSize: 13, fontWeight: '800' }}>{Math.round(finalize.frac * 100)}%</Text>
          </View>
          <View style={{ height: 8, backgroundColor: theme.tile, borderRadius: 4, overflow: 'hidden' }}>
            <View style={{ width: `${Math.round(finalize.frac * 100)}%`, height: '100%', backgroundColor: finalize.frac >= 1 ? theme.green : theme.accent }} />
          </View>
        </View>
      ) : null}
      {msg ? <Text style={s.msg}>{msg}</Text> : null}

      <SignaturePad visible={signing} title="Sign maintenance release (CRS)"
        onClose={() => setSigning(false)}
        onDone={(dataUrl) => { setSigning(false); submitRelease(dataUrl); }} />

      <Text style={s.section}>Print / transfer Tech Log</Text>
      <Text style={s.sub}>Same format as the paper TL — at departure and destination.</Text>
      <View style={s.printRow}>
        <TouchableOpacity style={[s.btn, s.printBtn, { backgroundColor: theme.tile }]} onPress={() => print('air', 'tl')}><Text style={s.btnTxt}>Print (AirPrint)</Text></TouchableOpacity>
        <TouchableOpacity style={[s.btn, s.printBtn, { backgroundColor: theme.tile }]} onPress={() => print('pdf', 'tl')}><Text style={s.btnTxt}>PDF · Transfer</Text></TouchableOpacity>
      </View>

      <Text style={[s.section, { fontSize: 12 }]}>Cabin defect log (separate)</Text>
      <View style={s.printRow}>
        <TouchableOpacity style={[s.btn, s.printBtn, { backgroundColor: theme.tile }]} onPress={() => print('air', 'cabin')}><Text style={s.btnTxt}>Print</Text></TouchableOpacity>
        <TouchableOpacity style={[s.btn, s.printBtn, { backgroundColor: theme.tile }]} onPress={() => print('pdf', 'cabin')}><Text style={s.btnTxt}>PDF · Transfer</Text></TouchableOpacity>
      </View>

      <Text style={[s.section, { fontSize: 12 }]}>Hold Item List · HIL (separate)</Text>
      <View style={s.printRow}>
        <TouchableOpacity style={[s.btn, s.printBtn, { backgroundColor: theme.tile }]} onPress={() => print('air', 'hil')}><Text style={s.btnTxt}>Print</Text></TouchableOpacity>
        <TouchableOpacity style={[s.btn, s.printBtn, { backgroundColor: theme.tile }]} onPress={() => print('pdf', 'hil')}><Text style={s.btnTxt}>PDF · Transfer</Text></TouchableOpacity>
      </View>

      <TouchableOpacity style={[s.btn, { backgroundColor: bluetoothAvailable() ? theme.tile : '#2a2a2a' }]} onPress={() => print('bt')}>
        <Text style={[s.btnTxt, { color: bluetoothAvailable() ? '#fff' : theme.sub }]}>
          {bluetoothAvailable() ? 'Print to onboard Bluetooth printer' : 'Bluetooth printer — pending setup'}
        </Text>
      </TouchableOpacity>

      <Text style={s.section}>Corrections ({corrections.length})</Text>
      <Text style={s.sub}>Amend an already-recorded entry. The original stays; the amendment is logged with who, when and why.</Text>
      {corrections.map((c) => (
        <View key={c.id} style={{ backgroundColor: theme.tile, borderWidth: 1, borderColor: theme.border, borderLeftWidth: 4, borderLeftColor: theme.accent, borderRadius: 8, padding: 10, marginTop: 8 }}>
          <Text style={{ color: theme.text, fontWeight: '700' }}>{c.field ? `${c.field}: ` : ''}{c.new_value || ''}</Text>
          <Text style={{ color: '#cde', fontSize: 13, marginTop: 2 }}>{c.reason}</Text>
          <Text style={s.sub}>{c.raised_by_name} · {c.raised_at?.slice(0, 16).replace('T', ' ')} · {c.status}</Text>
        </View>
      ))}
      {showCorr ? (
        <View style={{ marginTop: 8 }}>
          <TextInput style={s.input} value={corr.field} onChangeText={(v) => setCorr({ ...corr, field: v })} placeholder="What changed (e.g. Off-block time, Fuel uplift)" placeholderTextColor={theme.sub} />
          <TextInput style={s.input} value={corr.new_value} onChangeText={(v) => setCorr({ ...corr, new_value: v })} placeholder="Corrected value" placeholderTextColor={theme.sub} />
          <TextInput style={s.input} value={corr.reason} onChangeText={(v) => setCorr({ ...corr, reason: v })} placeholder="Reason for the correction (required)" placeholderTextColor={theme.sub} multiline />
          <TouchableOpacity style={[s.btn, { backgroundColor: theme.accent }]} onPress={submitCorrection}><Text style={[s.btnTxt, { color: '#1a1300' }]}>Submit correction</Text></TouchableOpacity>
          <TouchableOpacity onPress={() => setShowCorr(false)} style={{ marginTop: 6 }}><Text style={s.sub}>Cancel</Text></TouchableOpacity>
        </View>
      ) : (
        <TouchableOpacity style={[s.btn, { backgroundColor: theme.tile, borderWidth: 1, borderColor: theme.border, marginTop: 8 }]} onPress={() => setShowCorr(true)}><Text style={s.btnTxt}>＋ Raise correction</Text></TouchableOpacity>
      )}
    </ScrollView>
  );
}

function Group({ title, items, empty, color, nav }: { title: string; items: DefectBrief[]; empty: string; color: string; nav: any }) {
  return (
    <>
      <Text style={s.section}>{title}</Text>
      {items.length ? items.map((d) => (
        <TouchableOpacity key={d.id} style={s.row} onPress={() => nav.navigate('DefectDetail', { defectId: d.id })}>
          <View style={{ flex: 1 }}>
            <Text style={s.rowTitle}>{d.title || d.description}</Text>
            <Text style={s.sub}>{(d.source || '').toUpperCase()} · {d.area === 'cabin' ? 'CABIN' : 'TECH'} · ATA {d.ata_chapter || '—'}{d.mel_ref ? ` · MEL ${d.mel_ref}` : ''}</Text>
          </View>
          <Text style={[s.rowStatus, { color }]}>{d.status}</Text>
        </TouchableOpacity>
      )) : <Text style={s.sub}>{empty}</Text>}
    </>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.bg },
  banner: { borderWidth: 1, borderRadius: 10, padding: 14 },
  bannerTxt: { fontSize: 18, fontWeight: '900', letterSpacing: 0.5 },
  sub: { color: theme.sub, marginTop: 4, fontSize: 13 },
  section: { color: theme.text, fontWeight: '800', fontSize: 14, marginTop: 22, marginBottom: 8, textTransform: 'uppercase' },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: theme.panel, borderRadius: 8, borderWidth: 1, borderColor: theme.border, padding: 12, marginBottom: 8 },
  rowTitle: { color: theme.text, fontWeight: '700' },
  rowStatus: { fontWeight: '800', fontSize: 12, textTransform: 'uppercase' },
  relCard: { backgroundColor: theme.panel, borderWidth: 1, borderRadius: 8, padding: 12 },
  relKind: { color: theme.text, fontWeight: '800' },
  input: { backgroundColor: theme.tile, color: theme.text, borderWidth: 1, borderColor: theme.border, borderRadius: 8, padding: 12, marginTop: 12, minHeight: 54 },
  btn: { borderRadius: 8, padding: 14, alignItems: 'center', marginTop: 12 },
  btnTxt: { color: '#fff', fontWeight: '700' },
  msg: { color: theme.green, marginTop: 10 },
  printRow: { flexDirection: 'row', gap: 10 },
  printBtn: { flex: 1 },
});
