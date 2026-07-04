import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { airportLookup } from '../api/client';
import { getApt, getTile } from '../db/reference';
import { hhmm } from '../screens/sectorShared';
import { theme } from '../theme';
import { GEOAPIFY_TILE_TEMPLATE, overviewTiles, tileKey } from '../util/tiles';
import MapCanvas from './MapCanvas';

type Pt = { lat: number; lon: number; code: string; name?: string | null };

function distNm(a: Pt, b: Pt): number {
  const R = 3440.065, r = Math.PI / 180;
  const dφ = (b.lat - a.lat) * r, dλ = (b.lon - a.lon) * r;
  const x = Math.sin(dφ / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dλ / 2) ** 2;
  return Math.round(2 * R * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x)));
}

// ONLINE: interactive Leaflet map (Geoapify English tiles).
function buildOnlineHtml(dep: Pt, arr: Pt): string {
  const j = (o: any) => JSON.stringify(o);
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<style>html,body,#map{height:100%;margin:0}#map{background:#eef1f5}
.lab{background:#16202e;color:#fff;font:700 12px system-ui,-apple-system,sans-serif;padding:2px 7px;border-radius:5px;border:0;box-shadow:0 1px 3px rgba(0,0,0,.3)}
.leaflet-tooltip.lab:before{display:none}</style></head><body>
<div id="map"></div><script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script><script>
var dep=${j([dep.lat, dep.lon])}, arr=${j([arr.lat, arr.lon])}, depL=${j(dep.code)}, arrL=${j(arr.code)};
function gc(a,b,n){var R=Math.PI/180,D=180/Math.PI,f1=a[0]*R,l1=a[1]*R,f2=b[0]*R,l2=b[1]*R;
 var d=2*Math.asin(Math.sqrt(Math.sin((f2-f1)/2)**2+Math.cos(f1)*Math.cos(f2)*Math.sin((l2-l1)/2)**2));
 if(!d)return[a,b];var o=[];for(var i=0;i<=n;i++){var t=i/n,A=Math.sin((1-t)*d)/Math.sin(d),B=Math.sin(t*d)/Math.sin(d);
 var x=A*Math.cos(f1)*Math.cos(l1)+B*Math.cos(f2)*Math.cos(l2),y=A*Math.cos(f1)*Math.sin(l1)+B*Math.cos(f2)*Math.sin(l2),z=A*Math.sin(f1)+B*Math.sin(f2);
 o.push([Math.atan2(z,Math.sqrt(x*x+y*y))*D,Math.atan2(y,x)*D]);}return o;}
var map=L.map('map',{zoomControl:true});
L.tileLayer('${GEOAPIFY_TILE_TEMPLATE}',{maxZoom:18,attribution:'© OpenStreetMap · © Geoapify'}).addTo(map);
var line=L.polyline(gc(dep,arr,72),{color:'#c8102e',weight:3,opacity:.9,dashArray:'1 8',lineCap:'round'}).addTo(map);
function dot(p,l,f){L.circleMarker(p,{radius:7,color:'#fff',weight:2,fillColor:f,fillOpacity:1}).addTo(map).bindTooltip(l,{permanent:true,direction:'top',className:'lab',offset:[0,-6]});}
dot(dep,depL,'#1f3a5f');dot(arr,arrL,'#c8102e');map.fitBounds(line.getBounds(),{padding:[46,46]});
</script></body></html>`;
}

// OFFLINE: self-contained canvas — cached tiles + great-circle line + labelled pins. No library.
function buildOfflineHtml(dep: Pt, arr: Pt, z: number, tiles: Record<string, string>): string {
  const j = (o: any) => JSON.stringify(o);
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<style>html,body{height:100%;margin:0;background:#dfe6ee}#wrap{height:100%;display:flex;align-items:center;justify-content:center}
canvas{max-width:100%;max-height:100%}</style></head><body><div id="wrap"><canvas id="c"></canvas></div><script>
var Z=${z},T=${j(tiles)},dep=${j([dep.lat, dep.lon])},arr=${j([arr.lat, arr.lon])},depL=${j(dep.code)},arrL=${j(arr.code)};
function proj(la,lo){var s=256*Math.pow(2,Z),x=(lo+180)/360*s,sl=Math.sin(la*Math.PI/180),y=(0.5-Math.log((1+sl)/(1-sl))/(4*Math.PI))*s;return[x,y];}
function gc(a,b,n){var R=Math.PI/180,D=180/Math.PI,f1=a[0]*R,l1=a[1]*R,f2=b[0]*R,l2=b[1]*R;
 var d=2*Math.asin(Math.sqrt(Math.sin((f2-f1)/2)**2+Math.cos(f1)*Math.cos(f2)*Math.sin((l2-l1)/2)**2));
 if(!d)return[a,b];var o=[];for(var i=0;i<=n;i++){var t=i/n,A=Math.sin((1-t)*d)/Math.sin(d),B=Math.sin(t*d)/Math.sin(d);
 var x=A*Math.cos(f1)*Math.cos(l1)+B*Math.cos(f2)*Math.cos(l2),y=A*Math.cos(f1)*Math.sin(l1)+B*Math.cos(f2)*Math.sin(l2),z=A*Math.sin(f1)+B*Math.sin(f2);
 o.push([Math.atan2(z,Math.sqrt(x*x+y*y))*D,Math.atan2(y,x)*D]);}return o;}
var xs=[],ys=[];for(var k in T){var p=k.split('/');xs.push(+p[1]);ys.push(+p[2]);}
if(!xs.length){document.body.innerHTML='<div style="font:600 15px system-ui;color:#556;padding:24px">This route isn\\'t saved for offline yet — open it once with a signal.</div>';}
else{var minx=Math.min.apply(null,xs),maxx=Math.max.apply(null,xs),miny=Math.min.apply(null,ys),maxy=Math.max.apply(null,ys);
var ox=minx*256,oy=miny*256,W=(maxx-minx+1)*256,H=(maxy-miny+1)*256;
var cv=document.getElementById('c');cv.width=W;cv.height=H;var ctx=cv.getContext('2d');ctx.fillStyle='#dfe6ee';ctx.fillRect(0,0,W,H);
var loads=[];Object.keys(T).forEach(function(k){var p=k.split('/'),tx=+p[1],ty=+p[2];
 loads.push(new Promise(function(res){var im=new Image();im.onload=function(){ctx.drawImage(im,tx*256-ox,ty*256-oy);res();};im.onerror=res;im.src=T[k];}));});
Promise.all(loads).then(function(){
 var pts=gc(dep,arr,72);ctx.lineWidth=3;ctx.strokeStyle='#c8102e';ctx.setLineDash([2,7]);ctx.lineCap='round';ctx.beginPath();
 for(var i=0;i<pts.length;i++){var q=proj(pts[i][0],pts[i][1]),X=q[0]-ox,Y=q[1]-oy;if(i===0)ctx.moveTo(X,Y);else ctx.lineTo(X,Y);}ctx.stroke();ctx.setLineDash([]);
 function dot(p,l,f){var q=proj(p[0],p[1]),X=q[0]-ox,Y=q[1]-oy;
  ctx.beginPath();ctx.arc(X,Y,7,0,7);ctx.fillStyle=f;ctx.fill();ctx.lineWidth=2;ctx.strokeStyle='#fff';ctx.stroke();
  ctx.font='700 13px system-ui,-apple-system,sans-serif';var w=ctx.measureText(l).width;
  ctx.fillStyle='#16202e';ctx.fillRect(X-w/2-6,Y-32,w+12,20);ctx.fillStyle='#fff';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(l,X,Y-22);}
 dot(dep,depL,'#1f3a5f');dot(arr,arrL,'#c8102e');});}
</script></body></html>`;
}

export default function RouteMapModal({ visible, sector, onClose }: { visible: boolean; sector: any; onClose: () => void }) {
  const [html, setHtml] = useState<string | null>(null);
  const [nm, setNm] = useState<number | null>(null);
  const [err, setErr] = useState('');
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    if (!visible || !sector) return;
    let alive = true;
    setHtml(null); setErr(''); setNm(null); setOffline(false);
    (async () => {
      let dep: Pt | null = null, arr: Pt | null = null, isOnline = true;
      try {
        const [d, a] = await Promise.all([airportLookup(sector.dep), airportLookup(sector.arr)]);
        if (d?.lat != null && a?.lat != null) {
          dep = { lat: d.lat, lon: d.lon, code: d.iata || sector.dep, name: d.name };
          arr = { lat: a.lat, lon: a.lon, code: a.iata || sector.arr, name: a.name };
        } else isOnline = false;
      } catch { isOnline = false; }
      if (!dep || !arr) {                                   // offline / lookup failed → cached coords
        isOnline = false;
        const cd = await getApt(sector.dep), ca = await getApt(sector.arr);
        if (cd?.lat != null && ca?.lat != null) {
          dep = { lat: cd.lat, lon: cd.lon, code: cd.iata || sector.dep, name: cd.name };
          arr = { lat: ca.lat, lon: ca.lon, code: ca.iata || sector.arr, name: ca.name };
        }
      }
      if (!alive) return;
      if (!dep || !arr) { setErr('This route isn’t saved for offline yet — open it once with a signal.'); return; }
      setNm(distNm(dep, arr));
      if (isOnline) { setHtml(buildOnlineHtml(dep, arr)); return; }
      setOffline(true);
      const { z, tiles } = overviewTiles(dep.lat, dep.lon, arr.lat, arr.lon);
      const cache: Record<string, string> = {};
      for (const t of tiles) { const b = await getTile(tileKey(t)); if (b) cache[tileKey(t)] = b; }
      if (!alive) return;
      setHtml(buildOfflineHtml(dep, arr, z, cache));
    })();
    return () => { alive = false; };
  }, [visible, sector?.id]);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={s.wrap}>
        <View style={s.head}>
          <View style={{ flex: 1 }}>
            <Text style={s.title} numberOfLines={1}>{sector?.flight_no} · {sector?.dep} → {sector?.arr}</Text>
            <Text style={s.sub}>{sector?.flight_date} · STD {hhmm(sector?.std)} · STA {hhmm(sector?.sta)}{nm != null ? ` · ${nm} NM` : ''}{offline ? ' · offline' : ''}</Text>
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
