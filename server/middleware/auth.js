import jwt from 'jsonwebtoken';

const DEFAULT_USER = { id: 'default-user', email: 'local@cpe.local' };

export function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    // Auth bypassed — use default user
    req.user = DEFAULT_USER;
    return next();
  }

  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = { id: payload.id, email: payload.email };
    next();
  } catch {
    // Token invalid — still allow through with default user
    req.user = DEFAULT_USER;
    next();
  }
}
