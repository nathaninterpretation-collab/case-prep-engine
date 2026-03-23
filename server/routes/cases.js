import { Router } from 'express';

export default function casesRoutes(db) {
  const router = Router();

  // List user's cases
  router.get('/', (req, res) => {
    const cases = db.prepare(
      'SELECT id, name, case_type, case_subtype, created_at, updated_at, tags, sort_order, hearing_date FROM cases WHERE user_id = ? ORDER BY sort_order ASC, updated_at DESC'
    ).all(req.user.id);
    res.json(cases.map(c => ({ ...c, tags: c.tags ? JSON.parse(c.tags) : [] })));
  });

  // Get single case (scoped to user)
  router.get('/:id', (req, res) => {
    const row = db.prepare('SELECT * FROM cases WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!row) return res.status(404).json({ error: 'Case not found' });
    res.json({
      ...row,
      profile: JSON.parse(row.profile_json || '{}'),
      analysis: JSON.parse(row.analysis_json || '{}'),
      documents: JSON.parse(row.documents_meta || '[]'),
      tags: row.tags ? JSON.parse(row.tags) : [],
      notes: row.notes || ''
    });
  });

  // Delete a case (scoped to user)
  router.delete('/:id', (req, res) => {
    db.prepare('DELETE FROM cases WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
    res.json({ ok: true });
  });

  // Update a case (name, tags, notes, hearing_date)
  router.patch('/:id', (req, res) => {
    const { name, tags, notes, hearing_date } = req.body;
    const updates = [];
    const params = [];

    if (name !== undefined) { updates.push('name = ?'); params.push(name); }
    if (tags !== undefined) { updates.push('tags = ?'); params.push(JSON.stringify(tags)); }
    if (notes !== undefined) { updates.push('notes = ?'); params.push(notes); }
    if (hearing_date !== undefined) { updates.push('hearing_date = ?'); params.push(hearing_date); }

    if (updates.length === 0) return res.status(400).json({ error: 'No fields to update' });

    updates.push("updated_at = datetime('now')");
    params.push(req.params.id, req.user.id);

    db.prepare(`UPDATE cases SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`).run(...params);
    res.json({ ok: true });
  });

  // Reorder cases
  router.put('/reorder', (req, res) => {
    const { order } = req.body; // array of { id, sort_order }
    if (!Array.isArray(order)) return res.status(400).json({ error: 'order must be an array' });

    const stmt = db.prepare('UPDATE cases SET sort_order = ? WHERE id = ? AND user_id = ?');
    const updateMany = db.transaction((items) => {
      for (const item of items) {
        stmt.run(item.sort_order, item.id, req.user.id);
      }
    });
    updateMany(order);
    res.json({ ok: true });
  });

  return router;
}
