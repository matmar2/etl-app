// OFP / briefing PDF viewer — NATIVE (iPad).
//
// A multi-MB base64 PDF handed to WKWebView as a `data:` URI crashes the app *natively* (WKWebView
// cannot hold a large data URI in memory — this crashed the iPad on the first OFP open). Instead we
// write the bytes to a cache file once and load it as `file://`, which WKWebView renders with its
// built-in PDF viewer and no memory blow-up. expo-file-system is in the 1.0.2 binary (also used by
// src/api/client.ts) and is loaded via require so it never evaluates at boot.
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Text, TouchableOpacity, View } from 'react-native';
import { WebView } from 'react-native-webview';
import * as Print from 'expo-print';
import { getDoc } from './api';
import { S, T } from './theme';

const card = { ...S.card, marginTop: 12 } as const;

export default function PdfViewer({ flightId, doc, setMsg, page }: any) {
  const [full, setFull] = useState<any>(null);
  const [fileUri, setFileUri] = useState<string | null>(null);
  useEffect(() => {
    setFull(null); setFileUri(null);
    getDoc(flightId, doc.id).then(setFull).catch((e: any) => setMsg(`Could not load ${doc.title} — ${e.message}`));
  }, [doc.id]);
  const ct = full?.content_type || 'application/pdf';
  const isPdf = ct.includes('pdf');
  useEffect(() => {
    if (!full || !isPdf) return;
    let alive = true;
    (async () => {
      try {
        const FileSystem = require('expo-file-system/legacy');
        const path = `${FileSystem.cacheDirectory}eff-${doc.id}.pdf`;
        await FileSystem.writeAsStringAsync(path, full.data_b64 || '', { encoding: FileSystem.EncodingType.Base64 });
        if (alive) setFileUri(path);
      } catch (e: any) { if (alive) setMsg(`Could not open ${doc.title} — ${e.message}`); }
    })();
    return () => { alive = false; };
  }, [full, isPdf]);
  if (!full || (isPdf && !fileUri)) return <ActivityIndicator style={{ marginTop: 20 }} />;
  const dataUri = `data:${ct};base64,${full.data_b64 || ''}`;
  const openFull = () => Print.printAsync({ uri: fileUri || dataUri }).catch((e: any) => setMsg(`Print failed — ${e.message}`));
  const src = page && isPdf && fileUri ? `${fileUri}#page=${page}` : (fileUri || dataUri);
  return (
    <View style={[card, { padding: 6 }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 4 }}>
        <Text style={{ color: T.sub, fontSize: 12, flex: 1 }}>{doc.title}</Text>
        <TouchableOpacity onPress={openFull}><Text style={{ color: T.accent, fontSize: 13 }}>⤢ Open full / print</Text></TouchableOpacity>
      </View>
      {isPdf ? (
        <WebView key={src} originWhitelist={['*']} source={{ uri: src }}
          allowFileAccess allowFileAccessFromFileURLs allowUniversalAccessFromFileURLs
          style={{ width: '100%', height: 720, borderRadius: 8, backgroundColor: '#fff' }}
          startInLoadingState setSupportMultipleWindows={false} />
      ) : (
        <Image source={{ uri: dataUri }} style={{ width: '100%', height: 720, borderRadius: 8 } as any} resizeMode="contain" />
      )}
    </View>
  );
}
