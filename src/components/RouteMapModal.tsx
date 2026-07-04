import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { airportLookup } from '../api/client';
import { hhmm } from '../screens/sectorShared';
import { theme } from '../theme';
import MapCanvas from './MapCanvas';

// Geoapify map tiles — English labels everywhere via lang=en (free tier, client key).
// Restrict/rotate it in the Geoapify dashboard; to switch providers, change TILE_URL only.
const GEOAPIFY_KEY = '35cc051d3e9440919ed8c6a1ffdfd7ae';
const TILE_URL = `https://maps.geoapify.com/v1/tile/osm-bright/{z}/{x}/{y}.png?apiKey=${GEOAPIFY_KEY}&lang=en`;

type Pt = { lat: number; lon: number; code: string; name?: string | null };

// Great-circle distance in nautical miles.
function distNm(a: Pt, b: Pt): number {
  const R = 3440.065, r = Math.PI / 180;
  const dφ = (b.lat - a.lat) * r, dλ = (b.lon - a.lon) * r;
  const x = Math.sin(dφ / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dλ / 2) ** 2;
  return Math.round(2 * R * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x)));
}

// Self-contained Leaflet + OpenStreetMap page: great-circle line, labelled airport dots.
function buildHtml(dep: Pt, arr: Pt): string {
  const j = (o: any) => JSON.stringify(o);
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<style>html,body,#map{height:100%;margin:0}#map{background:#eef1f5}
.lab{background:#16202e;color:#fff;font:700 12px system-ui,-apple-system,sans-serif;
  padding:2px 7px;border-radius:5px;border:0;box-shadow:0 1px 3px rgba(0,0,0,.3)}
.leaflet-tooltip.lab:before{display:none}</style></head><body>
<div id="map"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
var dep=${j([dep.lat, dep.lon])}, arr=${j([arr.lat, arr.lon])};
var depL=${j(dep.code)}, arrL=${j(arr.code)};
function gc(a,b,n){var toR=Math.PI/180,toD=180/Math.PI;
 var f1=a[0]*toR,l1=a[1]*toR,f2=b[0]*toR,l2=b[1]*toR;
 var d=2*Math.asin(Math.sqrt(Math.sin((f2-f1)/2)**2+Math.cos(f1)*Math.cos(f2)*Math.sin((l2-l1)/2)**2));
 if(!d)return[a,b];var out=[];for(var i=0;i<=n;i++){var t=i/n;
  var A=Math.sin((1-t)*d)/Math.sin(d),B=Math.sin(t*d)/Math.sin(d);
  var x=A*Math.cos(f1)*Math.cos(l1)+B*Math.cos(f2)*Math.cos(l2);
  var y=A*Math.cos(f1)*Math.sin(l1)+B*Math.cos(f2)*Math.sin(l2);
  var z=A*Math.sin(f1)+B*Math.sin(f2);
  out.push([Math.atan2(z,Math.sqrt(x*x+y*y))*toD,Math.atan2(y,x)*toD]);}return out;}
var map=L.map('map',{zoomControl:true,attributionControl:true});
L.tileLayer('${TILE_URL}',{maxZoom:18,attribution:'© OpenStreetMap · © Geoapify'}).addTo(map);
var line=L.polyline(gc(dep,arr,72),{color:'#c8102e',weight:3,opacity:.9,dashArray:'1 8',lineCap:'round'}).addTo(map);
function dot(p,label,fill){L.circleMarker(p,{radius:7,color:'#fff',weight:2,fillColor:fill,fillOpacity:1}).addTo(map)
 .bindTooltip(label,{permanent:true,direction:'top',className:'lab',offset:[0,-6]});}
dot(dep,depL,'#1f3a5f');dot(arr,arrL,'#c8102e');
map.fitBounds(line.getBounds(),{padding:[46,46]});
</script></body></html>`;
}

export default function RouteMapModal({ visible, sector, onClose }: { visible: boolean; sector: any; onClose: () => void }) {
  const [html, setHtml] = useState<string | null>(null);
  const [nm, setNm] = useState<number | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!visible || !sector) return;
    let alive = true;
    setHtml(null); setErr(''); setNm(null);
    (async () => {
      try {
        const [d, a] = await Promise.all([airportLookup(sector.dep), airportLookup(sector.arr)]);
        if (!alive) return;
        if (d?.lat == null || d?.lon == null || a?.lat == null || a?.lon == null) {
          setErr('Airport position not available for this route.'); return;
        }
        const dep: Pt = { lat: d.lat, lon: d.lon, code: d.iata || sector.dep, name: d.name };
        const arr: Pt = { lat: a.lat, lon: a.lon, code: a.iata || sector.arr, name: a.name };
        setNm(distNm(dep, arr));
        setHtml(buildHtml(dep, arr));
      } catch {
        if (alive) setErr('Map needs a connection — the route couldn’t be loaded offline.');
      }
    })();
    return () => { alive = false; };
  }, [visible, sector?.id]);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={s.wrap}>
        <View style={s.head}>
          <View style={{ flex: 1 }}>
            <Text style={s.title} numberOfLines={1}>{sector?.flight_no} · {sector?.dep} → {sector?.arr}</Text>
            <Text style={s.sub}>{sector?.flight_date} · STD {hhmm(sector?.std)} · STA {hhmm(sector?.sta)}{nm != null ? ` · ${nm} NM` : ''}</Text>
          </View>
          <TouchableOpacity onPress={onClose} hitSlop={12}><Text style={s.close}>Close</Text></TouchableOpacity>
        </View>
        <View style={{ flex: 1 }}>
          {err ? <Text style={s.msg}>{err}</Text>
            : html ? <MapCanvas html={html} />
            : <ActivityIndicator style={{ marginTop: 44 }} color={theme.accent} />}
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.bg, paddingTop: 12 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingBottom: 10 },
  title: { color: theme.text, fontSize: 17, fontWeight: '800' },
  sub: { color: theme.sub, fontSize: 12.5, marginTop: 2 },
  close: { color: theme.accent, fontWeight: '700', fontSize: 15 },
  msg: { color: theme.sub, padding: 22, fontSize: 14 },
});
