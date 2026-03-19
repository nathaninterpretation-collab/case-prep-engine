import { Router } from 'express';
import { generatePodcastScript } from '../services/podcastGenerator.js';
import { decryptApiKey } from '../services/crypto.js';

function getUserApiKey(db, userId) {
  const user = db.prepare('SELECT api_key_encrypted, api_key_iv, api_key_tag FROM users WHERE id = ?').get(userId);
  if (user?.api_key_encrypted) return decryptApiKey(user.api_key_encrypted, user.api_key_iv, user.api_key_tag);
  return process.env.ANTHROPIC_API_KEY || null;
}

export default function podcastRoutes(db) {
  const router = Router();

  // Generate podcast script for a case (separate API call — not auto-generated)
  router.post('/generate/:caseId', async (req, res) => {
    try {
      const row = db.prepare('SELECT analysis_json, profile_json, podcast_json FROM cases WHERE id = ? AND user_id = ?')
        .get(req.params.caseId, req.user.id);
      if (!row) return res.status(404).json({ error: 'Case not found' });

      // Check for cached script (avoid re-generating)
      if (row.podcast_json && !req.body.regenerate) {
        return res.json(JSON.parse(row.podcast_json));
      }

      const apiKey = getUserApiKey(db, req.user.id);
      if (!apiKey) return res.status(400).json({ error: 'No API key set. Please add your key in Settings.' });

      const analysis = JSON.parse(row.analysis_json);
      const profile = JSON.parse(row.profile_json);

      const podcast = await generatePodcastScript(analysis, profile, apiKey);

      // Cache the generated script in DB
      db.prepare('UPDATE cases SET podcast_json = ? WHERE id = ? AND user_id = ?')
        .run(JSON.stringify(podcast), req.params.caseId, req.user.id);

      res.json(podcast);
    } catch (err) {
      console.error('Podcast generation error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // Get cached podcast script (no generation)
  router.get('/script/:caseId', (req, res) => {
    try {
      const row = db.prepare('SELECT podcast_json FROM cases WHERE id = ? AND user_id = ?')
        .get(req.params.caseId, req.user.id);
      if (!row) return res.status(404).json({ error: 'Case not found' });
      if (!row.podcast_json) return res.json({ script: null });
      res.json(JSON.parse(row.podcast_json));
    } catch (err) {
      console.error('Podcast fetch error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
