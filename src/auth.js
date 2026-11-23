const jwt = require('jsonwebtoken');
const db = require('./db');
const { HttpError } = require('./util');

if (!process.env.JWT_SECRET && process.env.NODE_ENV === 'production') throw new Error('JWT_SECRET is required in production');
const SECRET = process.env.JWT_SECRET || 'dev-only-secret';

const sign = (u) => jwt.sign({ sub: u.id, role: u.role }, SECRET, { expiresIn: '12h' });
function userFromToken(token) {
  let p;
  try { p = jwt.verify(token, SECRET); } catch { throw new HttpError(401, 'Invalid or expired token'); }
  const u = db.prepare('SELECT id, role, name, email, active FROM users WHERE id = ?').get(p.sub);
  if (!u || !u.active) throw new HttpError(401, 'Account disabled');
  return u;
}
// auth('admin') / auth('client','admin') / auth() for any logged-in user
const auth = (...roles) => (req, res, next) => {
  try {
    const h = req.headers.authorization || '';
    if (!h.startsWith('Bearer ')) throw new HttpError(401, 'Login required');
    req.user = userFromToken(h.slice(7));
    if (roles.length && !roles.includes(req.user.role)) throw new HttpError(403, 'Forbidden');
    next();
  } catch (e) { next(e); }
};
// very small in-memory login throttle (use Redis / express-rate-limit when running multiple instances)
const tries = new Map();
function throttle(key) {
  const now = Date.now(), t = (tries.get(key) || []).filter((x) => now - x < 15 * 60000);
  if (t.length >= 10) throw new HttpError(429, 'Too many attempts, try again later');
  t.push(now); tries.set(key, t);
}
module.exports = { sign, auth, userFromToken, throttle };
