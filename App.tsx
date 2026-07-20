import { createNavigationContainerRef, NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator, NativeStackNavigationOptions } from '@react-navigation/native-stack';
import React, { useEffect, useRef, useState } from 'react';
import { Alert, AppState, Platform, Text, View } from 'react-native';
import { aircraftStatus, appSettings, currentAircraft, heartbeat, logout, onAircraftStatus, reportDeviceError, roleLabel, serverReachable, syncPush, userName } from './src/api/client';
import ErrorBoundary from './src/components/ErrorBoundary';
import ArrivalScreen from './src/screens/ArrivalScreen';
import DefectDetailScreen from './src/screens/DefectDetailScreen';
import ComponentChangeScreen from './src/screens/ComponentChangeScreen';
import DefectsScreen from './src/screens/DefectsScreen';
import DeicingScreen from './src/screens/DeicingScreen';
import DepartureScreen from './src/screens/DepartureScreen';
import DocumentsScreen from './src/screens/DocumentsScreen';
import FormsScreen from './src/screens/FormsScreen';
import HeaderLogo from './src/components/HeaderLogo';
import LoginScreen from './src/screens/LoginScreen';
import MaintenanceScreen from './src/screens/MaintenanceScreen';
import MfaSetupScreen from './src/screens/MfaSetupScreen';
import ReportDefectScreen from './src/screens/ReportDefectScreen';
import ReleaseScreen from './src/screens/ReleaseScreen';
import PlannedMaintenanceScreen from './src/screens/PlannedMaintenanceScreen';
import MainMenuScreen from './src/screens/MainMenuScreen';
import SectorListScreen from './src/screens/SectorListScreen';
import SectorWorkspaceScreen from './src/screens/SectorWorkspaceScreen';
import SignOffScreen from './src/screens/SignOffScreen';
import GuideScreen from './src/screens/GuideScreen';
import AssistantScreen from './src/screens/AssistantScreen';
import FeedbackScreen from './src/screens/FeedbackScreen';
import MasterDeviceScreen from './src/screens/MasterDeviceScreen';
import AckOverlay from './src/components/AckOverlay';
import { SyncBlockHost } from './src/components/SyncBlock';
import BroadcastGate from './src/components/BroadcastGate';
import InductionGate from './src/components/InductionGate';
import OnlineStatus from './src/components/OnlineStatus';
import { theme } from './src/theme';

const Stack = createNativeStackNavigator();

const navRef = createNavigationContainerRef<any>();

