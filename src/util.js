class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const bad = (m) => new HttpError(400, m);
const num = (v, name, { min = -Infinity, max = Infinity } = {}) => {
  const n = Number(v);
  if (v === null || v === '' || !Number.isFinite(n) || n < min || n > max) throw bad(`${name} is invalid`);
  return n;
};
const str = (v, name, max = 200) => {
  if (typeof v !== 'string' || !v.trim() || v.length > max) throw bad(`${name} is required`);
  return v.trim();
};
const point = (p, name) => {
  if (!p || typeof p !== 'object') throw bad(`${name} is required`);
  return { name: str(p.name, `${name}.name`), lat: num(p.lat, `${name}.lat`, { min: -90, max: 90 }), lng: num(p.lng, `${name}.lng`, { min: -180, max: 180 }) };
};
const email = (v) => {
  const e = str(v, 'email', 120).toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) throw bad('email is invalid');
  return e;
};
const password = (v) => {
  if (typeof v !== 'string' || v.length < 8 || v.length > 100) throw bad('password must be 8-100 characters');
  return v;
};
module.exports = { HttpError, bad, num, str, point, email, password };
