import React, { useEffect, useState } from 'react';
import { ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { theme } from '../theme';
import { confirmAction } from '../util/confirm';
import { numericOnly, sx, useSector } from './sectorShared';

const TYPES = ['I', 'II', 'III', 'IV'];
const STEPS = ['One-step', 'Two-step'];

export default function DeicingScreen({ route, navigation }: any) {
  const { sectorId } = route.params;
  const { s, save } = useSector(sectorId);
  const [d, setD] = useState<any>({});

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

  const F = ({ label, k, placeholder, kb }: any) => (
    <View style={{ marginTop: 10 }}>
      <Text style={{ color: theme.sub, fontSize: 12, marginBottom: 4 }}>{label}</Text>
      <TextInput style={sx2.input} value={d[k] == null ? '' : String(d[k])} onChangeText={(v) => set(k, kb === 'numeric' ? numericOnly(v) : v)}
        placeholder={placeholder} placeholderTextColor={theme.sub} keyboardType={kb || 'default'} autoCapitalize="characters" />
    </View>
  );

  return (
    <ScrollView style={sx.wrap} contentContainerStyle={{ padding: 16, width: '100%', maxWidth: 860, alignSelf: 'center' }} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
      <Text style={sx.title}>De-icing / Anti-icing · {s.flight_no}</Text>
      <Text style={sx.sub}>Record the de/anti-icing applied at departure. The anti-icing code is printed on the Tech Log.</Text>

      <Text style={sx.section}>Procedure</Text>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {STEPS.map((p) => (
          <TouchableOpacity key={p} onPress={() => set('procedure', p)}
            style={[sx2.chip, d.procedure === p && sx2.chipOn]}><Text style={[sx2.chipTxt, d.procedure === p && sx2.chipTxtOn]}>{p}</Text></TouchableOpacity>
        ))}
      </View>

      <Text style={sx.section}>Fluid type</Text>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {TYPES.map((t) => (
          <TouchableOpacity key={t} onPress={() => set('type', t)}
            style={[sx2.chip, d.type === t && sx2.chipOn]}><Text style={[sx2.chipTxt, d.type === t && sx2.chipTxtOn]}>Type {t}</Text></TouchableOpacity>
        ))}
      </View>

      <F label="Fluid brand / name" k="fluid" placeholder="e.g. Kilfrost ABC-S" />
      <F label="Mixture (fluid/water %)" k="mix" placeholder="e.g. 75/25 or 100" />
      <F label="OAT (°C)" k="oat" placeholder="e.g. -4" kb="numbers-and-punctuation" />
      <F label="Time of final application (UTC, HH:MM)" k="start_time" placeholder="e.g. 14:32" />
      <F label="Holdover time / lower limit (min)" k="hot" placeholder="e.g. 35" kb="numeric" />
      <F label="Areas treated" k="areas" placeholder="e.g. wings, stab, fuselage" />
      <F label="Performed by / agent" k="by" placeholder="e.g. station de-icing crew" />

      <View style={{ backgroundColor: theme.panel, borderWidth: 1, borderColor: theme.border, borderRadius: 8, padding: 12, marginTop: 16 }}>
        <Text style={{ color: theme.sub, fontSize: 12 }}>Anti-icing code (auto)</Text>
        <Text style={{ color: theme.text, fontWeight: '800', fontSize: 16, marginTop: 4 }}>{code || '—'}</Text>
      </View>

      <TouchableOpacity style={[sx.save, { backgroundColor: theme.accent }]} onPress={onSave}>
        <Text style={[sx.saveText, { color: '#1a1300' }]}>Save de-icing data</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const sx2 = {
  input: { backgroundColor: theme.tile, color: theme.text, borderWidth: 1, borderColor: theme.border, borderRadius: 8, padding: 12 } as any,
  chip: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 8, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.tile } as any,
  chipOn: { backgroundColor: theme.accent, borderColor: theme.accent } as any,
  chipTxt: { color: theme.sub, fontWeight: '700' } as any,
  chipTxtOn: { color: '#1a1300' } as any,
};
