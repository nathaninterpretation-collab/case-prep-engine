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
