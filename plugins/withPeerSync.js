// Adds the iOS Local Network permission + Bonjour service the MultipeerConnectivity
// transport needs. MultipeerConnectivity triggers the "allow local network" prompt, so the
// Info.plist must declare the usage string and the advertised service type — a distribution
// certificate does NOT provide these; they are app config that must be in the build.
//
// The service type must match `serviceType` in modules/peer-sync/ios/PeerSyncModule.swift.
const { withInfoPlist } = require('expo/config-plugins');

const SERVICE = 'f2s-etl-sync';

module.exports = function withPeerSync(config) {
  return withInfoPlist(config, (cfg) => {
    cfg.modResults.NSLocalNetworkUsageDescription =
      cfg.modResults.NSLocalNetworkUsageDescription ||
      'Fly2Sky ETL uses the local network to sync the Tech Log directly between the on-board iPads.';

    const services = new Set(cfg.modResults.NSBonjourServices || []);
    services.add(`_${SERVICE}._tcp`);
    services.add(`_${SERVICE}._udp`);
    cfg.modResults.NSBonjourServices = Array.from(services);

    return cfg;
  });
};
