// AMM instruction OFFLINE strategy.
//   false = per-card cache (current, on main / deployed): text per card + shared figure cache.
//   true  = per-ATA compressed bundles (this branch): ~45 gzipped bundles, extracted on demand.
// PREPARED, not on main. Enable during test to compare. Backend needs routers/amm_bundle.py wired.
export const AMM_BUNDLE_MODE = true;
