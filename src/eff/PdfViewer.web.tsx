// OFP / briefing PDF viewer — WEB.
//
// react-native-webview has NO web implementation (it throws "React Native WebView does not support
// this platform"), so on web we render a real DOM <iframe>. A Blob URL is used rather than a giant
// data: URI — more robust for multi-MB PDFs and revocable so it doesn't leak memory.
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Text, TouchableOpacity, View } from 'react-native';
import { getDoc, getCompanyDoc } from './api';
import { S, T } from './theme';

const card = { ...S.card, marginTop: 12 } as const;

export default function PdfViewer({ flightId, doc, setMsg, page }: any) {
  const [full, setFull] = useState<any>(null);
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    setFull(null);
    const fetch = doc.company_doc ? getCompanyDoc(doc.id) : getDoc(flightId, doc.id);
    fetch.then(setFull).catch((e: any) => setMsg(`Could not load ${doc.title} — ${e.message}`));
  }, [doc.id]);
  useEffect(() => {
    if (!full) return;
    try {
      const ct = full.content_type || 'application/pdf';
      const bytes = Uint8Array.from(atob(full.data_b64 || ''), (c) => c.charCodeAt(0));
      const u = URL.createObjectURL(new Blob([bytes], { type: ct }));
      setUrl(u);
      return () => { URL.revokeObjectURL(u); setUrl(null); };
    } catch (e: any) { setMsg(`Could not open ${doc.title} — ${e.message}`); }
  }, [full]);
  if (!full || !url) return <ActivityIndicator style={{ marginTop: 20 }} />;
  const ct = full.content_type || 'application/pdf';
  const isPdf = ct.includes('pdf');
  const src = page && isPdf ? `${url}#page=${page}` : url;
  const openFull = () => { if (typeof window !== 'undefined') window.open(url, '_blank'); };
  return (
    <View style={[card, { padding: 6 }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 4 }}>
        <Text style={{ color: T.sub, fontSize: 12, flex: 1 }}>{doc.title}</Text>
        <TouchableOpacity onPress={openFull}><Text style={{ color: T.accent, fontSize: 13 }}>⤢ Open full / print</Text></TouchableOpacity>
      </View>
      {isPdf
        ? React.createElement('iframe', { key: src, src, style: { width: '100%', height: 720, border: '0', borderRadius: 8, background: '#fff' } })
        : React.createElement('img', { src: url, style: { width: '100%', height: 720, objectFit: 'contain', borderRadius: 8 } })}
    </View>
  );
}
