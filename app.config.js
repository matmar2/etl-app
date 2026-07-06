// Dynamic Expo config: extends app.json and stamps the git commit into `extra.commit`
// at export time, so the running JS bundle can show "Bundle <shortsha>" on the Main Menu.
// - `eas update` (local) resolves this and embeds the commit into the published update manifest.
// - `eas build` sets EAS_BUILD_GIT_COMMIT_HASH; use it when git isn't reachable in the sandbox.
const { execSync } = require('child_process');

function gitCommit() {
  const env = process.env.EAS_BUILD_GIT_COMMIT_HASH;
  if (env) return env.slice(0, 7);
  try {
    return execSync('git rev-parse --short=7 HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return 'local';
  }
}

module.exports = ({ config }) => ({
  ...config,
  extra: { ...(config.extra || {}), commit: gitCommit() },
});