export default function App() {
  // Auto sign-out after N minutes of iPad inactivity (configurable in the back office).
  const timeoutMs = useRef(120 * 60 * 1000);
  const idleTimer = useRef<any>(null);
  const bgAt = useRef<number | null>(null);

  function logoutNow() {
    if (navRef.isReady() && navRef.getCurrentRoute()?.name !== 'Login') {
      logout().finally(() => navRef.reset({ index: 0, routes: [{ name: 'Login' }] }));
    }
  }
  function resetIdle() {
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(logoutNow, timeoutMs.current);
  }
  useEffect(() => {
    const apply = () => appSettings()
      .then((s) => { if (s.auto_logout_minutes) timeoutMs.current = s.auto_logout_minutes * 60 * 1000; })
      .catch(() => {})
      .finally(resetIdle);
    apply();
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'background' || st === 'inactive') bgAt.current = Date.now();
      else if (st === 'active') {
        if (bgAt.current && Date.now() - bgAt.current > timeoutMs.current) logoutNow();
        bgAt.current = null;
        apply();
      }
    });
    return () => { sub.remove(); if (idleTimer.current) clearTimeout(idleTimer.current); };
  }, []);

  // Global JS-error handler: report uncaught fatals (that the React boundary can't see — async,
  // native module) to the back office so QA/CAMO get the cause + a recommended corrective action.
  useEffect(() => {
    const g: any = (global as any).ErrorUtils;
    if (!g?.getGlobalHandler) return;
    const prev = g.getGlobalHandler();
    g.setGlobalHandler((err: any, isFatal?: boolean) => {
      reportDeviceError({
        kind: isFatal ? 'crash' : 'error',
        message: (err?.message || String(err) || 'uncaught error').slice(0, 500),
        detail: (err?.stack || '').slice(0, 4000),
        screen: navRef.isReady() ? navRef.getCurrentRoute()?.name : undefined,
      }).catch(() => {});
      prev?.(err, isFatal);
    });
    return () => { if (prev) g.setGlobalHandler(prev); };
  }, []);

  // Auto-upload: whenever connectivity is available, push any pending (dirty) local data to the server.
  useEffect(() => {
    const flush = async () => { try { if (await serverReachable()) await syncPush(); } catch { /* offline — retry next tick */ } };
    flush();
    const t = setInterval(flush, 30000);
    const sub = AppState.addEventListener('change', (st) => { if (st === 'active') flush(); });
    return () => { clearInterval(t); sub.remove(); };
  }, []);

  // Liveness heartbeat + automatic master failover: if the master iPad goes silent, the top
  // live standby (FO → Backup → Cabin) is auto-promoted server-side; the promoted iPad is told here.
  useEffect(() => {
    let alive = true;
    const notified = { current: false };
    const beat = async () => {
      const ac = currentAircraft();
      if (!ac?.registration) return;
      if (!(navRef.isReady() && !['Login', 'MfaSetup'].includes(navRef.getCurrentRoute()?.name || ''))) return;
      try {
        const r = await heartbeat(ac.registration);
        if (alive && r.sync_now) syncPush().catch(() => {});   // master pressed "Sync all iPads" — push our outbox now
        if (alive && r.auto_promoted && !notified.current) {
          notified.current = true;
          const msg = 'Master role automatically transferred to your iPad — the master (in most cases the Captain iPad) is not responding.';
          if (Platform.OS === 'web') window.alert(msg); else Alert.alert('Master iPad transferred', msg);
        }
        if (!r.auto_promoted) notified.current = false;   // re-arm for a future failover
      } catch { /* offline — retry next tick */ }
    };
    beat();
    const t = setInterval(beat, 45000);
    const sub = AppState.addEventListener('change', (st) => { if (st === 'active') beat(); });
    return () => { alive = false; clearInterval(t); sub.remove(); };
  }, []);

  // Aircraft serviceability → tints the header green (serviceable) / red (unserviceable) on every page.
  const [svc, setSvc] = useState<boolean | null>(null);
  const pollSvc = useRef(async () => {
    const ac = currentAircraft();
    if (!ac?.registration) { setSvc(null); return; }
    try { const s = await aircraftStatus(ac.registration); setSvc(!!s.serviceable); }
    catch (e: any) { if (e?.message?.includes('401')) setSvc(null); }
  }).current;
  useEffect(() => {
    let alive = true;
    // Single source of truth: whatever status ANY screen just fetched drives the header too,
    // so the menu pill and the header bar can never disagree.
    onAircraftStatus((reg, s) => {
      if (alive && reg === currentAircraft()?.registration) setSvc(!!s.serviceable);
    });
    pollSvc();
    const t = setInterval(pollSvc, 30000);
    const sub = AppState.addEventListener('change', (st) => { if (st === 'active') pollSvc(); });
    return () => { alive = false; onAircraftStatus(null); clearInterval(t); sub.remove(); };
  }, []);

  const headerOpts: NativeStackNavigationOptions = {
    headerStyle: { backgroundColor: svc === false ? '#a01c1c' : svc === true ? '#13632e' : theme.bg },
    headerTintColor: '#fff',
    headerTitleStyle: { color: '#fff', fontWeight: '800' },
    headerRight: () => (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        {userName() ? (
          <Text style={{ color: '#fff', fontSize: 11, fontWeight: '700', maxWidth: 260 }} numberOfLines={1}>
            {(() => { const n = userName() || ''; const r = roleLabel() || '';
              // Long name + role clips at the header width — drop the role rather than truncate.
              return (n.length + r.length > 34 || !r) ? n : `${n} · ${r}`; })()}
          </Text>
        ) : null}
        {svc != null ? <Text style={{ color: '#fff', fontWeight: '800', fontSize: 11 }}>{svc ? '● SERVICEABLE' : '▲ UNSERVICEABLE'}</Text> : null}
        <OnlineStatus />
        <HeaderLogo />
      </View>
    ),
  };

  return (
    <ErrorBoundary>
    <View style={{ flex: 1 }} onStartShouldSetResponderCapture={() => { resetIdle(); return false; }}>
    <NavigationContainer ref={navRef} onStateChange={() => pollSvc()}>
      <Stack.Navigator initialRouteName="Login" screenOptions={headerOpts}>
        <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
        <Stack.Screen name="MfaSetup" component={MfaSetupScreen} options={{ headerShown: false }} />
        <Stack.Screen name="Menu" component={MainMenuScreen} options={{ headerShown: false }} />
        <Stack.Screen name="Sectors" component={SectorListScreen} options={{ title: 'Flight Details' }} />
        <Stack.Screen name="Sector" component={SectorWorkspaceScreen} options={{ title: 'Sector' }} />
        <Stack.Screen name="Departure" component={DepartureScreen} options={{ title: 'Departure' }} />
        <Stack.Screen name="Deicing" component={DeicingScreen} options={{ title: 'De-icing' }} />
        <Stack.Screen name="Arrival" component={ArrivalScreen} options={{ title: 'After Departure closed / Arrival' }} />
        <Stack.Screen name="Defects" component={DefectsScreen} options={{ title: 'Defects' }} />
        <Stack.Screen name="DefectDetail" component={DefectDetailScreen} options={{ title: 'Defect' }} />
        <Stack.Screen name="ReportDefect" component={ReportDefectScreen} options={{ title: 'Report defect' }} />
        <Stack.Screen name="ComponentChange" component={ComponentChangeScreen} options={{ title: 'Component Change (CCR)' }} />
        <Stack.Screen name="Release" component={ReleaseScreen} options={{ title: 'Release & Print' }} />
        <Stack.Screen name="Planned" component={PlannedMaintenanceScreen} options={{ title: 'Planned Maintenance' }} />
        <Stack.Screen name="Maintenance" component={MaintenanceScreen} options={{ title: 'Ground Maintenance' }} />
        <Stack.Screen name="Documents" component={DocumentsScreen} options={{ title: 'Documents' }} />
        <Stack.Screen name="Forms" component={FormsScreen} options={{ title: 'Forms' }} />
        <Stack.Screen name="SignOff" component={SignOffScreen} options={{ title: 'Flight Sign Off' }} />
        <Stack.Screen name="Guide" component={GuideScreen} options={{ title: 'User Guide' }} />
        <Stack.Screen name="Assistant" component={AssistantScreen} options={{ title: 'AI Assistant' }} />
        <Stack.Screen name="Feedback" component={FeedbackScreen} options={{ title: 'Feedback' }} />
        <Stack.Screen name="MasterDevice" component={MasterDeviceScreen} options={{ title: 'Master iPad' }} />
      </Stack.Navigator>
    </NavigationContainer>
    <SyncBlockHost />
    <AckOverlay navRef={navRef} />
    <BroadcastGate />
    <InductionGate />
    </View>
    </ErrorBoundary>
  );
}
