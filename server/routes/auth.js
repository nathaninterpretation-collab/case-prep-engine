import { Router } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { v4 as uuid } from 'uuid';
import { encryptApiKey, decryptApiKey } from '../services/crypto.js';
import { requireAuth } from '../middleware/auth.js';

const SALT_ROUNDS = 12;

function signToken(user) {
  return jwt.sign({ id: user.id, email: user.email }, process.env.JWT_SECRET, { expiresIn: '7d' });
}

export default function authRoutes(db) {
  const router = Router();

  // Register
  router.post('/register', async (req, res) => {
    try {
      const { email, password } = req.body;
      if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
      if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Invalid email format' });

      const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
      if (existing) return res.status(409).json({ error: 'An account with this email already exists' });

      const id = uuid();
      const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
      db.prepare('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)').run(id, email.toLowerCase(), passwordHash);

      const token = signToken({ id, email: email.toLowerCase() });
      res.json({ token, user: { id, email: email.toLowerCase(), has_api_key: false } });
    } catch (err) {
      console.error('Register error:', err);
      res.status(500).json({ error: 'Registration failed' });
    }
  });

  // Login
  router.post('/login', async (req, res) => {
    try {
      const { email, password } = req.body;
      if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

      const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase());
      if (!user) return res.status(401).json({ error: 'Invalid email or password' });

      const valid = await bcrypt.compare(password, user.password_hash);
      if (!valid) return res.status(401).json({ error: 'Invalid email or password' });

      const token = signToken(user);
      res.json({
        token,
        user: { id: user.id, email: user.email, has_api_key: !!user.api_key_encrypted }
      });
    } catch (err) {
      console.error('Login error:', err);
      res.status(500).json({ error: 'Login failed' });
    }
  });

  // Get current user
  router.get('/me', requireAuth, (req, res) => {
    const user = db.prepare('SELECT id, email, api_key_encrypted FROM users WHERE id = ?').get(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ id: user.id, email: user.email, has_api_key: !!user.api_key_encrypted });
  });

  // Save API key
  router.put('/api-key', requireAuth, (req, res) => {
    const { apiKey } = req.body;
    if (!apiKey || !apiKey.startsWith('sk-')) return res.status(400).json({ error: 'Invalid API key format' });

    const { encrypted, iv, tag } = encryptApiKey(apiKey);
    db.prepare('UPDATE users SET api_key_encrypted = ?, api_key_iv = ?, api_key_tag = ?, updated_at = datetime(\'now\') WHERE id = ?')
      .run(encrypted, iv, tag, req.user.id);
    res.json({ ok: true });
  });

  // Forgot password (stub — needs email service integration)
  router.post('/forgot-password', (req, res) => {
    const { email } = req.body;
    // Always respond positively to prevent email enumeration
    res.json({ message: 'If an account with this email exists, a password reset link has been sent.' });
  });

  // Guest mode — generate a temporary JWT with a guest user row
  router.post('/guest', async (req, res) => {
    try {
      const id = uuid();
      const guestEmail = `guest_${id.slice(0, 8)}@cpe.local`;
      // Create a guest user row (no password)
      db.prepare('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)').run(id, guestEmail, 'GUEST');
      const token = signToken({ id, email: guestEmail });
      res.json({ token, user: { id, email: guestEmail, has_api_key: false, is_guest: true } });
    } catch (err) {
      console.error('Guest error:', err);
      res.status(500).json({ error: 'Failed to create guest session' });
    }
  });

  // Clear API key
  router.delete('/api-key', requireAuth, (req, res) => {
    db.prepare('UPDATE users SET api_key_encrypted = NULL, api_key_iv = NULL, api_key_tag = NULL, updated_at = datetime(\'now\') WHERE id = ?')
      .run(req.user.id);
    res.json({ ok: true });
  });

  return router;
}
