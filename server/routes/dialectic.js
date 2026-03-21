import { Router } from 'express';
import { startDialectic, synthesizeDialectic, getArchetypes } from '../services/dialecticEngine.js';
import { decryptApiKey } from '../services/crypto.js';

function getUserApiKey(db, userId) {
  const user = db.prepare('SELECT api_key_encrypted, api_key_iv, api_key_tag FROM users WHERE id = ?').get(userId);
  if (user?.api_key_encrypted) return decryptApiKey(user.api_key_encrypted, user.api_key_iv, user.api_key_tag);
  return process.env.ANTHROPIC_API_KEY || null;
}

export default function dialecticRoutes(db) {
  const router = Router();

  // Get available archetypes
  router.get('/archetypes', (req, res) => {
    res.json(getArchetypes());
  });

  // Start a new dialectical session
  router.post('/start', async (req, res) => {
    try {
      const { thesis, rounds = 5 } = req.body;
      if (!thesis || typeof thesis !== 'string' || thesis.trim().length < 3) {
        return res.status(400).json({ error: 'A thesis or subject matter is required (min 3 characters).' });
      }
      const clampedRounds = Math.min(Math.max(parseInt(rounds) || 5, 2), 30);

      const apiKey = getUserApiKey(db, req.user.id);
      if (!apiKey) return res.status(400).json({ error: 'No API key set. Please add your key in Settings.' });

      const result = await startDialectic(thesis.trim(), clampedRounds, apiKey);

      // Store in DB for retrieval
      const existing = db.prepare('SELECT id FROM dialectic_sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 20').all(req.user.id);
      // Keep only last 20 sessions
      if (existing.length >= 20) {
        const oldest = existing[existing.length - 1];
        db.prepare('DELETE FROM dialectic_sessions WHERE id = ? AND user_id = ?').run(oldest.id, req.user.id);
      }

      const id = crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36);
      db.prepare(`INSERT INTO dialectic_sessions (id, user_id, thesis, rounds_json, created_at) VALUES (?, ?, ?, ?, ?)`)
        .run(id, req.user.id, thesis.trim(), JSON.stringify(result), new Date().toISOString());

      res.json({ id, ...result });
    } catch (err) {
      console.error('Dialectic engine error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // Synthesize / draw conclusion from a session
  router.post('/synthesize/:sessionId', async (req, res) => {
    try {
      const row = db.prepare('SELECT * FROM dialectic_sessions WHERE id = ? AND user_id = ?')
        .get(req.params.sessionId, req.user.id);
      if (!row) return res.status(404).json({ error: 'Session not found' });

      const apiKey = getUserApiKey(db, req.user.id);
      if (!apiKey) return res.status(400).json({ error: 'No API key set.' });

      const sessionData = JSON.parse(row.rounds_json);
      const allTurns = sessionData.rounds.flatMap(r => r.turns);

      const synthesis = await synthesizeDialectic(sessionData.thesis, allTurns, apiKey);

      // Update session with synthesis
      sessionData.synthesis = synthesis;
      db.prepare('UPDATE dialectic_sessions SET rounds_json = ? WHERE id = ? AND user_id = ?')
        .run(JSON.stringify(sessionData), req.params.sessionId, req.user.id);

      res.json(synthesis);
    } catch (err) {
      console.error('Synthesis error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // List past sessions
  router.get('/sessions', (req, res) => {
    try {
      const rows = db.prepare('SELECT id, thesis, created_at FROM dialectic_sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 20')
        .all(req.user.id);
      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Get a specific session
  router.get('/session/:sessionId', (req, res) => {
    try {
      const row = db.prepare('SELECT * FROM dialectic_sessions WHERE id = ? AND user_id = ?')
        .get(req.params.sessionId, req.user.id);
      if (!row) return res.status(404).json({ error: 'Session not found' });
      const data = JSON.parse(row.rounds_json);
      res.json({ id: row.id, ...data });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
