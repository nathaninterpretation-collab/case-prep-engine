import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';
import { initDb } from './db/init.js';
import analyzeRoutes from './routes/analyze.js';
import casesRoutes from './routes/cases.js';
import quizRoutes from './routes/quiz.js';

// Node v24: dotenv.config() may not populate process.env automatically
const dotenvResult = dotenv.config();
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
app.use('/api/analyze', analyzeRoutes(db));
app.use('/api/cases', casesRoutes(db));
app.use('/api/quiz', quizRoutes(db));

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(join(__dirname, '..', 'client', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Case Prep Engine running at http://localhost:${PORT}`);
});
