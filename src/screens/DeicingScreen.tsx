import React, { useEffect, useState } from 'react';
import { ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { appSettings, currentAircraft } from '../api/client';
import { theme } from '../theme';
import { confirmAction } from '../util/confirm';
import { hhmm, numericOnly, sx, useSector } from './sectorShared';

type FieldConf = Record<string, { visible?: boolean; required?: boolean; label?: string }>;

const TYPES = ['I', 'II', 'III', 'IV'];
const STEPS = ['One-step', 'Two-step'];

export default function DeicingScreen({ route, navigation }: any) {
  const { sectorId } = route.params;
  const { s, save } = useSector(sectorId);
  const [d, setD] = useState<any>({});
  const [fc, setFc] = useState<FieldConf>({});

  useEffect(() => { appSettings().then((x: any) => {
    const raw = x.field_config?.deicing;
    if (raw) setFc(raw);
  }).catch(() => {}); }, []);
  const isVis = (k: string) => fc[k]?.visible !== false;
  const fcLabel = (k: string, def: string) => fc[k]?.label || def;

  useEffect(() => { if (s) setD(s.deice || {}); }, [!!s]);
  if (!s) return <View style={sx.wrap}><Text style={sx.sub}>Loading…</Text></View>;

  const set = (k: string, v: any) => setD((p: any) => ({ ...p, [k]: v }));
  // Anti-icing code per AEA/ICAO: fluid type / mix / time of final application.
  const code = [d.type ? `Type ${d.type}` : '', d.mix || '', d.start_time || ''].filter(Boolean).join(' / ');

  async function onSave() {
    if (!(await confirmAction('Save de-icing data?'))) return;
    await save({ deice: { ...d, code }, ice_protect: true });
    navigation.goBack();
  }

  const F = ({ label, k, placeholder, kb }: any) => {
    if (!isVis(k)) return null;
    const lbl = fcLabel(k, label) + (fc[k]?.required ? ' *' : '');
    return (
      <View style={{ marginTop: 10 }}>
        <Text style={{ color: theme.sub, fontSize: 12, marginBottom: 4 }}>{lbl}</Text>
        <TextInput style={sx2.input} value={d[k] == null ? '' : String(d[k])} onChangeText={(v) => set(k, kb === 'numeric' ? numericOnly(v) : v)}
          placeholder={placeholder} placeholderTextColor={theme.sub} keyboardType={kb || 'default'} autoCapitalize="characters" />
      </View>
    );
  };

  return (
    <ScrollView style={sx.wrap} contentContainerStyle={{ padding: 16, width: '100%', maxWidth: 860, alignSelf: 'center' }} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
      <Text style={sx.title}>De-icing / Anti-icing · {currentAircraft()?.registration || s.aircraft_id} · {s.flight_no} · {s.dep} → {s.arr}</Text>
      <Text style={sx.sub}>{s.flight_date} · STD {hhmm(s.std)} · STA {hhmm(s.sta)}</Text>

      <Text style={sx.section}>Procedure</Text>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {STEPS.map((p) => (
          <TouchableOpacity key={p} onPress={() => set('procedure', p)}
            style={[sx2.chip, d.procedure === p && sx2.chipOn]}><Text style={[sx2.chipTxt, d.procedure === p && sx2.chipTxtOn]}>{p}</Text></TouchableOpacity>
        ))}
      </View>

      {d.procedure === 'Two-step' ? (
        <>
          {/* Step 1 — DE-ICING (removal). Separate from the anti-icing (protection) fluid below;
              the Tech Log prints each in its own box. */}
          <Text style={sx.section}>Step 1 — de-icing fluid</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {TYPES.map((t) => (
              <TouchableOpacity key={t} onPress={() => set('de_type', t)}
                style={[sx2.chip, d.de_type === t && sx2.chipOn]}><Text style={[sx2.chipTxt, d.de_type === t && sx2.chipTxtOn]}>Type {t}</Text></TouchableOpacity>
            ))}
          </View>
          <F label="De-icing mixture (fluid/water %)" k="de_mix" placeholder="e.g. heated 60/40" />
          <F label="De-icing fluid quantity (L)" k="de_qty_l" placeholder="e.g. 300" kb="numeric" />
          <Text style={sx.section}>Step 2 — anti-icing fluid</Text>
        </>
      ) : (
        <Text style={sx.section}>Fluid type</Text>
      )}
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {TYPES.map((t) => (
          <TouchableOpacity key={t} onPress={() => set('type', t)}
            style={[sx2.chip, d.type === t && sx2.chipOn]}><Text style={[sx2.chipTxt, d.type === t && sx2.chipTxtOn]}>Type {t}</Text></TouchableOpacity>
        ))}
      </View>

      <F label="Fluid brand / name" k="fluid" placeholder="e.g. Kilfrost ABC-S" />
      <F label="Mixture (fluid/water %)" k="mix" placeholder="e.g. 75/25 or 100" />
      <F label="Fluid quantity used (L)" k="qty_l" placeholder="e.g. 120" kb="numeric" />
      <F label="OAT (°C)" k="oat" placeholder="e.g. -4" kb="numbers-and-punctuation" />
      {/* Holdover time runs from the START of the final application; end time completes the record. */}
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <View style={{ flex: 1 }}><F label="Start of application (UTC, HH:MM) — holdover starts HERE" k="start_time" placeholder="e.g. 14:28" /></View>
        <View style={{ flex: 1 }}><F label="End time (UTC, HH:MM)" k="end_time" placeholder="e.g. 14:32" /></View>
      </View>
      <F label="Holdover time / lower limit (min)" k="hot" placeholder="e.g. 35" kb="numeric" />
      {/* HOT runs from the START of the final application (not the end) — show the expiry live. */}
      {(() => {
        const m = String(d.start_time || '').match(/^(\d{1,2}):(\d{2})$/);
        const hot = Number(d.hot);
        if (!m || !hot) return null;
        const t = (Number(m[1]) * 60 + Number(m[2]) + hot) % 1440;
        const hh = String(Math.floor(t / 60)).padStart(2, '0'), mm = String(t % 60).padStart(2, '0');
        return <Text style={[sx.sub, { color: theme.accent, marginTop: 4 }]}>Holdover runs from the START of application: protection until ≈ {hh}:{mm}z</Text>;
      })()}
      <F label="Areas treated" k="areas" placeholder="e.g. wings, stab, fuselage" />
      <F label="Performed by / agent" k="by" placeholder="e.g. station de-icing crew" />

      <View style={{ backgroundColor: theme.panel, borderWidth: 1, borderColor: theme.border, borderRadius: 8, padding: 12, marginTop: 16 }}>
        <Text style={{ color: theme.sub, fontSize: 12 }}>Anti-icing code (auto)</Text>
        <Text style={{ color: theme.text, fontWeight: '800', fontSize: 16, marginTop: 4 }}>{code || '—'}</Text>
      </View>

      <TouchableOpacity style={[sx.save, { backgroundColor: theme.accent }]} onPress={onSave}>
        <Text style={[sx.saveText, { color: theme.onAccent }]}>Save de-icing data</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const sx2 = {
  input: { backgroundColor: theme.tile, color: theme.text, borderWidth: 1, borderColor: theme.border, borderRadius: 8, padding: 12 } as any,
  chip: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 8, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.tile } as any,
  chipOn: { backgroundColor: theme.accent, borderColor: theme.accent } as any,
  chipTxt: { color: theme.sub, fontWeight: '700' } as any,
  chipTxtOn: { color: theme.onAccent } as any,
};
