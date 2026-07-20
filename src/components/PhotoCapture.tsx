import React, { useEffect, useState } from 'react';
import * as ImagePicker from 'expo-image-picker';
import { ActivityIndicator, Alert, Image, Modal, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Attachment, attachmentUrl, deleteAttachment, listAttachments, uploadAttachment } from '../api/client';
import { queueAttachment } from '../db/attachments';
import { theme } from '../theme';

type Props = { defectId?: string; sectorId?: string; kind?: 'damage' | 'receipt' | 'document'; label?: string; readOnly?: boolean };

function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

// Capture/attach photos (damage, receipts, documents). Uploads when online, otherwise queues
// locally and flushes on the next sync. Once a photo exists the button becomes "View photo" —
// the viewer shows it large and offers Replace / Add another (until the record is signed).
export default function PhotoCapture({ defectId, sectorId, kind = 'damage', label = 'Photos', readOnly = false }: Props) {
  const [items, setItems] = useState<Attachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [viewer, setViewer] = useState(false);
  const [sel, setSel] = useState(0);

  async function load() {
    try { setItems(await listAttachments({ defect_id: defectId, sector_id: sectorId })); } catch {}
  }
  useEffect(() => { load(); }, [defectId, sectorId]);

  async function pick(fromCamera: boolean): Promise<string | null> {
    try {
      if (Platform.OS === 'web') {
        // Web: launchCameraAsync silently does nothing — the file dialog is the reliable path
        // (on an iPad's browser it offers "Take Photo" natively).
        const res = await ImagePicker.launchImageLibraryAsync({ base64: true, quality: 0.5, mediaTypes: ImagePicker.MediaTypeOptions.Images });
        return res.canceled || !res.assets?.[0]?.base64 ? null : res.assets[0].base64!;
      }
    } catch { return null; }
    // Native: never fail silently — say WHY the camera did not open and fall back to the library.
    try {
      const perm = fromCamera
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert(fromCamera ? 'Camera access is off' : 'Photo access is off',
          fromCamera
            ? 'Enable it in iOS Settings → ETL → Camera. On a managed (Jamf) iPad the MDM profile may block the camera — use 🖼 Library instead.'
            : 'Enable photo access in iOS Settings → ETL → Photos.');
        return null;
      }
      const res = fromCamera
        ? await ImagePicker.launchCameraAsync({ base64: true, quality: 0.5 })
        : await ImagePicker.launchImageLibraryAsync({ base64: true, quality: 0.5, mediaTypes: ImagePicker.MediaTypeOptions.Images });
      return res.canceled || !res.assets?.[0]?.base64 ? null : res.assets[0].base64!;
    } catch (e: any) {
      const { reportDeviceError } = require('../api/client');
      reportDeviceError({ kind: 'error', message: `photo picker failed: ${String(e?.message || e).slice(0, 200)}`, screen: 'PhotoCapture' }).catch(() => {});
      Alert.alert('Camera unavailable', `${String(e?.message || e).slice(0, 160)}\n\nUse 🖼 Library instead.`);
      return null;
    }
  }

  async function add(fromCamera: boolean, replaceId?: string) {
    const b64 = await pick(fromCamera);
    if (!b64) return;
    setBusy(true);
    const body = {
      id: uuid(), kind, defect_id: defectId, sector_id: sectorId,
      filename: `${kind}-${Date.now()}.jpg`, content_type: 'image/jpeg',
      data_b64: b64,
    };
    try {
      await uploadAttachment(body);
      if (replaceId) await deleteAttachment(replaceId).catch(() => {});   // replace = new photo in, old out
    } catch { await queueAttachment(body); }      // offline → flush on sync (old photo stays until online)
    finally { setBusy(false); setSel(0); load(); }
  }

  const hasItems = items.length > 0;
  if (readOnly && !hasItems) return null;    // closed record with no photos → nothing to show
  const cur = items[Math.min(sel, items.length - 1)];
  return (
    <View style={{ marginTop: label ? 12 : 0 }}>
      {label ? <Text style={s.lbl}>{label}</Text> : null}
      {hasItems || busy ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginVertical: 8 }}>
          {items.map((a, i) => (
            <TouchableOpacity key={a.id} onPress={() => { setSel(i); setViewer(true); }}>
              <Image source={{ uri: attachmentUrl(a.id) }} style={s.thumb} />
            </TouchableOpacity>
          ))}
          {busy ? <View style={[s.thumb, s.center]}><ActivityIndicator color={theme.accent} /></View> : null}
        </ScrollView>
      ) : null}
      <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
        {hasItems ? (
          <TouchableOpacity style={s.btn} onPress={() => { setSel(0); setViewer(true); }}>
            <Text style={s.btnTxt}>👁 View photo{items.length > 1 ? `s (${items.length})` : ''}</Text>
          </TouchableOpacity>
        ) : !readOnly ? (<>
          <TouchableOpacity style={s.btn} onPress={() => add(true)}><Text style={s.btnTxt}>📷 Take photo</Text></TouchableOpacity>
          <TouchableOpacity style={s.btn} onPress={() => add(false)}><Text style={s.btnTxt}>🖼 Library</Text></TouchableOpacity>
        </>) : null}
      </View>

      <Modal visible={viewer} transparent animationType="fade" onRequestClose={() => setViewer(false)}>
        <View style={s.viewerWrap}>
          <View style={s.viewerCard}>
            {cur ? <Image source={{ uri: attachmentUrl(cur.id) }} style={s.big} resizeMode="contain" /> : null}
            {items.length > 1 ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8 }}>
                {items.map((a, i) => (
                  <TouchableOpacity key={a.id} onPress={() => setSel(i)}>
                    <Image source={{ uri: attachmentUrl(a.id) }} style={[s.thumb, i === sel && { borderColor: theme.accent, borderWidth: 2 }]} />
                  </TouchableOpacity>
                ))}
              </ScrollView>
            ) : null}
            {!readOnly ? (
              <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
                <TouchableOpacity style={s.btn} onPress={() => add(true)}><Text style={s.btnTxt}>📷 Add another</Text></TouchableOpacity>
                <TouchableOpacity style={s.btn} onPress={() => add(false)}><Text style={s.btnTxt}>🖼 Add from library</Text></TouchableOpacity>
                {cur ? <TouchableOpacity style={s.btn} onPress={() => add(true, cur.id)}><Text style={s.btnTxt}>♻ Replace (📷)</Text></TouchableOpacity> : null}
                {cur ? <TouchableOpacity style={s.btn} onPress={() => add(false, cur.id)}><Text style={s.btnTxt}>♻ Replace (🖼)</Text></TouchableOpacity> : null}
              </View>
            ) : null}
            <TouchableOpacity style={[s.btn, { marginTop: 10, alignSelf: 'flex-end', backgroundColor: theme.accent }]} onPress={() => setViewer(false)}>
              <Text style={[s.btnTxt, { color: '#1a1300' }]}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  lbl: { color: theme.sub, fontSize: 12 },
  thumb: { width: 76, height: 76, borderRadius: 8, marginRight: 8, backgroundColor: theme.tile, borderWidth: 1, borderColor: theme.border },
  center: { alignItems: 'center', justifyContent: 'center' },
  btn: { backgroundColor: theme.tile, borderWidth: 1, borderColor: theme.border, borderRadius: 8, paddingVertical: 10, paddingHorizontal: 14 },
  btnTxt: { color: theme.text, fontWeight: '700' },
  viewerWrap: { flex: 1, backgroundColor: 'rgba(5,12,24,0.88)', alignItems: 'center', justifyContent: 'center', padding: 16 },
  viewerCard: { backgroundColor: theme.panel, borderWidth: 1, borderColor: theme.border, borderRadius: 12, padding: 12, width: '100%', maxWidth: 720 },
  big: { width: '100%', height: 380, borderRadius: 8, backgroundColor: theme.bg },
});
