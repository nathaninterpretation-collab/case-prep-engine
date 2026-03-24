import Anthropic from '@anthropic-ai/sdk';

function getClient(apiKey) {
  return new Anthropic({ apiKey });
}

/**
 * Generate MCQ quiz from terminology list
 */
export async function generateQuiz(terminology, apiKey, count = 30) {
  if (!terminology || terminology.length === 0) {
    return { questions: [], error: 'No terminology available for quiz' };
  }

  // Pick up to `count` terms, weighted by difficulty
  const selected = terminology
    .sort(() => Math.random() - 0.5)
    .slice(0, Math.min(count, terminology.length));

  const questions = selected.map(term => {
    // Randomly choose direction: EN→ZH or ZH→EN
    const enToZh = Math.random() > 0.5;

    if (enToZh) {
      const correctVal = term.zh_simplified;
      // Pick 4 unique distractors that differ from the correct answer AND each other
      const distractors = pickUniqueDistractors(
        terminology, t => t.zh_simplified, correctVal, term.en, 4
      );
      const options = shuffle([correctVal, ...distractors]);
      return {
        question: term.en,
        direction: 'EN→ZH',
        options,
        correct: correctVal,
        context_note: term.context_note,
        difficulty: term.difficulty || 3
      };
    } else {
      const correctVal = term.en;
      const distractors = pickUniqueDistractors(
        terminology, t => t.en, correctVal, term.en, 4
      );
      const options = shuffle([correctVal, ...distractors]);
      return {
        question: term.zh_simplified,
        direction: 'ZH→EN',
        options,
        correct: correctVal,
        context_note: term.context_note,
        difficulty: term.difficulty || 3
      };
    }
  });

  return { questions, totalTerms: terminology.length };
}

/**
 * Generate a sight translation passage based on hazard zones
 */
export async function generateSightPassage(hazardZones, caseProfile, apiKey) {
  if (!hazardZones || hazardZones.length === 0) {
    return { passage: '', keyTerms: [], error: 'No hazard zones available' };
  }

  // Pick a random hazard zone
  const hazard = hazardZones[Math.floor(Math.random() * hazardZones.length)];

  const response = await getClient(apiKey).messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2000,
    messages: [{
      role: 'user',
      content: `Generate a realistic 2-5 sentence passage that could appear in a ${caseProfile.case_type} case (${caseProfile.case_subtype}).

The passage should represent either an attorney question or witness answer related to this scenario:
"${hazard.scenario}"

The passage must naturally include these critical terms: ${hazard.critical_terms?.join(', ') || 'relevant domain terminology'}

Also provide the key terms that an interpreter must render correctly, with their Chinese translations.

Respond in JSON:
{
  "passage": "The English passage text",
  "speaker": "attorney|witness",
  "key_terms": [
    {"en": "term", "zh_simplified": "术语", "zh_traditional": "術語"}
  ]
}`
    }]
  });

  const text = response.content[0].text;
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return { passage: hazard.example_exchange?.attorney_asks || '', keyTerms: hazard.critical_terms || [] };
  return JSON.parse(jsonMatch[0]);
}

/**
 * Grade a sight translation attempt.
 * Compares user's translation against the source passage + key terms.
 * Uses Claude for semantic comparison, plus fuzzy matching for term hits.
 */
export async function gradeSightTranslation(passage, keyTerms, userTranslation, caseProfile, apiKey) {
  // Step 1: Fuzzy match key terms in user's translation
  const termResults = keyTerms.map(term => {
    const userLower = userTranslation.toLowerCase();
    const zhSimp = (term.zh_simplified || '').toLowerCase();
    const zhTrad = (term.zh_traditional || '').toLowerCase();

    // Exact match
    if (zhSimp && userTranslation.includes(term.zh_simplified)) return { ...term, match: 'exact', found: true };
    if (zhTrad && userTranslation.includes(term.zh_traditional)) return { ...term, match: 'exact', found: true };

    // Fuzzy match: check if significant portion of characters appear
    const fuzzyMatch = (target) => {
      if (!target || target.length < 2) return false;
      const chars = [...target];
      const hits = chars.filter(c => userTranslation.includes(c)).length;
      return hits / chars.length >= 0.6;
    };
    if (fuzzyMatch(term.zh_simplified) || fuzzyMatch(term.zh_traditional)) return { ...term, match: 'partial', found: true };

    // Check for transliteration / phonetic match in pinyin-ish text
    const enLower = (term.en || '').toLowerCase();
    if (enLower.length > 3 && userLower.includes(enLower)) return { ...term, match: 'english_used', found: true };

    return { ...term, match: 'missed', found: false };
  });

  // Step 2: Claude semantic grading
  const response = await getClient(apiKey).messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2000,
    messages: [{
      role: 'user',
      content: `You are an interpreter exam grader. Compare this sight translation attempt against the source passage.

SOURCE PASSAGE (English, ${caseProfile?.case_type || 'legal'} context):
"${passage}"

INTERPRETER'S TRANSLATION (into Chinese):
"${userTranslation}"

KEY TERMS that should appear in the translation:
${keyTerms.map(t => `- "${t.en}" → "${t.zh_simplified}" / "${t.zh_traditional}"`).join('\n')}

Grade the translation and respond in JSON:
{
  "overall_score": <0-100>,
  "accuracy": <0-100 — does the meaning match?>,
  "completeness": <0-100 — were all parts of the passage translated?>,
  "terminology_score": <0-100 — were key terms rendered correctly?>,
  "fluency": <0-100 — does it read naturally in Chinese?>,
  "model_translation": "<your reference translation of the full passage into Chinese>",
  "feedback": "<2-3 sentences of specific, constructive feedback>",
  "term_notes": [
    {"en": "term", "verdict": "correct|partial|missed|wrong_term", "note": "<brief note on how user rendered it>"}
  ]
}`
    }]
  });

  const text = response.content[0].text;
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return { overall_score: 0, feedback: 'Failed to grade translation.', term_results: termResults };
  }

  const grading = JSON.parse(jsonMatch[0]);
  grading.term_results = termResults;
  return grading;
}

/**
 * Pick N unique distractor values that are all different from each other
 * AND different from the correct answer.
 */
function pickUniqueDistractors(pool, valueFn, correctVal, correctKey, count) {
  const seen = new Set([correctVal]);
  const candidates = pool
    .filter(t => t.en !== correctKey)
    .sort(() => Math.random() - 0.5);

  const result = [];
  for (const t of candidates) {
    const val = valueFn(t);
    if (val && !seen.has(val)) {
      seen.add(val);
      result.push(val);
      if (result.length >= count) break;
    }
  }
  return result;
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
