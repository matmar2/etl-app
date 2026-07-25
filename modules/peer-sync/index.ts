// The JS surface for this native module lives in `src/p2p/native.ts`, which calls
// `requireNativeModule('PeerSync')` directly and adapts it to the app's PeerTransport
// interface. This file exists so the local Expo module resolves; nothing imports it by name.
export {};
