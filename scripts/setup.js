import { execSync } from 'child_process';
import { existsSync } from 'fs';

console.log('=== CPE Setup ===\n');

// Check Node version
const nodeVer = process.version;
console.log(`Node.js: ${nodeVer}`);

// Check for Whisper
try {
  execSync('whisper --help', { stdio: 'pipe' });
  console.log('Whisper: Found (local installation)');
} catch {
  console.log('Whisper: Not found — voice features will be limited');
}

// Check for API key
if (process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY !== 'your_api_key_here') {
  console.log('Anthropic API: Key configured');
} else {
  console.log('Anthropic API: ⚠ Set ANTHROPIC_API_KEY in .env file');
}

// Check for trainer app
const trainerPaths = [
  'C:/Users/natha/Desktop/Claude CoWork_BilinCo Nathan/Interpreter Trainer Modules/AAG-experiment_v2.42.html',
  'C:/Users/natha/Desktop/Claude CoWork_BilinCo Nathan/Interpreter Trainer Modules/AAG-experiment_v2.41.html',
];

const trainerFound = trainerPaths.find(p => existsSync(p));
if (trainerFound) {
  console.log(`Trainer app: Found at ${trainerFound}`);
  console.log('  Run "npm run import-trainer" to import terminology database');
} else {
  console.log('Trainer app: Not found — will use API-generated terms only');
}

console.log('\nSetup complete. Run "npm run dev" to start the server.');
