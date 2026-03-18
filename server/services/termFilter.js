// Baseline vocabulary that any experienced court interpreter already knows
const BASELINE_LEGAL_VOCAB = new Set([
  'courtroom', 'court', 'judge', 'attorney', 'lawyer', 'counsel',
  'plaintiff', 'defendant', 'petitioner', 'respondent',
  'objection', 'sustained', 'overruled', 'sidebar',
  'witness', 'testimony', 'testify', 'sworn', 'oath',
  'evidence', 'exhibit', 'trial', 'hearing', 'motion',
  'deposition', 'transcript', 'record', 'stipulate', 'stipulation',
  'jury', 'verdict', 'sentence', 'sentencing',
  'guilty', 'not guilty', 'innocent', 'plea',
  'bail', 'bond', 'probation', 'parole',
  'prosecution', 'defense', 'complaint', 'answer',
  'discovery', 'interrogatory', 'subpoena',
  'order', 'ruling', 'judgment', 'decree',
  'appeal', 'appellant', 'appellee',
  'tort', 'liability', 'damages', 'negligence',
  'statute', 'regulation', 'code', 'law',
  'arrest', 'charge', 'indictment', 'arraignment',
  'cross-examination', 'direct examination', 'redirect',
  'voir dire', 'empanelment',
  'interpreter', 'translation', 'interpretation',
  'swear', 'affirm', 'perjury',
  'clerk', 'bailiff', 'marshal',
  'sustain', 'overrule', 'strike', 'stricken'
]);

/**
 * Filter terminology list by:
 * - Remove baseline legal vocabulary (too easy)
 * - Score by probability × difficulty
 * - Sort by relevance
 */
export function filterTerminology(terms) {
  return terms
    .filter(term => {
      const enLower = (term.en || '').toLowerCase();
      // Remove if it's baseline vocabulary
      if (BASELINE_LEGAL_VOCAB.has(enLower)) return false;
      // Remove if probability is too low
      if (term.probability !== undefined && term.probability < 0.15) return false;
      return true;
    })
    .sort((a, b) => {
      // Sort by (probability × difficulty) descending — sweet spot terms first
      const scoreA = (a.probability || 0.5) * (a.difficulty || 3);
      const scoreB = (b.probability || 0.5) * (b.difficulty || 3);
      return scoreB - scoreA;
    });
}
