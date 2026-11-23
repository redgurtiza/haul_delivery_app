// Server-Sent Events hub: pushes order updates (status + driver location) to tracking pages.
const subs = new Map(); // orderId -> Set<res>
function subscribe(orderId, res) {
  if (!subs.has(orderId)) subs.set(orderId, new Set());
  subs.get(orderId).add(res);
  res.on('close', () => { subs.get(orderId)?.delete(res); });
}
function publish(orderId, event, data) {
  for (const res of subs.get(orderId) || []) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}
module.exports = { subscribe, publish };
