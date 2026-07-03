import React, { useEffect, useRef } from 'react';
import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { theme } from '../theme';

// Web build: react-native-signature-canvas relies on react-native-webview, which
// doesn't run in a browser. This draws on a real HTML5 canvas instead and returns
// the same base64 PNG via onDone. The iPad uses SignaturePad.tsx (WebView) unchanged.
export default function SignaturePad({ visible, onClose, onDone, title = 'Sign' }: {
  visible: boolean; onClose: () => void; onDone: (dataUrl: string) => void; title?: string;
}) {
  const ref = useRef<any>(null);
  const drawing = useRef(false);

  useEffect(() => {
    if (!visible) return;
    const cv = ref.current;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.strokeStyle = '#000'; ctx.lineWidth = 2.5; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const pt = (e: any) => {
      const r = cv.getBoundingClientRect();
      const t = e.touches ? e.touches[0] : e;
      return { x: (t.clientX - r.left) * (cv.width / r.width), y: (t.clientY - r.top) * (cv.height / r.height) };
    };
    const start = (e: any) => { drawing.current = true; const p = pt(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); e.preventDefault(); };
    const move = (e: any) => { if (!drawing.current) return; const p = pt(e); ctx.lineTo(p.x, p.y); ctx.stroke(); e.preventDefault(); };
    const end = () => { drawing.current = false; };
    cv.addEventListener('mousedown', start); cv.addEventListener('mousemove', move); window.addEventListener('mouseup', end);
    cv.addEventListener('touchstart', start, { passive: false }); cv.addEventListener('touchmove', move, { passive: false }); cv.addEventListener('touchend', end);
    return () => {
      cv.removeEventListener('mousedown', start); cv.removeEventListener('mousemove', move); window.removeEventListener('mouseup', end);
      cv.removeEventListener('touchstart', start); cv.removeEventListener('touchmove', move); cv.removeEventListener('touchend', end);
    };
  }, [visible]);

  function clear() { const cv = ref.current; if (!cv) return; const ctx = cv.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height); }
  function use() { const cv = ref.current; if (cv) onDone(cv.toDataURL('image/png')); }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={s.wrap}>
        <Text style={s.title}>{title}</Text>
        <Text style={s.sub}>Sign with your mouse, trackpad, or touch screen.</Text>
        <View style={s.canvas}>
          {React.createElement('canvas', { ref, width: 1000, height: 380,
            style: { width: '100%', height: '100%', background: '#fff', borderRadius: 10, touchAction: 'none', cursor: 'crosshair' } } as any)}
        </View>
        <View style={s.row}>
          <TouchableOpacity style={[s.btn, { backgroundColor: theme.tile }]} onPress={onClose}><Text style={s.btnTxt}>Cancel</Text></TouchableOpacity>
          <TouchableOpacity style={[s.btn, { backgroundColor: theme.tile }]} onPress={clear}><Text style={s.btnTxt}>Clear</Text></TouchableOpacity>
          <TouchableOpacity style={[s.btn, { backgroundColor: theme.green }]} onPress={use}><Text style={[s.btnTxt, { color: '#fff' }]}>Use signature</Text></TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.bg, padding: 16, paddingTop: 48 },
  title: { color: theme.text, fontSize: 20, fontWeight: '800' },
  sub: { color: theme.sub, marginTop: 4, marginBottom: 10 },
  canvas: { flex: 1, backgroundColor: '#fff', borderRadius: 10, overflow: 'hidden' },
  row: { flexDirection: 'row', gap: 10, marginTop: 14 },
  btn: { flex: 1, borderRadius: 8, padding: 14, alignItems: 'center' },
  btnTxt: { color: theme.text, fontWeight: '700' },
});
