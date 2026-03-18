import Anthropic from '@anthropic-ai/sdk';

function getClient(apiKey) {
  return new Anthropic({ apiKey });
}

export async function generatePreparation(caseProfile, documentTexts, apiKey) {
  // Build multimodal content
  const content = [];
  const textDocs = documentTexts.filter(d => !d.isImage);
  const imageDocs = documentTexts.filter(d => d.isImage && d.base64);

  // Add scanned/image documents via vision
  for (const doc of imageDocs) {
    if (doc.mediaType === 'application/pdf') {
      content.push({
        type: 'document',
        source: { type: 'base64', media_type: 'application/pdf', data: doc.base64 }
      });
    } else {
      content.push({
        type: 'image',
        source: { type: 'base64', media_type: doc.mediaType, data: doc.base64 }
      });
    }
    content.push({
      type: 'text',
      text: `[Document: "${doc.label}" — read all text from this document.]`
    });
  }

  // Build text portion
  let docText = textDocs.map(d => `=== DOCUMENT: ${d.label} ===\n${d.text}`).join('\n\n');
  if (docText.length > 300000) docText = docText.slice(0, 300000) + '\n\n[TRUNCATED]';

  const sourceDesc = imageDocs.length > 0 && textDocs.length === 0
    ? '[Source documents provided as images above. Use the text you extracted from them.]'
    : docText;

  const prompt = DEDUCTIVE_PROMPT
    .replace('{case_profile_json}', JSON.stringify(caseProfile, null, 2))
    .replace('{extracted_text}', sourceDesc)
    .replace('{p_distance}', caseProfile.p_distance || '3');

  content.push({ type: 'text', text: prompt });

  // Use streaming for large responses to avoid timeout
  let text = '';
  const stream = await getClient(apiKey).messages.stream({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 32000,
    messages: [{ role: 'user', content }]
  });
  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta?.text) {
      text += event.delta.text;
    }
  }
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Failed to parse preparation from API response');
  return JSON.parse(jsonMatch[0]);
}

const DEDUCTIVE_PROMPT = `You are generating case preparation materials for a bilingual (EN↔ZH Mandarin/Cantonese) court interpreter.

CASE PROFILE:
{case_profile_json}

SOURCE DOCUMENTS:
{extracted_text}

Generate preparation materials following these principles:
1. The interpreter is NOT a legal strategist. The interpreter needs LINGUISTIC scaffolding.
2. Filter by: probability of appearing in THIS case × interpreter uncertainty. Drop terms any experienced court interpreter knows (courtroom, judge, attorney, plaintiff, defendant, objection, sustained, overruled, etc.). Surface terms that are case-specific and genuinely uncertain.
3. The allegation/claim constrains the domain search. Don't search "chemistry" — search "chemistry of [specific compound] relevant to [specific allegation]."
4. For each term: provide English, Simplified Chinese, Traditional Chinese, Pinyin, and a one-line context note explaining why it matters in THIS case.
5. Context nodes must tie objective markers (dates, addresses, amounts, names) to their phenomenological meaning in the case.
6. Legal theory should show causes of action → elements → evidence → implied questions → implied answers.
7. Industry knowledge should show the constrained process/procedure with terminology embedded.
8. Hazard zones should be full scenario-level: "When attorney asks X, witness might say Y, and the whole exchange is hard because Z."
9. P-distance = {p_distance}. If high (4-5), include more foundational domain orientation. If low (1-2), stay terminology-focused.

MINIMUM OUTPUT REQUIREMENTS (critical — do not produce less than these):
- terminology: AT LEAST 50 terms (aim for 60-80). Mine the documents deeply. Include domain-specific terms, legal terms specific to this case type, technical vocabulary, proper nouns requiring translation, idiomatic expressions likely to appear, and terms from adjacent domains activated by the case. Go wide — the interpreter needs comprehensive coverage.
- context_nodes: AT LEAST 20 nodes. Extract every date, person, location, amount, document, and event from the source material. Create connections between related nodes.
- hazard_zones: AT LEAST 6 scenarios.
- Each cause of action should have AT LEAST 4 elements, 4 evidence items, 4 likely questions, and 4 likely answers.
- Each industry process step should have AT LEAST 3 key_terms.

Respond with a JSON object with these keys:

{
  "terminology": [
    {
      "en": "English term",
      "zh_simplified": "简体中文",
      "zh_traditional": "繁體中文",
      "pinyin": "pīnyīn",
      "context_note": "Why it matters in this case",
      "domain": "category/domain",
      "difficulty": 1-5,
      "probability": 0.0-1.0
    }
  ],
  "context_nodes": [
    {
      "id": "unique_id",
      "label": "Short label",
      "type": "date|location|person|document|amount|event",
      "detail": "What this is",
      "significance": "Why it matters in this case",
      "connections": ["id_of_connected_node"]
    }
  ],
  "legal_theory": {
    "causes_of_action": [
      {
        "name": "Cause of action name",
        "elements": ["element 1", "element 2"],
        "evidence_needed": ["evidence item"],
        "likely_questions": ["question attorney might ask"],
        "likely_answers": ["answer witness might give"],
        "plaintiff_angle": "How plaintiff uses this",
        "defendant_angle": "How defendant counters"
      }
    ]
  },
  "industry_knowledge": {
    "domain": "Domain name",
    "overview": "Brief orientation for high P-distance cases",
    "process_steps": [
      {
        "step": "Step name",
        "description": "What happens here",
        "key_terms": [
          {"en": "term", "zh_simplified": "术语", "zh_traditional": "術語", "pinyin": "shùyǔ"}
        ]
      }
    ]
  },
  "hazard_zones": [
    {
      "scenario": "Description of the exchange scenario",
      "why_hard": "Why this is difficult for the interpreter",
      "critical_terms": ["term1", "term2"],
      "example_exchange": {
        "attorney_asks": "Example question",
        "witness_answers": "Example answer"
      },
      "severity": 1-5
    }
  ]
}

Respond with ONLY the JSON object.`;
