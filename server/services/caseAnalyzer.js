import Anthropic from '@anthropic-ai/sdk';

function getClient(apiKey) {
  return new Anthropic({ apiKey });
}

export async function analyzeCaseProfile(documentTexts, apiKey) {
  // Build multimodal message content
  const content = [];
  const textDocs = documentTexts.filter(d => !d.isImage);
  const imageDocs = documentTexts.filter(d => d.isImage && d.base64);

  // Add scanned/image documents first (Claude reads them via vision)
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
      text: `[Above is document: "${doc.label}". Read ALL text from this document carefully.]`
    });
  }

  // Add text documents
  if (textDocs.length > 0) {
    let combined = textDocs.map(d => `=== DOCUMENT: ${d.label} ===\n${d.text}`).join('\n\n');
    if (combined.length > 400000) {
      combined = combined.slice(0, 400000) + '\n\n[TRUNCATED]';
    }
    content.push({ type: 'text', text: combined });
  }

  // Add the analysis prompt
  const docDesc = imageDocs.length > 0 && textDocs.length === 0
    ? '[Documents provided as images above. Extract all text and analyze.]'
    : '[Documents provided above.]';

  content.push({
    type: 'text',
    text: CASE_PROFILE_PROMPT.replace('{extracted_text_with_labels}', docDesc)
  });

  const response = await getClient(apiKey).messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4096,
    messages: [{ role: 'user', content }]
  });

  const text = response.content[0].text;
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Failed to parse case profile from API response');
  return JSON.parse(jsonMatch[0]);
}

const CASE_PROFILE_PROMPT = `You are analyzing legal/professional documents for a court interpreter's case preparation.

{extracted_text_with_labels}

Extract the following in JSON format:
{
  "case_type": "PI | family | criminal | commercial_litigation | employment | real_estate | immigration | administrative | industry_event | other",
  "case_subtype": "specific description, e.g., 'trucking accident PI' or 'shareholder dispute'",
  "parties": [
    {"role": "plaintiff|defendant|petitioner|respondent|witness|other", "name": "", "description": ""}
  ],
  "causes_of_action": ["list of legal claims/allegations"],
  "jurisdiction": "",
  "venue": "",
  "key_dates": [{"date": "", "significance": ""}],
  "key_locations": [{"location": "", "significance": ""}],
  "key_amounts": [{"amount": "", "context": ""}],
  "activated_domains": ["list of expert domains activated by this case"],
  "p_distance": "1-5 (1=routine interpreter territory, 5=radically unfamiliar)",
  "input_richness": "full | complaint_only | notice_only | client_materials | mixed",
  "adversarial_structure": {
    "plaintiff_strategy_summary": "",
    "defendant_strategy_summary": ""
  }
}

Respond with ONLY the JSON object, no additional text.`;
