import React, { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import BroadcastModal from './BroadcastModal';
import { Broadcast, currentAircraft, pendingBroadcasts, userName } from '../api/client';

// Module hook so screens (e.g. the Main Menu on login) can trigger an immediate re-check
// without waiting for the poll interval.
let _poke: (() => void) | null = null;
export function pokeBroadcasts() { _poke?.(); }

// Global overlay mounted once at the app root: shows admin broadcasts as a pop-up over ANY
// screen — right after login, to an already-logged-in session (polled every 30 s + on
// foreground), and offline (from the cached pending list). Renders nothing until there's one.
export default function BroadcastGate() {
  const [items, setItems] = useState<Broadcast[]>([]);
  const showing = useRef(false);

  useEffect(() => {
    let alive = true;
    async function tick() {
      if (!alive || showing.current) return;              // don't stack while one is open
      if (!userName()) { setItems([]); return; }          // only while signed in
      try {
        const b = await pendingBroadcasts(currentAircraft()?.registration);
        if (alive && b.length) { showing.current = true; setItems(b); }
      } catch { /* ignore — offline path already handled in client */ }
    }
    _poke = tick;
    tick();
    const t = setInterval(tick, 30000);
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') tick(); });
    return () => { alive = false; _poke = null; clearInterval(t); sub.remove(); };
  }, []);

  if (!items.length) return null;
  return <BroadcastModal items={items} onClose={() => { showing.current = false; setItems([]); }} />;
}
