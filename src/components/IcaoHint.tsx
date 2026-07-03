import React, { useEffect, useState } from 'react';
import { Text } from 'react-native';
import { Airport, airportLookup } from '../api/client';
import { theme } from '../theme';

// Validates an ICAO/IATA code (via Leon) and shows the airport name underneath the field.
// Soft validation only — offline it just stays quiet so manual entry still works.
export default function IcaoHint({ code }: { code?: string }) {
  const c = (code || '').trim().toUpperCase();
  const [info, setInfo] = useState<Airport | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    setInfo(null);
    if (c.length < 3) return;
    let alive = true;
    setChecking(true);
    const t = setTimeout(() => {
      airportLookup(c)
        .then((r) => alive && setInfo(r))
        .catch(() => alive && setInfo(null))
        .finally(() => alive && setChecking(false));
    }, 350);
    return () => { alive = false; clearTimeout(t); };
  }, [c]);

  if (c.length < 3) return null;
  if (checking && !info) return <Text style={{ color: theme.sub, fontSize: 11, marginTop: 3 }}>Checking…</Text>;
  if (!info) return null;                                    // offline / no result → stay quiet
  return info.valid
    ? <Text style={{ color: theme.green, fontSize: 11, marginTop: 3 }} numberOfLines={1}>{info.name}{info.city ? ` · ${info.city}` : ''}{info.iata ? ` (${info.iata})` : ''}</Text>
    : <Text style={{ color: theme.red, fontSize: 11, marginTop: 3 }}>⚠ Unknown ICAO/IATA code</Text>;
}
