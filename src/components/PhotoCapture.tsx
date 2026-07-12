import React, { useEffect, useState } from 'react';
import * as ImagePicker from 'expo-image-picker';
import { ActivityIndicator, Image, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Attachment, attachmentUrl, listAttachments, uploadAttachment } from '../api/client';
import { queueAttachment } from '../db/attachments';
import { theme } from '../theme';

type Props = { defectId?: string; sectorId?: string; kind?: 'damage' | 'receipt' | 'document'; label?: string; readOnly?: boolean };

function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

// Capture/attach photos (damage, receipts, documents). Uploads when online,
// otherwise queues locally and flushes on the next sync.
export default function PhotoCapture({ defectId, sectorId, kind = 'damage', label = 'Photos', readOnly = false }: Props) {
  const [items, setItems] = useState<Attachment[]>([]);
  const [busy, setBusy] = useState(false);

  async function load() {
    try { setItems(await listAttachments({ defect_id: defectId, sector_id: sectorId })); } catch {}
  }
  useEffect(() => { load(); }, [defectId, sectorId]);

  async function add(fromCamera: boolean) {
    const perm = fromCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return;
    const res = fromCamera
      ? await ImagePicker.launchCameraAsync({ base64: true, quality: 0.5 })
      : await ImagePicker.launchImageLibraryAsync({ base64: true, quality: 0.5, mediaTypes: ImagePicker.MediaTypeOptions.Images });
    if (res.canceled || !res.assets?.[0]?.base64) return;
    setBusy(true);
    const body = {
      id: uuid(), kind, defect_id: defectId, sector_id: sectorId,
      filename: `${kind}-${Date.now()}.jpg`, content_type: 'image/jpeg',
      data_b64: res.assets[0].base64!,
    };
    try { await uploadAttachment(body); }
    catch { await queueAttachment(body); }      // offline → flush on sync
    finally { setBusy(false); load(); }
  }

  const hasItems = items.length > 0 || busy;
  if (readOnly && items.length === 0) return null;    // closed defect with no photos → nothing to show
  return (
    <View style={{ marginTop: label ? 12 : 0 }}>
      {label ? <Text style={s.lbl}>{label}</Text> : null}
      {hasItems ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginVertical: 8 }}>
          {items.map((a) => (
            <Image key={a.id} source={{ uri: attachmentUrl(a.id) }} style={s.thumb} />
          ))}
          {busy ? <View style={[s.thumb, s.center]}><ActivityIndicator color={theme.accent} /></View> : null}
        </ScrollView>
      ) : null}
      {!readOnly ? (
        <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
          <TouchableOpacity style={s.btn} onPress={() => add(true)}><Text style={s.btnTxt}>📷 Take photo</Text></TouchableOpacity>
          <TouchableOpacity style={s.btn} onPress={() => add(false)}><Text style={s.btnTxt}>🖼 Library</Text></TouchableOpacity>
        </View>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  lbl: { color: theme.sub, fontSize: 12 },
  thumb: { width: 76, height: 76, borderRadius: 8, marginRight: 8, backgroundColor: theme.tile, borderWidth: 1, borderColor: theme.border },
  center: { alignItems: 'center', justifyContent: 'center' },
  btn: { backgroundColor: theme.tile, borderWidth: 1, borderColor: theme.border, borderRadius: 8, paddingVertical: 10, paddingHorizontal: 14 },
  btnTxt: { color: theme.text, fontWeight: '700' },
});
