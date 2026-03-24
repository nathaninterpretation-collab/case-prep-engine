import { Router } from 'express';
import multer from 'multer';
import { v4 as uuid } from 'uuid';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkdir } from 'fs/promises';
import { extractText } from '../services/documentExtractor.js';
import { analyzeCaseProfile } from '../services/caseAnalyzer.js';
import { generatePreparation } from '../services/deductiveEngine.js';
import { filterTerminology } from '../services/termFilter.js';
import { decryptApiKey } from '../services/crypto.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const uploadDir = join(__dirname, '..', '..', 'uploads');

// Ensure upload dir exists
await mkdir(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: uploadDir,
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB per file
  fileFilter: (req, file, cb) => {
    const allowed = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain',
      'image/png',
      'image/jpeg'
    ];
    cb(null, allowed.includes(file.mimetype));
  }
});

export default function analyzeRoutes(db) {
  const router = Router();

  // Upload and analyze documents
  router.post('/', upload.array('documents', 20), async (req, res) => {
    try {
      if (!req.files || req.files.length === 0) {
        return res.status(400).json({ error: 'No documents uploaded' });
      }

      const caseId = uuid();
      const caseName = req.body.caseName || 'Untitled Case';
      const docLabels = req.body.docLabels
        ? JSON.parse(req.body.docLabels)
        : req.files.map(f => f.originalname);

      // Step 1: Extract text from all documents
      const documentTexts = [];
      for (let i = 0; i < req.files.length; i++) {
        const file = req.files[i];
        const extracted = await extractText(file.path, file.mimetype);
        documentTexts.push({
          label: docLabels[i] || file.originalname,
          text: extracted.text,
          isImage: extracted.isImage || false,
          base64: extracted.base64 || null,
          mediaType: extracted.mediaType || null,
          filename: file.originalname,
          size: file.size
        });
      }

      // Get API key from user's encrypted storage or fallback to env
      const userRow = db.prepare('SELECT api_key_encrypted, api_key_iv, api_key_tag FROM users WHERE id = ?').get(req.user.id);
      const apiKey = (userRow?.api_key_encrypted)
        ? decryptApiKey(userRow.api_key_encrypted, userRow.api_key_iv, userRow.api_key_tag)
        : process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        return res.status(400).json({ error: 'No API key set. Please add your Anthropic API key in Settings.' });
      }

      // Step 2: Case profile detection
      const caseProfile = await analyzeCaseProfile(documentTexts, apiKey);

      // Step 3: Deductive inference — generate all 6 tabs
      const preparation = await generatePreparation(caseProfile, documentTexts, apiKey);

      // Step 4: Filter terminology
      if (preparation.terminology) {
        preparation.terminology = filterTerminology(preparation.terminology);
      }

      // Save to database
      const docsMeta = req.files.map((f, i) => ({
        filename: f.originalname,
        size: f.size,
        label: docLabels[i] || f.originalname
      }));

      db.prepare(`
        INSERT INTO cases (id, name, case_type, case_subtype, profile_json, analysis_json, documents_meta, user_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        caseId,
        caseName,
        caseProfile.case_type,
        caseProfile.case_subtype,
        JSON.stringify(caseProfile),
        JSON.stringify(preparation),
        JSON.stringify(docsMeta),
        req.user.id
      );

      res.json({
        caseId,
        caseName,
        profile: caseProfile,
        analysis: preparation
      });
    } catch (err) {
      console.error('Analysis error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
