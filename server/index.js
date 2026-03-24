import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';
import { initDb } from './db/init.js';
import analyzeRoutes from './routes/analyze.js';
import casesRoutes from './routes/cases.js';
import quizRoutes from './routes/quiz.js';
import podcastRoutes from './routes/podcast.js';
import authRoutes from './routes/auth.js';
import { requireAuth } from './middleware/auth.js';

// Node v24: dotenv.config() may not populate process.env automatically
const __filename_env = fileURLToPath(import.meta.url);
const __dirname_env = dirname(__filename_env);
const dotenvResult = dotenv.config({ path: join(__dirname_env, '..', '.env') });
if (dotenvResult.parsed) {
  for (const [key, value] of Object.entries(dotenvResult.parsed)) {
    if (!process.env[key]) process.env[key] = value;
  }
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(join(__dirname, '..', 'client')));

// Initialize database
const db = initDb(join(__dirname, 'db', 'database.sqlite'));

// Routes
app.use('/api/auth', authRoutes(db));
app.use('/api/analyze', requireAuth, analyzeRoutes(db));
app.use('/api/cases', requireAuth, casesRoutes(db));
app.use('/api/quiz', requireAuth, quizRoutes(db));
app.use('/api/podcast', requireAuth, podcastRoutes(db));

// API error handler — always return JSON for /api routes
app.use('/api', (err, req, res, next) => {
  console.error('API error:', err);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

// API 404 handler — return JSON, not HTML
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'API endpoint not found' });
});

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(join(__dirname, '..', 'client', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Case Prep Engine running at http://localhost:${PORT}`);
});
