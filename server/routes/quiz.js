import { Router } from 'express';
import { generateQuiz, generateSightPassage } from '../services/quizGenerator.js';

export default function quizRoutes(db) {
  const router = Router();

  // Generate MCQ quiz from case terminology
  router.post('/mcq/:caseId', async (req, res) => {
    try {
      const row = db.prepare('SELECT analysis_json FROM cases WHERE id = ?').get(req.params.caseId);
      if (!row) return res.status(404).json({ error: 'Case not found' });

      const apiKey = req.headers['x-api-key'] || process.env.ANTHROPIC_API_KEY;
      if (!apiKey) return res.status(401).json({ error: 'No API key provided.' });

      const analysis = JSON.parse(row.analysis_json);
      const quiz = await generateQuiz(analysis.terminology || [], apiKey);
      res.json(quiz);
    } catch (err) {
      console.error('Quiz generation error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // Generate sight translation passage
  router.post('/sight/:caseId', async (req, res) => {
    try {
      const row = db.prepare('SELECT analysis_json, profile_json FROM cases WHERE id = ?').get(req.params.caseId);
      if (!row) return res.status(404).json({ error: 'Case not found' });

      const apiKey = req.headers['x-api-key'] || process.env.ANTHROPIC_API_KEY;
      if (!apiKey) return res.status(401).json({ error: 'No API key provided.' });

      const analysis = JSON.parse(row.analysis_json);
      const profile = JSON.parse(row.profile_json);
      const passage = await generateSightPassage(analysis.hazard_zones || [], profile, apiKey);
      res.json(passage);
    } catch (err) {
      console.error('Sight passage error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // Save quiz score
  router.post('/score', (req, res) => {
    const { caseId, mode, score, total, details } = req.body;
    db.prepare(
      'INSERT INTO quiz_scores (case_id, mode, score, total, details) VALUES (?, ?, ?, ?, ?)'
    ).run(caseId, mode, score, total, JSON.stringify(details || {}));
    res.json({ ok: true });
  });

  // Get quiz history for a case
  router.get('/scores/:caseId', (req, res) => {
    const scores = db.prepare(
      'SELECT * FROM quiz_scores WHERE case_id = ? ORDER BY created_at DESC'
    ).all(req.params.caseId);
    res.json(scores);
  });

  return router;
}
