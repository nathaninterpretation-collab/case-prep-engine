/**
 * Import T, EV, and STPL arrays from the trainer HTML file.
 * Parses the JavaScript embedded in the monolithic HTML and writes
 * the extracted data to server/data/trainerTerms.js
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const TRAINER_PATHS = [
  join(__dirname, '..', '..', 'Interpreter Trainer Modules', 'AAG-experiment_v2.42.html'),
  join(__dirname, '..', '..', 'Interpreter Trainer Modules', 'AAG-experiment_v2.41.html'),
];

const OUTPUT = join(__dirname, '..', 'server', 'data', 'trainerTerms.js');

function findTrainer() {
  for (const p of TRAINER_PATHS) {
    if (existsSync(p)) return p;
  }
  return null;
}

function extractArray(html, varName) {
  // Match patterns like: const T = [...] or let T = [...] or var T = [...]
  // Also handle: const T=[...]
  const patterns = [
    new RegExp(`(?:const|let|var)\\s+${varName}\\s*=\\s*\\[`, 's'),
  ];

  for (const pat of patterns) {
    const match = pat.exec(html);
    if (!match) continue;

    const startIdx = match.index + match[0].length - 1; // position of '['
    let depth = 1;
    let i = startIdx + 1;
    while (i < html.length && depth > 0) {
      if (html[i] === '[') depth++;
      else if (html[i] === ']') depth--;
      i++;
    }

    const arrayStr = html.slice(startIdx, i);
    try {
      // Use Function constructor to safely evaluate the array literal
      const fn = new Function(`return ${arrayStr}`);
      return fn();
    } catch (e) {
      console.error(`Failed to parse ${varName}:`, e.message);
      return null;
    }
  }
  return null;
}

function main() {
  const trainerPath = findTrainer();
  if (!trainerPath) {
    console.error('Trainer app not found. Checked:', TRAINER_PATHS);
    process.exit(1);
  }

  console.log(`Reading trainer: ${trainerPath}`);
  const html = readFileSync(trainerPath, 'utf-8');

  console.log('Extracting T array...');
  const T = extractArray(html, 'T') || [];
  console.log(`  Found ${T.length} terms`);

  console.log('Extracting EV array...');
  const EV = extractArray(html, 'EV') || [];
  console.log(`  Found ${EV.length} extended vocabulary entries`);

  console.log('Extracting TAA_PFSF array...');
  const TAA_PFSF = extractArray(html, 'TAA_PFSF') || [];
  console.log(`  Found ${TAA_PFSF.length} PFSF semantic field entries`);

  const output = `// Auto-generated from trainer app. Do not edit manually.
// Source: ${trainerPath}
// Generated: ${new Date().toISOString()}

export const T = ${JSON.stringify(T, null, 2)};

export const EV = ${JSON.stringify(EV, null, 2)};

export const TAA_PFSF = ${JSON.stringify(TAA_PFSF, null, 2)};
`;

  writeFileSync(OUTPUT, output, 'utf-8');
  console.log(`\nWritten to ${OUTPUT}`);
  console.log(`Total: ${T.length} T + ${EV.length} EV + ${TAA_PFSF.length} PFSF`);
}

main();
