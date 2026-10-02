// Server-side protection for admin-only API routes.
// The admin panel gets a signed token from POST /api/admin/verify-otp and sends it as
// "Authorization: Bearer <token>" on every request.
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let cachedSecret = null;
function getAdminSecret() {
  if (cachedSecret) return cachedSecret;
  if (process.env.ADMIN_JWT_SECRET) return (cachedSecret = process.env.ADMIN_JWT_SECRET);
  if (process.env.JWT_SECRET) return (cachedSecret = process.env.JWT_SECRET + ':admin-panel');
  // No secret configured: generate one once and keep it next to the backend (outside src/)
  const secretFile = path.resolve(__dirname, '../../.admin-jwt-secret');
  try { cachedSecret = fs.readFileSync(secretFile, 'utf8').trim(); } catch (e) {}
  if (!cachedSecret) {
    cachedSecret = crypto.randomBytes(48).toString('hex');
    try { fs.writeFileSync(secretFile, cachedSecret, { mode: 0o600 }); } catch (e) {}
  }
  return cachedSecret;
}

function signAdminToken() {
  return jwt.sign({ role: 'admin' }, getAdminSecret(), { expiresIn: '7d' });
}

function requireAdmin(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) {
    return res.status(401).json({ success: false, message: 'Admin login required' });
  }
  try {
    const decoded = jwt.verify(token, getAdminSecret());
    if (!decoded || decoded.role !== 'admin') throw new Error('not admin');
    req.admin = decoded;
    return next();
  } catch (e) {
    return res.status(401).json({ success: false, message: 'Admin session expired. Please log in again.' });
  }
}

// Read-only /api/admin endpoints that the Android app and website call without a login.
// They contain no user data.
const PUBLIC_ADMIN_GET = new Set([
  '/schedules',
  '/declared-results',
  '/results-history',
  '/payment-methods',
  '/paymentMethods',
  '/banner',
  '/banners',
  '/app-version',
  '/live-players',
  '/referral-config'
]);
const PUBLIC_ADMIN_POST = new Set(['/login', '/verify-otp']);

// Mounted with app.use('/api/admin', adminApiGuard)
function adminApiGuard(req, res, next) {
  if (req.method === 'OPTIONS') return next();
  const p = (req.path || '/').replace(/\/+$/, '') || '/';
  if ((req.method === 'GET' || req.method === 'HEAD') && PUBLIC_ADMIN_GET.has(p)) return next();
  if (req.method === 'POST' && PUBLIC_ADMIN_POST.has(p)) return next();
  return requireAdmin(req, res, next);
}

// Allows reads, requires admin for any change (POST/PUT/PATCH/DELETE)
function adminWriteGuard(req, res, next) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  return requireAdmin(req, res, next);
}

module.exports = { signAdminToken, requireAdmin, adminApiGuard, adminWriteGuard };
