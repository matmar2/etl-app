import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Alert } from 'react-native';
import { acceptDispatch, addDefectAction, ammIawLine, ammRevision, can, CdlItem, clearanceAuthorized, closeDefect, defectCrsPreview, deleteDefect, getDefect, MelItem, MfaRequired, reverseRectification, role, userLicence } from '../api/client';
import { printHtml } from '../print';
import { appendLocalDefectAction, cacheDefect, getLocalDefect } from '../db/defects';
import MelPicker from '../components/MelPicker';
import CdlPicker from '../components/CdlPicker';
import AmmPicker from '../components/AmmPicker';
import PhotoCapture from '../components/PhotoCapture';
import SignaturePad from '../components/SignaturePad';
import { confirmAction } from '../util/confirm';
import { theme } from '../theme';

const INTERVALS = ['A', 'B', 'C', 'D'];

export default function DefectDetailScreen({ route, navigation }: any) {
  const { defectId } = route.params;
  const [d, setD] = useState<any>(null);
  const [msg, setMsg] = useState('');
  const [narr, setNarr] = useState('');
  const [amo, setAmo] = useState('');
  const [mel, setMel] = useState('');
  const [rectIv, setRectIv] = useState('');
  const [due, setDue] = useState('');
  const [maxCyc, setMaxCyc] = useState('');              // cycle-based MEL: max landings/cycles
  const [melOpen, setMelOpen] = useState(false);
  const [cdlOpen, setCdlOpen] = useState(false);
  const [ammOpen, setAmmOpen] = useState(false);
  // Rectify + CRS: validate entries -> confirm -> signature -> MFA
  const [lic, setLic] = useState(userLicence() ?? '');   // pre-filled from profile, editable
  const [signing, setSigning] = useState(false);
  const [crsSig, setCrsSig] = useState<string | null>(null);
  const [diOpen, setDiOpen] = useState(false);           // double-inspection (DI) — second person's signature
  const [diName, setDiName] = useState('');
  const [diLic, setDiLic] = useState('');
  const [diSigning, setDiSigning] = useState(false);
  const [otp, setOtp] = useState('');
  const [needOtp, setNeedOtp] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [askDel, setAskDel] = useState(false);
  const [approver, setApprover] = useState('');
  const isMech = can('defects', 'rectify');     // rectification / CRS action — maintenance
  const canDefer = can('defects', 'defer');     // defer against MEL / CDL — maintenance
  const isCaptain = ['captain', 'pilot', 'admin'].includes(role() ?? '');
  const isCommander = role() === 'admin' ||
    (['captain', 'pilot'].includes(role() ?? '') && clearanceAuthorized());

  function appendNarr(line: string) { setNarr((n) => (n ? n.replace(/\s+$/, '') + '\n\n' : '') + line); }
  // Time remaining to a calendar due date (limit = end of that day). "Nd Hh Mm left" / "OVERDUE …".
  function remainingDue(dd?: string | null): string | null {
    if (!dd || !/^\d{4}-\d{2}-\d{2}$/.test(dd)) return null;
    const ms = new Date(`${dd}T23:59:59Z`).getTime() - Date.now();
    const a = Math.abs(ms), d = Math.floor(a / 86400000), h = Math.floor((a % 86400000) / 3600000), m = Math.floor((a % 3600000) / 60000);
    return ms < 0 ? `OVERDUE by ${d}d ${h}h ${m}m` : `${d}d ${h}h ${m}m left`;
  }
  function pickMel(m: MelItem) {
    setMel(m.ata || '');                              // deferral ref + category
    if (m.category) setRectIv(m.category);
    appendNarr(`MEL ${m.ata || ''} · ${m.item}${m.category ? ` (Cat ${m.category}${m.rectification_interval ? `, ${m.rectification_interval}` : ''})` : ''}`.replace(/\s+/g, ' ').trim());
    setMelOpen(false);
  }
  function pickCdl(c: CdlItem) {
    appendNarr(`CDL ${c.ata || ''}${c.code ? ` (${c.code})` : ''} · ${c.item || c.system}${c.dispatch ? ` — ${c.dispatch}` : ''}`.replace(/\s+/g, ' ').trim());
    setCdlOpen(false);
  }

  const [ammRev, setAmmRev] = useState('');
  async function load() {
    try { const dd = await getDefect(defectId); setD(dd); cacheDefect(dd).catch(() => {}); }   // online → cache for offline
    catch (e: any) {
      const local = await getLocalDefect(defectId);                                             // offline → local mirror
      if (local) { setD(local); setMsg(''); }
      else setMsg('This defect isn’t available offline — open it once with a signal.');
    }
  }
  useEffect(() => { load(); }, [defectId]);
  useEffect(() => {
    ammRevision().then(setAmmRev).catch(() => {});
  }, []);

  async function act(kind: string, body: any = {}) {
    setMsg('Saving…');
    try {
      const a = { kind, narrative: narr || undefined, ...body };
      const r = await addDefectAction(defectId, a);
      if (r?.queued) { await appendLocalDefectAction(defectId, a); setMsg('Saved offline — will sync ✓'); }
      else setMsg('Done ✓');
      setNarr(''); load();
    } catch (e: any) { setMsg(`Failed: ${e.message}`); }
  }
  async function close() {
    try {
      const r = await closeDefect(defectId);
      if (r?.queued) { await appendLocalDefectAction(defectId, { kind: 'close' }, { status: 'closed' }); setMsg('Closed offline — will sync ✓'); }
      else setMsg('Closed ✓');
      load();
    } catch (e: any) { setMsg(`Failed: ${e.message}`); }
  }

  // Preview the Tech Log / CRS page this rectification will be recorded on, before signing.
  async function previewCRS() {
    setPreviewing(true); setMsg('');
    try { const { html } = await defectCrsPreview(defectId); if (html) await printHtml(html); }
    catch (e: any) { setMsg(e?.message?.includes('Network') ? 'Preview needs a connection.' : (e?.message || 'Could not open the preview.')); }
    finally { setPreviewing(false); }
  }

  // Rectify + CRS — a certification: all entries complete, confirm, sign, MFA.
  async function rectifyCRS() {
    if (!narr.trim()) { setMsg('Describe the rectification work first.'); return; }
    if (!amo.trim()) { setMsg('Enter the AMO / Part-145 approval number.'); return; }
    if (!lic.trim()) { setMsg('Enter your licence / authorisation number.'); return; }
    if (!(await confirmAction('Issue the CRS for this rectification? You will sign and authenticate.', 'Rectify + CRS'))) return;
    setSigning(true);
  }
  async function submitCRS(signature: string) {
    setMsg('Issuing CRS…');
    try {
      const r = await addDefectAction(defectId, { kind: 'rectification', narrative: narr, amo_approval_no: amo,
        licence_no: lic.trim() || undefined, signature_image: signature, otp: otp.trim() || undefined });
      if (r?.queued) { await appendLocalDefectAction(defectId, { kind: 'rectification', narrative: narr, amo_approval_no: amo }, { status: 'rectified' }); setMsg('CRS saved offline — will sync when back online ✓'); }
      else setMsg('Rectified + CRS issued ✓');
      setNarr(''); setOtp(''); setNeedOtp(false); setCrsSig(null); load();
    } catch (e: any) {
      if (e instanceof MfaRequired) { setCrsSig(signature); setNeedOtp(true); setMsg('Enter your authenticator code to issue the CRS.'); }
      else setMsg(`Failed: ${e.message}`);
    }
  }
  // Double inspection (DI): a second qualified person's independent inspection — captures their
  // name, licence, signature and the date/time.
  async function submitDI(signature: string) {
    setMsg('Recording double inspection…');
    try {
      const a = { kind: 'double_inspection', signer_name: diName.trim(), licence_no: diLic.trim() || undefined, signature_image: signature };
      const r = await addDefectAction(defectId, a);
      if (r?.queued) { await appendLocalDefectAction(defectId, { kind: 'double_inspection', narrative: `Double inspection · ${diName.trim()}` }); setMsg('Double inspection saved offline — will sync ✓'); }
      else setMsg('Double inspection recorded ✓');
      setDiOpen(false); setDiName(''); setDiLic(''); load();
    } catch (e: any) { setMsg(`Failed: ${e.message}`); }
  }
  async function reverse() {
    if (!(await confirmAction('Reverse this Rectify + CRS? The rectification and its CRS signature will be voided and the defect re-opened.', 'Reverse CRS'))) return;
    try {
      const r: any = await reverseRectification(defectId);
      if (r?.queued) { await appendLocalDefectAction(defectId, { kind: 'reverse' }, { status: 'open' }); setMsg('Reversal saved offline — will sync'); }
      else setMsg('Rectification reversed — defect re-opened');
      load();
    }
    catch (e: any) { setMsg(e?.message?.includes('409') ? 'Cannot reverse — defect is closed' : `Failed: ${e.message}`); }
  }
  function dispatch(ok: boolean) {
    Alert.alert(
      ok ? 'Accept as dispatchable' : 'Mark NOT dispatchable',
      ok ? 'Confirm the commander accepts this cabin defect as dispatchable.'
         : 'Confirm this cabin defect makes the aircraft NOT dispatchable (will hold the aircraft).',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: ok ? 'Accept' : 'Not dispatchable', style: ok ? 'default' : 'destructive', onPress: async () => {
          try {
            const r = await acceptDispatch(defectId, ok);
            if (r?.queued) { await appendLocalDefectAction(defectId, { kind: 'dispatch', dispatchable: ok }); setMsg('Saved offline — will sync ✓'); }
            else setMsg(ok ? 'Accepted as dispatchable ✓' : 'Marked not dispatchable');
            load();
          }
          catch (e: any) { setMsg(`Failed: ${e.message}`); }
        } },
      ]);
  }
  async function del() {
    // Admin only, before dispatch/release, with the CAMO Manager's approval recorded.
    // Double confirmation for a permanent removal (the server enforces the same rules).
    if (!approver.trim()) { setMsg('Record the CAMO Manager who approved this removal first.'); return; }
    if (!(await confirmAction(`Remove this defect entered by mistake?\n\nApproved by CAMO Manager: ${approver.trim()}\n\nThis is only for entries made in error, before the flight is dispatched/released.`, 'Remove defect'))) return;
    if (!(await confirmAction('Are you sure? This cannot be undone — the defect and any photos are permanently removed.', 'Confirm removal'))) return;
    try { await deleteDefect(defectId, approver.trim()); navigation?.goBack(); }
    catch (e: any) {
      const m = e?.message || '';
      setMsg(/409|dispatched|released|departed/i.test(m) ? 'The flight has been dispatched/released — this defect is now part of the record; raise a correction instead.'
        : /400/.test(m) ? 'CAMO Manager approval is required.'
        : /403/.test(m) ? 'Only an admin with CAMO Manager approval can remove a defect.'
        : `Failed: ${m}`);
    }
  }

  if (!d) return <View style={styles.wrap}><Text style={styles.sub}>{msg || 'Loading…'}</Text></View>;
  const color = d.status === 'deferred' ? theme.accent : d.status === 'closed' || d.status === 'rectified' ? theme.green : theme.red;

  return (
    <ScrollView style={styles.wrap} contentContainerStyle={{ padding: 16, width: '100%', maxWidth: 860, alignSelf: 'center' }} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
      <Text style={styles.title}>{d.title || 'Defect'} <Text style={[styles.badge, { color }]}>· {d.status}</Text></Text>
      <Text style={styles.desc}>{d.description}</Text>
      <Text style={styles.sub}>{d.source?.toUpperCase()} · ATA {d.ata_chapter || '—'}{d.mel_ref ? ` · MEL ${d.mel_ref}` : ''}{d.rect_interval ? ` · Cat ${d.rect_interval}` : ''}{d.due_date ? ` · due ${d.due_date}` : ''}</Text>
      {/* Deferred item: remaining calendar time and/or remaining cycles (cycle-based MEL). */}
      {d.status === 'deferred' && (d.due_date || d.max_cycles != null) ? (
        <Text style={[styles.sub, { fontWeight: '700', color: (/OVERDUE/.test(remainingDue(d.due_date) || '') || (d.remaining_cycles != null && d.remaining_cycles <= 0)) ? theme.red : theme.accent }]}>
          {d.due_date && remainingDue(d.due_date) ? remainingDue(d.due_date) : ''}
          {d.due_date && d.max_cycles != null ? '  ·  ' : ''}
          {d.max_cycles != null ? `${d.remaining_cycles != null ? d.remaining_cycles : d.max_cycles} of ${d.max_cycles} cycles left` : ''}
        </Text>
      ) : null}
      {d.last_updated_by ? <Text style={[styles.sub, { fontSize: 12 }]}>Last updated by {d.last_updated_by}</Text> : null}
      {msg ? <Text style={styles.msg}>{msg}</Text> : null}

      {/* Once the CRS is signed (rectified/closed) the photos are part of the signed record — view only, no re-take/library. */}
      <PhotoCapture defectId={defectId} kind="damage" label="Damage / receipt photos" readOnly={d.status === 'closed' || d.status === 'rectified'} />

      {d.can_delete ? (
        !askDel ? (
          <TouchableOpacity onPress={() => { setMsg(''); setAskDel(true); }} style={{ marginTop: 14 }}>
            <Text style={{ color: theme.red, fontWeight: '700' }}>Delete defect (entered by mistake)</Text>
          </TouchableOpacity>
        ) : (
          <View style={{ marginTop: 14, borderWidth: 1, borderColor: theme.red, borderRadius: 8, padding: 12 }}>
            <Text style={{ color: theme.text, fontWeight: '700' }}>Remove defect (entered by mistake)</Text>
            <Text style={styles.sub}>Admin only, before the flight is dispatched/released, and only with the CAMO Manager’s approval.</Text>
            <TextInput style={[styles.input, { marginTop: 10, minHeight: 0 }]} value={approver} onChangeText={setApprover}
              placeholder="CAMO Manager who approved (name / authorisation) *" placeholderTextColor={theme.sub} />
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
              <TouchableOpacity style={[styles.act2, { backgroundColor: theme.red }]} onPress={del}>
                <Text style={styles.act2t}>Remove defect</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.act2, { backgroundColor: theme.tile, borderWidth: 1, borderColor: theme.border }]} onPress={() => { setAskDel(false); setApprover(''); }}>
                <Text style={styles.act2t}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        )
      ) : null}

      {d.area === 'cabin' && isCaptain && d.status !== 'closed' && (
        <>
          <Text style={styles.section}>Cabin defect — commander dispatch decision</Text>
          <Text style={styles.sub}>
            {d.dispatch_accepted === true ? 'Accepted as dispatchable.' :
             d.dispatch_accepted === false ? 'Marked NOT dispatchable — aircraft held.' :
             'Awaiting the commander’s decision (does not auto-ground the aircraft).'}
          </Text>
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
            <TouchableOpacity style={[styles.act2, { backgroundColor: theme.green }]} onPress={() => dispatch(true)}>
              <Text style={styles.act2t}>Accept dispatchable</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.act2, { backgroundColor: theme.red }]} onPress={() => dispatch(false)}>
              <Text style={styles.act2t}>Not dispatchable</Text>
            </TouchableOpacity>
          </View>
        </>
      )}

      <Text style={styles.section}>Action timeline ({d.actions?.length || 0})</Text>
      {(d.actions || []).map((a: any, i: number) => (
        <View key={i} style={styles.action}>
          <Text style={styles.actKind}>{a.kind}</Text>
          <Text style={styles.sub}>{a.narrative || ''}{a.amo_approval_no ? ` · AMO ${a.amo_approval_no}` : ''}</Text>
          <Text style={styles.actTime}>{a.at?.slice(0, 16).replace('T', ' ')}</Text>
        </View>
      ))}

      {d.oases_sourced && (isMech || canDefer) && d.status !== 'closed' && (
        <Text style={[styles.sub, { marginTop: 14 }]}>ℹ︎ Mirrored from OASES. You can rectify or defer it here — the CRS is recorded on a VAW-ETL-01 Tech Log page (preview below).</Text>
      )}

      {(isMech || canDefer) && d.status !== 'closed' && (
        <>
          <Text style={styles.section}>Maintenance action</Text>
          <TextInput style={[styles.input, { minHeight: Math.max(88, narr.split('\n').length * 22 + 28), textAlignVertical: 'top' }]}
            value={narr} onChangeText={setNarr} placeholder="Narrative / action taken… (add task cards below)" placeholderTextColor={theme.sub} multiline />
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            <TouchableOpacity style={[styles.act2, { backgroundColor: theme.tile, alignSelf: 'flex-start', marginTop: 8 }]} onPress={() => setAmmOpen(true)}>
              <Text style={styles.act2t}>＋ Task Card (AMM)</Text>
            </TouchableOpacity>
          </View>
          <AmmPicker visible={ammOpen} reg={d?.aircraft_id} defaultAta={(d?.ata_chapter || '').split('-')[0] || undefined} onClose={() => setAmmOpen(false)}
            onPick={(m) => { setNarr((n) => { const line = ammIawLine(m); const base = (n || '').trim(); return base ? `${line}\n\n${base}` : line; }); setAmmOpen(false); }} />
          {isMech && (<>
          <TouchableOpacity style={[styles.act2, { backgroundColor: theme.tile, alignSelf: 'flex-start', marginTop: 8 }]} onPress={() => act('troubleshooting')}><Text style={styles.act2t}>Troubleshooting</Text></TouchableOpacity>

          {/* Double Inspection (DI) — a second qualified person signs an independent inspection (name + licence + signature + date/time). */}
          <TouchableOpacity style={[styles.act2, { backgroundColor: theme.tile, borderWidth: 1, borderColor: theme.border, alignSelf: 'flex-start', marginTop: 8 }]} onPress={() => setDiOpen((v) => !v)}>
            <Text style={styles.act2t}>👥 Double Inspection (DI){diOpen ? ' ▴' : ' ▾'}</Text>
          </TouchableOpacity>
          {diOpen ? (
            <View style={{ marginTop: 8, backgroundColor: theme.tile, borderWidth: 1, borderColor: theme.border, borderRadius: 8, padding: 10 }}>
              <Text style={styles.sub}>The independent second inspection required for a critical task. The DI signature and its date/time are recorded.</Text>
              <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
                <TextInput style={[styles.input, { width: 200, minHeight: 0 }]} value={diName} onChangeText={setDiName} placeholder="DI — inspector name *" placeholderTextColor={theme.sub} />
                <TextInput style={[styles.input, { width: 170, minHeight: 0 }]} value={diLic} onChangeText={setDiLic} placeholder="DI — licence / auth no" placeholderTextColor={theme.sub} />
              </View>
              <TouchableOpacity style={[styles.act2, { backgroundColor: theme.accent, marginTop: 8 }]} onPress={() => { if (!diName.trim()) { setMsg('Enter the double-inspection inspector name.'); return; } setDiSigning(true); }}>
                <Text style={[styles.act2t, { color: '#1a1300' }]}>Sign double inspection</Text>
              </TouchableOpacity>
            </View>
          ) : null}
          <SignaturePad visible={diSigning} title="Double inspection signature"
            onClose={() => setDiSigning(false)} onDone={(dataUrl) => { setDiSigning(false); submitDI(dataUrl); }} />

          <Text style={styles.lbl}>Rectify + CRS (certification — M.A.801)</Text>
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            <TextInput style={[styles.input, { width: 170, minHeight: 0 }]} value={amo} onChangeText={setAmo} placeholder="AMO / Part-145 no *" placeholderTextColor={theme.sub} />
            <TextInput style={[styles.input, { width: 170, minHeight: 0 }]} value={lic} onChangeText={setLic} placeholder="Licence / auth no *" placeholderTextColor={theme.sub} />
          </View>
          {needOtp ? (
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', marginTop: 8 }}>
              <TextInput style={[styles.input, { width: 170, minHeight: 0 }]} value={otp} onChangeText={setOtp} keyboardType="number-pad" placeholder="Authenticator code" placeholderTextColor={theme.sub} />
              <TouchableOpacity style={[styles.act2, { backgroundColor: theme.green }]} onPress={() => crsSig && submitCRS(crsSig)}><Text style={styles.act2t}>Submit CRS</Text></TouchableOpacity>
            </View>
          ) : (
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
              <TouchableOpacity style={[styles.act2, { backgroundColor: theme.tile }]} onPress={previewCRS} disabled={previewing}><Text style={styles.act2t}>{previewing ? 'Opening…' : '👁 Preview Tech Log / CRS'}</Text></TouchableOpacity>
              <TouchableOpacity style={[styles.act2, { backgroundColor: theme.green }]} onPress={rectifyCRS}><Text style={styles.act2t}>Rectify + CRS · sign</Text></TouchableOpacity>
            </View>
          )}
          <Text style={styles.sub}>Preview the Tech Log / CRS page before you sign. The CRS requires the work narrative, AMO/licence, a signature and MFA before it goes ahead.</Text>
          <SignaturePad visible={signing} title="Sign rectification CRS"
            onClose={() => setSigning(false)} onDone={(dataUrl) => { setSigning(false); submitCRS(dataUrl); }} />
          </>)}

          {canDefer && (<>
          <Text style={styles.section}>Defer per MEL (Hold Item List)</Text>
          <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
            <TouchableOpacity style={[styles.act2, { backgroundColor: theme.tile, borderWidth: 1, borderColor: theme.border, alignSelf: 'flex-start' }]} onPress={() => setMelOpen(true)}>
              <Text style={styles.act2t}>Pick from CAMO MEL ▾</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.act2, { backgroundColor: theme.tile, borderWidth: 1, borderColor: theme.border, alignSelf: 'flex-start' }]} onPress={() => setCdlOpen(true)}>
              <Text style={styles.act2t}>Pick from CAMO CDL ▾</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.row}>
            <TextInput style={[styles.input, { width: 140, minHeight: 0 }]} value={mel} onChangeText={setMel} placeholder="MEL ref" placeholderTextColor={theme.sub} />
            <View style={{ flexDirection: 'row', gap: 6 }}>
              {INTERVALS.map((iv) => (
                <TouchableOpacity key={iv} onPress={() => setRectIv(rectIv === iv ? '' : iv)} style={[styles.iv, rectIv === iv && { backgroundColor: theme.accent, borderColor: theme.accent }]}>
                  <Text style={[styles.ivt, rectIv === iv && { color: '#1a1300' }]}>{iv}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TextInput style={[styles.input, { width: 120, minHeight: 0 }]} value={due} onChangeText={setDue} placeholder="due YYYY-MM-DD" placeholderTextColor={theme.sub} />
          </View>
          {/* Calendar-day limit: show the time remaining live as the due date is entered. */}
          {remainingDue(due) ? <Text style={[styles.sub, { marginTop: 4, color: /OVERDUE/.test(remainingDue(due) || '') ? theme.red : theme.accent }]}>Remaining: {remainingDue(due)}</Text> : null}
          {/* Cycle-based MEL: enter the max cycles/landings allowed; remaining is computed after deferral. */}
          <View style={[styles.row, { marginTop: 8 }]}>
            <TextInput style={[styles.input, { width: 150, minHeight: 0 }]} value={maxCyc} onChangeText={(v) => setMaxCyc(v.replace(/[^0-9]/g, ''))} keyboardType="number-pad" placeholder="Max cycles (if cyclic)" placeholderTextColor={theme.sub} />
            <Text style={[styles.sub, { flex: 1, minWidth: 140 }]}>For a cycle-limited item — remaining cycles are tracked from the landings after deferral.</Text>
          </View>
          <TouchableOpacity style={[styles.act2, { backgroundColor: theme.accent, marginTop: 10 }]}
            onPress={() => act('deferral', { mel_ref: mel || undefined, rect_interval: rectIv, due_date: due || undefined, max_cycles: maxCyc ? Number(maxCyc) : undefined })}>
            <Text style={[styles.act2t, { color: '#1a1300' }]}>Defer per MEL{rectIv ? ' ' + rectIv : ''}</Text>
          </TouchableOpacity>
          </>)}

          {isMech && d.status === 'rectified' && (
            <View style={{ marginTop: 18, gap: 8 }}>
              <TouchableOpacity style={[styles.act2, { backgroundColor: theme.green }]} onPress={close}>
                <Text style={styles.act2t}>Close defect</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.act2, { backgroundColor: theme.tile, borderWidth: 1, borderColor: theme.red, alignSelf: 'flex-start' }]} onPress={reverse}>
                <Text style={[styles.act2t, { color: theme.red }]}>Reverse Rectify + CRS</Text>
              </TouchableOpacity>
            </View>
          )}
        </>
      )}

      {isCommander && d.captain_clearable && d.status !== 'closed' && (
        <>
          <Text style={styles.section}>Commander clearance</Text>
          <Text style={styles.sub}>This item is approved for clearance by the commander (e.g. cabin defect).</Text>
          <TouchableOpacity style={[styles.act2, { backgroundColor: theme.green, marginTop: 12 }]} onPress={close}>
            <Text style={styles.act2t}>Clear as commander</Text>
          </TouchableOpacity>
        </>
      )}

      <MelPicker visible={melOpen} ata={(d?.ata_chapter || '').split('-')[0] || undefined} onClose={() => setMelOpen(false)} onPick={pickMel} />
      <CdlPicker visible={cdlOpen} ata={(d?.ata_chapter || '').split('-')[0] || undefined} onClose={() => setCdlOpen(false)} onPick={pickCdl} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.bg },
  title: { color: theme.text, fontSize: 20, fontWeight: '800' },
  badge: { fontSize: 13, fontWeight: '800', textTransform: 'uppercase' },
  desc: { color: theme.text, marginTop: 8 },
  sub: { color: theme.sub, marginTop: 4, fontSize: 13 },
  lbl: { color: theme.text, fontWeight: '800', fontSize: 13, marginTop: 16, marginBottom: 6 },
  msg: { color: theme.green, marginTop: 8 },
  section: { color: theme.text, fontWeight: '700', fontSize: 15, marginTop: 22, marginBottom: 10 },
  action: { backgroundColor: theme.panel, borderRadius: 8, padding: 10, marginBottom: 8 },
  actKind: { color: theme.text, fontWeight: '700', textTransform: 'uppercase', fontSize: 12 },
  actTime: { color: theme.sub, fontSize: 11, marginTop: 4 },
  input: { backgroundColor: theme.tile, color: theme.text, borderWidth: 1, borderColor: theme.border, borderRadius: 8, padding: 10, minHeight: 44 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginTop: 10 },
  act2: { borderRadius: 8, paddingVertical: 11, paddingHorizontal: 16, alignItems: 'center' },
  act2t: { color: '#fff', fontWeight: '700' },
  iv: { borderWidth: 1, borderColor: theme.border, borderRadius: 6, width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  ivt: { color: theme.text, fontWeight: '800' },
  modalWrap: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: 20 },
  modalCard: { backgroundColor: theme.panel, borderRadius: 12, padding: 16, borderWidth: 1, borderColor: theme.border },
  melRow: { flexDirection: 'row', gap: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: theme.border },
  melAta: { color: theme.accent, fontWeight: '800', width: 64 },
  melTitle: { color: theme.text, fontSize: 17, fontWeight: '800', marginBottom: 12 },
  melTable: { flexDirection: 'row', borderWidth: 1, borderColor: theme.border, borderRadius: 6, overflow: 'hidden' },
  melCell: { flex: 1, borderRightWidth: 1, borderRightColor: theme.border, padding: 8, alignItems: 'center' },
  melCellHead: { color: theme.sub, fontSize: 11, textAlign: 'center' },
  melCellVal: { color: theme.text, fontWeight: '800', marginTop: 4 },
  melBody: { color: theme.text, marginTop: 12, lineHeight: 20 },
  melSec: { color: theme.accent, fontWeight: '700', marginTop: 14 },
});
