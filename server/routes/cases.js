import { Router } from 'express';

export default function casesRoutes(db) {
  const router = Router();

  // List all cases
  router.get('/', (req, res) => {
    const cases = db.prepare(
      'SELECT id, name, case_type, case_subtype, created_at, updated_at FROM cases ORDER BY updated_at DESC'
    ).all();
    res.json(cases);
  });

  // Get single case with full data
  router.get('/:id', (req, res) => {
    const row = db.prepare('SELECT * FROM cases WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Case not found' });
    res.json({
      ...row,
      profile: JSON.parse(row.profile_json || '{}'),
      analysis: JSON.parse(row.analysis_json || '{}'),
      documents: JSON.parse(row.documents_meta || '[]')
    });
  });

  // Delete a case
  router.delete('/:id', (req, res) => {
    db.prepare('DELETE FROM cases WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  });

  // Rename a case
  router.patch('/:id', (req, res) => {
    const { name } = req.body;
    db.prepare("UPDATE cases SET name = ?, updated_at = datetime('now') WHERE id = ?").run(name, req.params.id);
    res.json({ ok: true });
  });

  return router;
}
