// Stub metrics – no-op counters/gauges/histograms
const noop = () => {};
const noopObj = { labels: () => noopObj, inc: noop, dec: noop, set: noop, observe: noop };
module.exports = {
  httpRequestDuration: noopObj,
  httpRequestTotal: noopObj,
  activeGames: noopObj,
  activePlayers: noopObj,
  gameWinsTotal: noopObj,
  dartsThrown: noopObj,
  socketConnections: noopObj,
  register: { contentType: "text/plain", metrics: async () => "metrics disabled" },
};
