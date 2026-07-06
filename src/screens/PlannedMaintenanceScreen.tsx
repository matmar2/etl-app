import React, { useEffect, useRef, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { aircraftStatus, amendCheck, appSettings, can, CheckRecord, CheckStatus, CheckTemplate, checkHtml, checkTemplate, completeCheck, completeMaintTask, listChecks, MaintTask, maintTasks, nextTl, previewCheck, syncPush } from '../api/client';
import RoBanner from '../components/RoBanner';
import { printHtml, shareHtml } from '../print';
import SignaturePad from '../components/SignaturePad';
import { confirmAction } from '../util/confirm';
import { clearCheckDraft, loadCheckDraft, saveCheckDraft } from '../db/checkDraft';
import { theme } from '../theme';

export default function PlannedMaintenanceScreen({ route, navigation }: any) {
  const reg = route?.params?.aircraftId ?? 'LZ-FSA';
  const [kind, setKind] = useState<'2day' | '10day'>('2day');
  const [tpl, setTpl] = useState<CheckTemplate | null>(null);
  const [state, setState] = useState<Record<string, any>>({});   // taskId -> {mech, insp, fields:{}}
  const [signer, setSigner] = useState('');
  const [licence, setLicence] = useState('');
  const [inspSigner, setInspSigner] = useState('');
  const [inspLicence, setInspLicence] = useState('');
  const [inspSig, setInspSig] = useState('');          // captured inspector signature (dataURL)
  const [tlb, setTlb] = useState('');
  const [sigTarget, setSigTarget] = useState<'mech' | 'insp' | null>(null);   // which signature the pad is capturing
  const [msg, setMsg] = useState('');
  const [doneId, setDoneId] = useState<string | null>(null);
  const [queued, setQueued] = useState(false);   // signed offline → recorded locally, printable once synced
  const [finalize, setFinalize] = useState<{ frac: number; label: string } | null>(null);   // post-sign progress (record→sync→serviceable)
  const [recent, setRecent] = useState<CheckRecord[]>([]);
  const [checks, setChecks] = useState<CheckStatus[]>([]);
  const [mtasks, setMtasks] = useState<MaintTask[]>([]);
  const [showDone, setShowDone] = useState(false);
  const [viewDays, setViewDays] = useState(15);
  const [badId, setBadId] = useState<string | null>(null);   // incomplete task/field to highlight
  const [amendingId, setAmendingId] = useState<string | null>(null);   // signed check being corrected
  const [amendReason, setAmendReason] = useState('');
  const scrollRef = useRef<ScrollView>(null);
  const secY = useRef<Record<string, number>>({});
  const taskY = useRef<Record<string, number>>({});
  const taskSection = useRef<Record<string, string>>({});
  const fieldRefs = useRef<Record<string, TextInput | null>>({});
  const canEdit = can('checks', 'complete');

  function loadRecent() {
    appSettings().then((sx) => setViewDays(sx.check_view_days || 15)).catch(() => {});
    listChecks(reg, viewDays).then(setRecent).catch(() => setRecent([]));
    aircraftStatus(reg).then((st) => setChecks(st.checks || [])).catch(() => {});   // due-date status per check
    nextTl(reg).then((r) => setTlb(String(r.next_tl))).catch(() => {});              // pre-fill next TL # (editable/clearable)
    maintTasks(reg).then(setMtasks).catch(() => setMtasks([]));                       // CAMO planned-maintenance tasks
  }

  async function doneTask(t: MaintTask) {
    if (!(await confirmAction(`Mark "${t.title}" as completed?`, 'Complete task'))) return;
    try { await completeMaintTask(t.id, { signer_name: signer.trim() || undefined, tlb_no: tlb.trim() || undefined }); setMsg(`Task completed ✓`); loadRecent(); }
    catch (e: any) { setMsg(`Failed: ${e.message}`); }
  }
  useEffect(() => { loadRecent(); }, [reg, doneId]);

  async function viewRecord(id: string) {
    try { const { html } = await checkHtml(id); await printHtml(html); }
    catch (e: any) { Alert.alert('View', e.message); }
  }

  const [draftLoaded, setDraftLoaded] = useState(false);
  useEffect(() => {
    setTpl(null); setState({}); setDraftLoaded(false); setDoneId(null); setQueued(false); setMsg('');
    checkTemplate(kind, reg).then(setTpl).catch((e) => setMsg(e.message));
    setAmendingId(null); setAmendReason('');
    setInspSigner(''); setInspLicence(''); setInspSig('');
    loadCheckDraft(reg, kind).then((d) => {
      if (d && d.state && Object.keys(d.state).length) {
        setState(d.state);
        if (d.signer != null) setSigner(d.signer);
        if (d.licence != null) setLicence(d.licence);
        if (d.inspSigner != null) setInspSigner(d.inspSigner);
        if (d.inspLicence != null) setInspLicence(d.inspLicence);
        if (d.inspSig != null) setInspSig(d.inspSig);
        if (d.amendingId) { setAmendingId(d.amendingId); setAmendReason(d.amendReason || ''); }
        setMsg(d.amendingId ? 'Resumed your amendment — correct, enter a reason, then re-sign.' : 'Resumed your saved entries for this check.');
      }
      setDraftLoaded(true);
    });
  }, [kind, reg]);

  // auto-save entries as they are made, so leaving and returning resumes the check
  useEffect(() => {
    if (!draftLoaded) return;
    saveCheckDraft(reg, kind, { state, signer, licence, inspSigner, inspLicence, inspSig, amendingId, amendReason });
  }, [state, signer, licence, inspSigner, inspLicence, inspSig, amendingId, amendReason, draftLoaded, reg, kind]);

  const set = (id: string, patch: any) => setState((s) => ({ ...s, [id]: { ...s[id], ...patch } }));
  const setField = (id: string, key: string, v: string) =>
    setState((s) => ({ ...s, [id]: { ...s[id], fields: { ...(s[id]?.fields || {}), [key]: v } } }));

  const tasks = tpl?.sections.flatMap((sec) => sec.tasks) ?? [];
  const hasInsp = tasks.some((t) => t.insp);          // check carries independent-inspection items → dual signature required
  const filled = (id: string, key: string) => String(state[id]?.fields?.[key] ?? '').trim().length > 0;
  const taskDone = (t: any) => state[t.id]?.mech && (!t.insp || state[t.id]?.insp) && (t.fields ?? []).every((f: any) => filled(t.id, f.key));
  const remaining = tasks.filter((t) => !taskDone(t)).length;
  const certified = !!doneId && !amendingId;   // just signed → show the completed panel, not the (now-cleared) form

  function firstIncomplete(): { id: string; taskId: string; fieldKey?: string } | null {
    for (const t of tasks) {
      if (!state[t.id]?.mech) return { id: t.id, taskId: t.id };
      if (t.insp && !state[t.id]?.insp) return { id: t.id, taskId: t.id };
      for (const f of (t.fields ?? [])) if (!filled(t.id, f.key)) return { id: `${t.id}::${f.key}`, taskId: t.id, fieldKey: f.key };
    }
    return null;
  }
  // Strict completion: every task (MECH, INSP where required, and all data fields) before signing.
  function trySign() {
    if (!signer.trim() || !licence.trim()) { setMsg('Enter mechanic name and licence.'); return; }
    if (amendingId && !amendReason.trim()) { setMsg('Enter a reason for the amendment.'); return; }
    const bad = firstIncomplete();
    if (bad) {
      setBadId(bad.id);
      const y = (secY.current[taskSection.current[bad.taskId]] ?? 0) + (taskY.current[bad.taskId] ?? 0);
      scrollRef.current?.scrollTo({ y: Math.max(0, y - 90), animated: true });
      if (bad.fieldKey) setTimeout(() => fieldRefs.current[bad.id]?.focus(), 350);
      const t = tasks.find((x) => x.id === bad.taskId);
      setMsg(bad.fieldKey ? `Enter "${bad.fieldKey}" — ${(t?.text || '').slice(0, 70)}…`
        : `Sign MECH${t?.insp ? ' & INSP' : ''} — ${(t?.text || '').slice(0, 70)}…`);
      return;
    }
    if (hasInsp) {   // independent-inspection items → a second, different person must sign
      if (!inspSigner.trim() || !inspLicence.trim()) { setMsg('Enter the inspector name and licence for the independent inspection.'); return; }
      if (!inspSig) { setMsg('Capture the inspector signature for the independent inspection.'); return; }
      if (inspSigner.trim().toLowerCase() === signer.trim().toLowerCase()) { setMsg('The independent inspection must be signed by a different person than the mechanic.'); return; }
    }
    setBadId(null); setMsg(''); setSigTarget('mech');
  }

  async function submit(signature: string) {
    if (!signer.trim() || !licence.trim()) { setMsg('Enter mechanic name and licence.'); return; }
    const wasAmend = !!amendingId;
    setMsg(''); setFinalize({ frac: 0.15, label: 'Recording the check…' });
    try {
      const body = { data: state, signer_name: signer.trim(), licence_no: licence.trim(),
        tlb_no: tlb.trim() || undefined, signature_image: signature,
        ...(hasInsp ? { insp_signer_name: inspSigner.trim(), insp_licence_no: inspLicence.trim(), insp_signature_image: inspSig } : {}) };
      const r = amendingId
        ? await amendCheck(reg, amendingId, { ...body, reason: amendReason.trim() })
        : await completeCheck(reg, kind, body);
      const wasQueued = !!(r as any).queued;
      setQueued(wasQueued); setDoneId(r.id); setAmendingId(null); setAmendReason('');
      clearCheckDraft(reg, kind).catch(() => {});   // signed — drop the resume draft
      setState({}); setInspSigner(''); setInspLicence(''); setInspSig('');
      // Walk the post-sign steps so the crew see the aircraft return to serviceable, not a silent wait.
      setFinalize({ frac: 0.45, label: 'Check recorded ✓ — syncing to the server…' });
      try { await syncPush(); } catch { /* offline — stays queued, still counts */ }
      setFinalize({ frac: 0.75, label: 'Updating aircraft serviceability…' });
      let svc: boolean | null = null;
      try { const st = await aircraftStatus(reg); setChecks(st.checks || []); svc = st.serviceable; } catch { /* offline — optimistic */ }
      setFinalize({ frac: 1, label: svc === false ? '✓ Recorded — other item(s) still keep the aircraft unserviceable' : '✓ Aircraft serviceable — countdown reset' });
      setMsg(wasQueued
        ? `${tpl?.title} certified ✓ — recorded on this iPad; the countdown has reset now. It syncs automatically when online (printable once synced).`
        : `${tpl?.title} ${wasAmend ? 'amended' : 'certified'} ✓ — preview / print below.`);
      loadRecent();
      setTimeout(() => setFinalize(null), 2600);
    } catch (e: any) { setFinalize(null); setMsg(`Failed: ${e.message}`); }
  }

  async function startAmend(c: CheckRecord) {
    if (!(await confirmAction('Amend this signed check?\n\nThe original is kept (superseded) and you re-sign a corrected copy. Allowed only before the next departure release.', 'Amend check'))) return;
    setState(c.data || {}); setAmendingId(c.id); setAmendReason(''); setDoneId(null);
    setInspSigner(c.insp_signer_name || ''); setInspLicence(c.insp_licence_no || ''); setInspSig('');
    setMsg('Amending — correct the entries, enter a reason, then re-sign (inspector re-signs too if INSP items apply).');
    scrollRef.current?.scrollTo({ y: 0, animated: true });
  }

  async function output(mode: 'print' | 'pdf') {
    if (!doneId) return;
    try {
      const { html } = await checkHtml(doneId);
      if (mode === 'print') await printHtml(html); else await shareHtml(html);
    } catch (e: any) { Alert.alert('Print', e.message); }
  }

  async function preview() {
    try {
      const { html } = await previewCheck(reg, kind, {
        data: state, signer_name: signer.trim() || undefined, licence_no: licence.trim() || undefined,
        tlb_no: tlb.trim() || undefined,
        insp_signer_name: inspSigner.trim() || undefined, insp_licence_no: inspLicence.trim() || undefined,
        insp_signature_image: inspSig || undefined,
      });
      await printHtml(html);                         // opens the print preview (official format)
    } catch (e: any) { Alert.alert('Preview', e.message); }
  }

  return (
    <ScrollView ref={scrollRef} style={s.wrap} contentContainerStyle={{ padding: 16, width: '100%', maxWidth: 860, alignSelf: 'center' }} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
      <Text style={s.title}>Planned Maintenance · {reg}</Text>
      <View style={{ backgroundColor: theme.panel, borderWidth: 1, borderColor: theme.border, borderRadius: 10, padding: 12, marginBottom: 12 }}>
        <Text style={{ color: theme.sub, fontSize: 12, fontWeight: '700', marginBottom: 6, textTransform: 'uppercase' }}>Check status (due based on last completed)</Text>
        {checks.length === 0 ? <Text style={{ color: theme.sub, fontSize: 12 }}>Loading…</Text> : checks.map((c) => {
          const pending = !c.baseline;
          const color = (pending || c.expired) ? theme.red : (c.days_left != null && c.days_left <= 1 ? '#ffb84d' : theme.green);
          return (
            <View key={c.kind} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4 }}>
              <Text style={{ color: theme.text, fontWeight: '700', fontSize: 13 }}>{c.label}</Text>
              <Text style={{ color, fontSize: 12, fontWeight: '700' }}>
                {pending ? 'Pending — due ASAP (no prior check)'
                  : c.expired ? `OVERDUE · was due ${c.due?.slice(0, 10)}`
                  : (() => { const d = c.days_left ?? 0; const h = Math.max(0, Math.round((c.hours_left ?? 0) - d * 24)); return `Due ${c.due?.slice(0, 10)} · ${d > 0 ? `${d}d ${h}h` : `${h}h`} left`; })()}
              </Text>
            </View>
          );
        })}
      </View>
      <View style={{ backgroundColor: theme.panel, borderWidth: 1, borderColor: theme.border, borderRadius: 10, padding: 12, marginBottom: 12 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <Text style={{ color: theme.sub, fontSize: 12, fontWeight: '700', textTransform: 'uppercase' }}>Maintenance tasks (CAMO){mtasks.filter((t) => t.status === 'open').length ? ` · ${mtasks.filter((t) => t.status === 'open').length} open` : ''}</Text>
          <TouchableOpacity onPress={() => setShowDone((v) => !v)}><Text style={{ color: theme.accent, fontWeight: '700', fontSize: 12 }}>{showDone ? 'Show open' : 'Completed ▾'}</Text></TouchableOpacity>
        </View>
        {(() => {
          const shown = mtasks.filter((t) => (showDone ? t.status === 'completed' : t.status === 'open'));
          if (shown.length === 0) return <Text style={{ color: theme.sub, fontSize: 12 }}>{showDone ? 'No completed tasks.' : 'No open tasks for this aircraft.'}</Text>;
          return shown.map((t) => {
            const meta = [t.ata && `ATA ${t.ata}`, t.reference, t.due_date && `due ${t.due_date}`].filter(Boolean).join(' · ');
            return (
              <View key={t.id} style={{ borderTopWidth: 1, borderTopColor: theme.border, paddingVertical: 8 }}>
                <Text style={{ color: theme.text, fontWeight: '800', fontSize: 14 }}>{t.title}{t.registration === 'ALL' ? '  · ALL A/C' : ''}</Text>
                {meta ? <Text style={{ color: theme.sub, fontSize: 11, marginTop: 2 }}>{meta}</Text> : null}
                {t.description ? <Text style={{ color: '#cde', fontSize: 13, marginTop: 3 }}>{t.description}</Text> : null}
                {t.status === 'completed'
                  ? <Text style={{ color: theme.green, fontSize: 11, marginTop: 4 }}>✓ {t.completed_at?.slice(0, 10)} by {t.completed_by_name}{t.tlb_no ? ` · TL ${t.tlb_no}` : ''}</Text>
                  : canEdit ? <TouchableOpacity onPress={() => doneTask(t)} style={{ marginTop: 6 }}><Text style={{ color: theme.accent, fontWeight: '800' }}>Mark done ✓</Text></TouchableOpacity> : null}
              </View>
            );
          });
        })()}
      </View>

      <View style={s.tabs}>
        {(['2day', '10day'] as const).map((k) => (
          <TouchableOpacity key={k} style={[s.tab, kind === k && s.tabOn]} onPress={() => setKind(k)}>
            <Text style={[s.tabTxt, kind === k && s.tabTxtOn]}>{k === '2day' ? '02 Days Check' : '10 Days Check'}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {!tpl ? <Text style={s.sub}>{msg || 'Loading…'}</Text> : (
        <>
          <Text style={s.sub}>{tpl.title} · {tpl.rev} · validity {tpl.validity_days} days</Text>
          {tpl.description ? <Text style={s.descr}>{tpl.description}</Text> : null}
          {tpl.reason ? <Text style={s.descr}>Reason: {tpl.reason}</Text> : null}
          {(tpl.header_notes || []).map((n, i) => (
            <Text key={i} style={[s.hnote, n.label === 'WARNING' || n.label === 'CAUTION' ? { color: theme.red } : null]}>
              {n.label}: {n.text}
            </Text>
          ))}
          {!certified && (<>
          {tpl.sections.map((sec) => (
            <View key={sec.title} style={{ marginTop: 14 }} onLayout={(e) => { secY.current[sec.title] = e.nativeEvent.layout.y; }}>
              <Text style={s.section}>{sec.title}</Text>
              {sec.tasks.map((t) => (
                <View key={t.id} style={[s.task, badId === t.id ? { borderColor: theme.red, borderWidth: 2 } : null]}
                  onLayout={(e) => { taskY.current[t.id] = e.nativeEvent.layout.y; taskSection.current[t.id] = sec.title; }}>
                  <Text style={s.taskTxt}>{t.text}</Text>
                  {t.note ? <Text style={s.tnote}>NOTE: {t.note}</Text> : null}
                  <View style={s.row}>
                    <View style={s.signCol}><Text style={s.signLbl}>MECH</Text>
                      <Switch value={!!state[t.id]?.mech} onValueChange={(v) => { set(t.id, { mech: v }); if (badId === t.id) setBadId(null); }} /></View>
                    {t.insp ? (
                      <View style={s.signCol}><Text style={[s.signLbl, { color: theme.accent }]}>INSP</Text>
                        <Switch value={!!state[t.id]?.insp} onValueChange={(v) => { set(t.id, { insp: v }); if (badId === t.id) setBadId(null); }} /></View>
                    ) : null}
                  </View>
                  {t.fields?.length ? (
                    <View style={s.fields}>
                      {t.fields.map((f) => {
                        const fid = `${t.id}::${f.key}`;
                        return (
                        <View key={f.key} style={{ width: 110 }}>
                          <Text style={s.fLbl}>{f.label}</Text>
                          <TextInput ref={(r) => { fieldRefs.current[fid] = r; }}
                            style={[s.fInput, badId === fid ? { borderColor: theme.red, borderWidth: 2 } : null]}
                            value={state[t.id]?.fields?.[f.key] ?? ''} keyboardType="numeric"
                            onChangeText={(v) => { setField(t.id, f.key, v); if (badId === fid) setBadId(null); }} />
                        </View>
                      ); })}
                    </View>
                  ) : null}
                </View>
              ))}
            </View>
          ))}

          <Text style={s.section}>{hasInsp ? 'Certification — Mechanic' : 'Certification'}</Text>
          {!canEdit ? <RoBanner text="only certifying staff (mechanic) may complete checks" /> : null}
          <TextInput style={s.input} editable={canEdit} value={signer} onChangeText={setSigner} placeholder="Mechanic name" placeholderTextColor={theme.sub} />
          <TextInput style={s.input} editable={canEdit} value={licence} onChangeText={setLicence} placeholder="Licence / Part-145 auth no." placeholderTextColor={theme.sub} />
          {hasInsp ? (
            <View style={{ marginTop: 8, borderWidth: 1, borderColor: theme.accent, borderRadius: 10, padding: 12, backgroundColor: theme.panel }}>
              <Text style={{ color: theme.accent, fontWeight: '800', fontSize: 13, textTransform: 'uppercase' }}>Independent Inspection (INSP)</Text>
              <Text style={[s.sub, { marginTop: 2 }]}>This check has INSP item(s) — a second qualified person must certify, separately from the mechanic.</Text>
              <TextInput style={s.input} editable={canEdit} value={inspSigner} onChangeText={setInspSigner} placeholder="Inspector name" placeholderTextColor={theme.sub} />
              <TextInput style={s.input} editable={canEdit} value={inspLicence} onChangeText={setInspLicence} placeholder="Inspector licence / auth no." placeholderTextColor={theme.sub} />
              {canEdit ? (
                <TouchableOpacity style={[s.btn, { backgroundColor: inspSig ? theme.tile : theme.accent, marginTop: 10 }]} onPress={() => setSigTarget('insp')}>
                  <Text style={[s.btnTxt, inspSig ? null : { color: '#1a1300' }]}>{inspSig ? 'Inspector signature captured ✓ — tap to re-sign' : 'Capture inspector signature'}</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          ) : null}
          <TextInput style={s.input} editable={canEdit} value={tlb} onChangeText={setTlb} placeholder="Tech Log number (auto-filled — editable / clearable)" placeholderTextColor={theme.sub} />
          {amendingId ? (
            <TextInput style={[s.input, { borderColor: theme.accent }]} editable={canEdit} value={amendReason} onChangeText={setAmendReason}
              placeholder="Reason for amendment (required)" placeholderTextColor={theme.sub} multiline />
          ) : null}
          {remaining ? <Text style={[s.sub, { color: theme.red }]}>{remaining} item(s) still to complete — all tasks, inspections and data fields are mandatory before signing.</Text>
            : <Text style={[s.sub, { color: theme.green }]}>All items complete ✓ — ready to sign.</Text>}
          <TouchableOpacity style={[s.btn, { backgroundColor: theme.tile }]} onPress={preview}>
            <Text style={s.btnTxt}>Preview (before signing)</Text>
          </TouchableOpacity>
          {canEdit ? (
          <TouchableOpacity style={[s.btn, { backgroundColor: theme.green }]} onPress={trySign}>
            <Text style={s.btnTxt}>{amendingId ? `Re-sign amended ${tpl.title}` : `Sign & certify ${tpl.title}`}</Text>
          </TouchableOpacity>) : null}
          </>)}
          {certified ? (
            <View style={{ marginTop: 12, padding: 14, borderWidth: 1, borderColor: theme.green, borderRadius: 10, backgroundColor: theme.tile }}>
              <Text style={{ color: theme.green, fontWeight: '800', fontSize: 15 }}>✓ {tpl.title} certified</Text>
              <Text style={[s.sub, { marginTop: 4 }]}>Signed and recorded — the countdown has reset. Print or save it below, or start another check.</Text>
              <TouchableOpacity style={[s.btn, { backgroundColor: theme.tile, borderWidth: 1, borderColor: theme.border, marginTop: 10, alignSelf: 'flex-start' }]}
                onPress={() => { setDoneId(null); setQueued(false); setState({}); setSigner(''); setLicence(''); setInspSigner(''); setInspLicence(''); setInspSig(''); setMsg(''); }}>
                <Text style={s.btnTxt}>Start another check</Text>
              </TouchableOpacity>
            </View>
          ) : null}
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
          {doneId && !queued ? (
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
              <TouchableOpacity style={[s.btn, { flex: 1, backgroundColor: theme.tile }]} onPress={() => output('print')}>
                <Text style={s.btnTxt}>Preview / Print</Text></TouchableOpacity>
              <TouchableOpacity style={[s.btn, { flex: 1, backgroundColor: theme.tile }]} onPress={() => output('pdf')}>
                <Text style={s.btnTxt}>Save PDF</Text></TouchableOpacity>
            </View>
          ) : null}
          {doneId && queued ? (
            <Text style={[s.sub, { marginTop: 10, color: theme.accent }]}>Recorded offline — the certificate becomes printable here once this iPad syncs with the server.</Text>
          ) : null}

          <Text style={s.section}>Completed checks · last {viewDays} days</Text>
          {recent.filter((c) => c.kind === kind).length === 0 ? <Text style={s.sub}>None in the last {viewDays} days.</Text>
            : recent.filter((c) => c.kind === kind).map((c) => (
            <View key={c.id} style={s.rec}>
              <TouchableOpacity style={{ flex: 1 }} onPress={() => viewRecord(c.id)}>
                <Text style={s.recTitle}>{c.kind === '2day' ? '02 Days Check' : '10 Days Check'}</Text>
                <Text style={s.sub}>{c.completed_at?.slice(0, 16).replace('T', ' ')} · {c.signer_name || ''}{c.licence_no ? ` · ${c.licence_no}` : ''}</Text>
              </TouchableOpacity>
              {canEdit && c.amendable ? (
                <TouchableOpacity onPress={() => startAmend(c)} style={{ paddingHorizontal: 8 }}>
                  <Text style={[s.recView, { color: theme.accent }]}>Amend</Text></TouchableOpacity>
              ) : null}
              <TouchableOpacity onPress={() => viewRecord(c.id)}><Text style={s.recView}>View / Print</Text></TouchableOpacity>
            </View>
          ))}
        </>
      )}

      <SignaturePad visible={sigTarget !== null}
        title={sigTarget === 'insp' ? 'Independent inspector signature' : `Certify ${tpl?.title || 'check'}`}
        onClose={() => setSigTarget(null)}
        onDone={(dataUrl) => {
          if (sigTarget === 'insp') { setInspSig(dataUrl); setSigTarget(null); }
          else { setSigTarget(null); submit(dataUrl); }
        }} />
    </ScrollView>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.bg },
  title: { color: theme.text, fontSize: 20, fontWeight: '800' },
  sub: { color: theme.sub, marginTop: 6, fontSize: 13 },
  descr: { color: theme.sub, marginTop: 6, fontSize: 12, lineHeight: 17 },
  hnote: { color: theme.text, marginTop: 6, fontSize: 11, lineHeight: 16 },
  tnote: { color: theme.accent, marginTop: 5, fontSize: 11, lineHeight: 16 },
  tabs: { flexDirection: 'row', gap: 8, marginTop: 12 },
  tab: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 8, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.tile },
  tabOn: { backgroundColor: theme.accent, borderColor: theme.accent },
  tabTxt: { color: theme.sub, fontWeight: '700', fontSize: 13 },
  tabTxtOn: { color: '#1a1300' },
  section: { color: theme.text, fontWeight: '800', fontSize: 13, marginTop: 18, marginBottom: 6, textTransform: 'uppercase' },
  task: { backgroundColor: theme.panel, borderWidth: 1, borderColor: theme.border, borderRadius: 8, padding: 10, marginBottom: 8 },
  taskTxt: { color: theme.text, fontSize: 13 },
  row: { flexDirection: 'row', gap: 18, marginTop: 8 },
  signCol: { alignItems: 'center' },
  signLbl: { color: theme.sub, fontSize: 10, fontWeight: '800', marginBottom: 2 },
  fields: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 8 },
  fLbl: { color: theme.sub, fontSize: 10, marginBottom: 3 },
  fInput: { backgroundColor: theme.tile, color: theme.text, borderWidth: 1, borderColor: theme.border, borderRadius: 6, padding: 8 },
  input: { backgroundColor: theme.tile, color: theme.text, borderWidth: 1, borderColor: theme.border, borderRadius: 8, padding: 12, marginTop: 10 },
  btn: { borderRadius: 8, padding: 14, alignItems: 'center', marginTop: 16 },
  btnTxt: { color: '#fff', fontWeight: '700' },
  msg: { color: theme.green, marginTop: 10 },
  rec: { flexDirection: 'row', alignItems: 'center', backgroundColor: theme.panel, borderWidth: 1, borderColor: theme.border, borderRadius: 8, padding: 12, marginTop: 8 },
  recTitle: { color: theme.text, fontWeight: '700' },
  recView: { color: theme.accent, fontWeight: '700' },
});
