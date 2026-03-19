import Anthropic from '@anthropic-ai/sdk';

function getClient(apiKey) {
  return new Anthropic({ apiKey });
}

export async function generatePodcastScript(analysis, profile, apiKey) {
  const termCount = (analysis.terminology || []).length;
  const contextCount = (analysis.context_nodes || []).length;
  const hazardCount = (analysis.hazard_zones || []).length;
  const coaCount = (analysis.legal_theory?.causes_of_action || []).length;

  // Build a structured summary of the analysis data for the prompt
  const analysisSummary = {
    profile: {
      case_type: profile.case_type,
      case_subtype: profile.case_subtype,
      parties: profile.parties,
      causes_of_action: profile.causes_of_action,
      jurisdiction: profile.jurisdiction,
      venue: profile.venue,
      key_dates: profile.key_dates,
      key_locations: profile.key_locations,
      key_amounts: profile.key_amounts,
      activated_domains: profile.activated_domains,
      p_distance: profile.p_distance,
      adversarial_structure: profile.adversarial_structure,
    },
    terminology: (analysis.terminology || []).slice(0, 40).map(t => ({
      en: t.en, zh_simplified: t.zh_simplified, zh_traditional: t.zh_traditional,
      pinyin: t.pinyin, context_note: t.context_note, difficulty: t.difficulty
    })),
    context_nodes: (analysis.context_nodes || []).slice(0, 25).map(n => ({
      label: n.label, type: n.type, detail: n.detail, significance: n.significance,
      connections: (n.connections || []).slice(0, 5)
    })),
    legal_theory: analysis.legal_theory,
    industry_knowledge: analysis.industry_knowledge,
    hazard_zones: analysis.hazard_zones,
  };

  const prompt = PODCAST_PROMPT.replace('{analysis_json}', JSON.stringify(analysisSummary, null, 2));

  let text = '';
  const stream = await getClient(apiKey).messages.stream({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 16000,
    messages: [{ role: 'user', content: prompt }]
  });

  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta?.text) {
      text += event.delta.text;
    }
  }

  // Parse the script — expect markdown-formatted script
  const wordCount = text.split(/\s+/).length;
  const estimatedMinutes = Math.round(wordCount / 120);

  // Extract segment headers for navigation
  const segments = [];
  const segmentRegex = /^## \[(.+?)(?:\s*[—–-]\s*[\d:]+\s*-\s*[\d:]+)?\s*\]/gm;
  let match;
  while ((match = segmentRegex.exec(text)) !== null) {
    segments.push({ title: match[1].trim(), offset: match.index });
  }

  return {
    script: text,
    wordCount,
    estimatedMinutes,
    segments,
    generatedAt: new Date().toISOString()
  };
}

const PODCAST_PROMPT = `You are generating a podcast deep-dive script for a bilingual court interpreter preparing for a case assignment. This is modeled after NotebookLM's podcast format — two hosts having an engaging, natural conversation that makes complex legal materials digestible and approachable.

CASE ANALYSIS DATA:
{analysis_json}

REQUIREMENTS:

1. FORMAT: Two-host conversational script
   - Host A = Lead Analyst (drives the narrative, presents facts and legal framework)
   - Host B = Interpreter Prep Specialist (focuses on linguistic hazards, Chinese terms, and practical booth readiness)
   - Use **A:** and **B:** prefixes for each speaker turn
   - Natural conversation flow — hosts build on each other's points, ask follow-ups, react authentically

2. LENGTH: Target exactly 3,400-3,800 words (28-32 minutes at 120 WPM)

3. STRUCTURE — Use these 6 segments with markdown headers:
   ## [COLD OPEN — 0:00-1:00]
   Hook the listener with the most compelling tension in this case. Set the stakes.

   ## [SEGMENT 1: CASE PROFILE — 1:00-5:00]
   Parties, case type, jurisdiction, key dates, financial landscape. P-Distance rating.

   ## [SEGMENT 2: THE NARRATIVE — 5:00-12:00]
   Walk through the chronological story of the case. Make it vivid. This is where the listener builds their mental model of what happened.

   ## [SEGMENT 3: THE LEGAL FRAMEWORK — 12:00-18:00]
   Causes of action, elements, evidence. What legal arguments will fly in this courtroom? What questions will attorneys ask?

   ## [SEGMENT 4: INTERPRETER HAZARD ZONES — 18:00-24:00]
   The danger moments. Where will the interpreter freeze, fumble, or mistranslate? Use the hazard_zones data. Give specific Chinese terms with characters and pinyin inline.

   ## [SEGMENT 5: INDUSTRY & DOMAIN KNOWLEDGE — 24:00-28:00]
   What domain expertise does this case activate? Process steps, technical vocabulary, industry context. Use industry_knowledge data.

   ## [SEGMENT 6: PREP CHECKLIST — 28:00-30:00]
   Close with actionable preparation steps. What to study tonight. What to drill. What to emotionally prepare for.

4. LANGUAGE:
   - Primarily English
   - Embed Chinese terms (simplified characters + pinyin in parentheses) where interpreters need them
   - Format: 监护权 (jiānhù quán) — inline, not footnoted
   - Use Chinese for: legal terms without direct equivalents, medical/technical terms, key vocabulary from the terminology list
   - Don't overdo it — Chinese should appear naturally where an interpreter would actually need the term, not in every sentence

5. TONE:
   - Professional but human. Think NPR meets law school study group.
   - Acknowledge difficulty and emotional weight of the case
   - Never condescending — the listener is a working professional
   - Use specific examples from the case data, not generic advice
   - Host B should occasionally push back on or add nuance to Host A's points

6. CONTENT RULES:
   - Use the ANALYSIS DATA provided — don't invent facts not in the data
   - Reference specific terminology from the terminology list (at least 15-20 terms)
   - Reference specific hazard zones from the hazard_zones list
   - Include at least 3-4 specific attorney questions that might be asked (from legal_theory.likely_questions)
   - Include financial figures if available (key_amounts)
   - Close with the case number and hearing date if available

Output the complete script in markdown format. Do not wrap in code blocks. Start directly with the cold open.`;
