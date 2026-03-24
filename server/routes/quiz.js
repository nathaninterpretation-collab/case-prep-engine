import { Router } from 'express';
import { generateQuiz, generateSightPassage, gradeSightTranslation } from '../services/quizGenerator.js';
import { decryptApiKey } from '../services/crypto.js';

function getUserApiKey(db, userId) {
  const user = db.prepare('SELECT api_key_encrypted, api_key_iv, api_key_tag FROM users WHERE id = ?').get(userId);
  if (user?.api_key_encrypted) return decryptApiKey(user.api_key_encrypted, user.api_key_iv, user.api_key_tag);
  return process.env.ANTHROPIC_API_KEY || null;
}

export default function quizRoutes(db) {
  const router = Router();

  // Generate MCQ quiz from case terminology
  router.post('/mcq/:caseId', async (req, res) => {
    try {
      const row = db.prepare('SELECT analysis_json FROM cases WHERE id = ? AND user_id = ?').get(req.params.caseId, req.user.id);
      if (!row) return res.status(404).json({ error: 'Case not found' });

      const apiKey = getUserApiKey(db, req.user.id);
      if (!apiKey) return res.status(400).json({ error: 'No API key set. Please add your key in Settings.' });

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
      const row = db.prepare('SELECT analysis_json, profile_json FROM cases WHERE id = ? AND user_id = ?').get(req.params.caseId, req.user.id);
      if (!row) return res.status(404).json({ error: 'Case not found' });

      const apiKey = getUserApiKey(db, req.user.id);
      if (!apiKey) return res.status(400).json({ error: 'No API key set. Please add your key in Settings.' });

      const analysis = JSON.parse(row.analysis_json);
      const profile = JSON.parse(row.profile_json);
      const passage = await generateSightPassage(analysis.hazard_zones || [], profile, apiKey);
      res.json(passage);
    } catch (err) {
      console.error('Sight passage error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // Grade sight translation attempt
  router.post('/sight-grade/:caseId', async (req, res) => {
    try {
      const row = db.prepare('SELECT profile_json FROM cases WHERE id = ? AND user_id = ?').get(req.params.caseId, req.user.id);
      if (!row) return res.status(404).json({ error: 'Case not found' });

      const apiKey = getUserApiKey(db, req.user.id);
      if (!apiKey) return res.status(400).json({ error: 'No API key set.' });

      const { passage, key_terms, userTranslation } = req.body;
      if (!userTranslation || !userTranslation.trim()) return res.status(400).json({ error: 'No translation provided' });

      const profile = JSON.parse(row.profile_json);
      const grading = await gradeSightTranslation(passage, key_terms || [], userTranslation, profile, apiKey);
      res.json(grading);
    } catch (err) {
      console.error('Sight grading error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // Save quiz score
  router.post('/score', (req, res) => {
    const { caseId, mode, score, total, details } = req.body;
    db.prepare(
      'INSERT INTO quiz_scores (case_id, mode, score, total, details, user_id) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(caseId, mode, score, total, JSON.stringify(details || {}), req.user.id);
    res.json({ ok: true });
  });

  // Get quiz history for a case
  router.get('/scores/:caseId', (req, res) => {
    const scores = db.prepare(
      'SELECT * FROM quiz_scores WHERE case_id = ? AND user_id = ? ORDER BY created_at DESC'
    ).all(req.params.caseId, req.user.id);
    res.json(scores);
  });

  return router;
}
