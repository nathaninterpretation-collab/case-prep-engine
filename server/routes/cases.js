import { Router } from 'express';

export default function casesRoutes(db) {
  const router = Router();

  // List user's cases
  router.get('/', (req, res) => {
    const cases = db.prepare(
      'SELECT id, name, case_type, case_subtype, created_at, updated_at FROM cases WHERE user_id = ? ORDER BY updated_at DESC'
    ).all(req.user.id);
    res.json(cases);
  });

  // Get single case (scoped to user)
  router.get('/:id', (req, res) => {
    const row = db.prepare('SELECT * FROM cases WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!row) return res.status(404).json({ error: 'Case not found' });
    res.json({
      ...row,
      profile: JSON.parse(row.profile_json || '{}'),
      analysis: JSON.parse(row.analysis_json || '{}'),
      documents: JSON.parse(row.documents_meta || '[]')
    });
  });

  // Delete a case (scoped to user)
  router.delete('/:id', (req, res) => {
    db.prepare('DELETE FROM cases WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
    res.json({ ok: true });
  });

  // Rename a case (scoped to user)
  router.patch('/:id', (req, res) => {
    const { name } = req.body;
    db.prepare("UPDATE cases SET name = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?").run(name, req.params.id, req.user.id);
    res.json({ ok: true });
  });

  return router;
}
