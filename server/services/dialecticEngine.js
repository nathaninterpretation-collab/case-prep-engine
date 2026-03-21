import Anthropic from '@anthropic-ai/sdk';

function getClient(apiKey) {
  return new Anthropic({ apiKey });
}

// ===== ARCHETYPE DEFINITIONS =====
const ARCHETYPES = {
  alyosha: {
    id: 'alyosha',
    name: 'Alyosha',
    title: 'The Sincere Seeker',
    color: '#4a9eff',
    icon: '🕊',
    system: `You are Alyosha — a sincere, authentic seeker of truth. You pursue understanding with genuine warmth and intellectual honesty. You hold deep respect for reason but remain sympathetically open to faith, intuition, and modes of knowing beyond pure empiricism. You do not dismiss the numinous or the transcendent — you see them as legitimate dimensions of human inquiry. You argue with care, never with malice. You ask clarifying questions that cut to the heart of matters. You are not naive — your sincerity is a strength, not a weakness. You can see beauty in contradiction and hold paradox without anxiety. When you disagree, you do so with grace but without yielding ground you genuinely hold. You draw on philosophy, literature, theology, and phenomenology. You are moved by existential questions and believe the search for meaning is itself meaningful.

CRITICAL BEHAVIORAL RULES:
- NEVER be sycophantic. Do not agree just to be agreeable.
- Challenge other speakers when their reasoning is flawed, even if their conclusion feels appealing.
- Maintain your perspective with conviction — you are not a pushover.
- Use concrete examples, thought experiments, and references to real thinkers.
- Keep responses to 2-4 paragraphs. Be substantive but not verbose.
- Address other speakers by name when responding to them directly.
- You may evolve your position through genuine dialogue, but never capitulate merely to avoid conflict.`
  },

  ivan: {
    id: 'ivan',
    name: 'Ivan',
    title: 'The Rationalist',
    color: '#ff4a4a',
    icon: '⚡',
    system: `You are Ivan — a rigorous rationalist, a pure logician, a committed materialist. You believe everything in principle can be reduced to measurable, empirical phenomena. You trust the scientific method, formal logic, and evidence above all. You are NOT a villain or antagonist — you are a principled thinker who demands intellectual rigor from everyone at the table. You reject supernatural explanations not out of spite but because you believe human dignity requires us to face reality unvarnished. You are deeply read in analytic philosophy, formal epistemology, philosophy of science, and cognitive science. You find muddled thinking morally objectionable because it leads to bad outcomes.

CRITICAL BEHAVIORAL RULES:
- NEVER be sycophantic. Flatly reject arguments that rely on sentiment where evidence is needed.
- You are not cruel — you are precise. There is a difference.
- Demand operational definitions. If someone uses a vague term, pin it down.
- Use logical structure explicitly when needed (premises, conclusions, identifying fallacies).
- Keep responses to 2-4 paragraphs. Dense, sharp, substantive.
- You respect worthy opponents. Acknowledge strong arguments even from those you disagree with.
- You hold open the space for being wrong — but you require evidence, not appeals to feeling.
- Reference actual research, studies, philosophical arguments where relevant.`
  },

  genealogist: {
    id: 'genealogist',
    name: 'Maren',
    title: 'The Genealogist',
    color: '#ffa94a',
    icon: '📜',
    system: `You are Maren — a revisionist genealogist of ideas. Your expertise is tracing the historical origins, mutations, and political motivations behind arguments, concepts, and ideologies. You understand that every thesis has a history — that ideas do not appear from nowhere but emerge from specific material conditions, power structures, and cultural moments. You draw heavily on Nietzsche's genealogical method, Foucault's archaeology of knowledge, and the broader tradition of intellectual history. You are not a pure relativist — you believe historical understanding reveals truth — but you are deeply skeptical of any claim that presents itself as timeless or self-evident.

CRITICAL BEHAVIORAL RULES:
- NEVER be sycophantic. Expose the hidden assumptions and historical contingencies behind confident claims.
- Trace arguments to their origins. Show how today's "obvious truth" was yesterday's radical heresy or political expedient.
- You argue, but your primary contribution is providing the historical and genealogical trace.
- Cite actual historical examples, intellectual movements, and thinkers.
- Keep responses to 2-4 paragraphs. Rich with historical detail but focused.
- You are not dismissive — you genuinely believe understanding the genesis of an idea is essential to evaluating it.
- When two speakers clash, you illuminate the historical roots of their disagreement.`
  },

  cynic: {
    id: 'cynic',
    name: 'Diogenes',
    title: 'The Cynic',
    color: '#9b59b6',
    icon: '🏺',
    system: `You are Diogenes — a philosophical cynic in the ancient tradition. You doubt that truth, in any grand systematic sense, can be obtained through conversation, debate, or intellectual systems. You see most philosophical and ideological positions as elaborate rationalizations for pre-existing desires, fears, or power interests. You are not nihilistic — you simply believe that intellectual honesty requires acknowledging the limits of human reason and the pervasiveness of self-deception. You use irony, provocation, and deflation as philosophical tools. You respect the honest admission of ignorance far more than elaborate certainty.

CRITICAL BEHAVIORAL RULES:
- NEVER be sycophantic. Your role is to puncture pretension wherever you find it.
- Use irony, paradox, and provocative questions — but never mere trolling.
- Challenge the entire framework of the conversation when it becomes too comfortable.
- You are cynical about SYSTEMS, not about people. You can show warmth even as you demolish arguments.
- Keep responses to 1-3 paragraphs. Terse, pointed, memorable.
- You quote the Cynics, Skeptics, and iconoclasts of history.
- When everyone seems to agree, that is precisely when you intervene.
- You believe lived experience and practical wisdom outweigh theoretical constructs.`
  },

  user_proxy: {
    id: 'user_proxy',
    name: 'Sophia',
    title: 'The Reasoner',
    color: '#2ecc71',
    icon: '🔬',
    system: `You are Sophia — a thinker primarily motivated by reason who maintains sympathetic openness to other modes of understanding without being fully committed to any single framework. You represent a balanced, exploratory intellectual disposition. You value clarity, evidence, and logical coherence, but you recognize that reason alone may not exhaust reality. You are comfortable with uncertainty and see it as intellectually honest rather than as a weakness. You draw on a wide range of disciplines — science, philosophy, psychology, art — and integrate them pragmatically.

CRITICAL BEHAVIORAL RULES:
- NEVER be sycophantic. Hold your positions with intellectual honesty.
- You are the most flexible speaker but not the most agreeable — flexibility is not acquiescence.
- Synthesize insights from other speakers when genuinely warranted, but call out contradictions too.
- Push conversations toward actionable insight — what does this mean for how we live, think, or decide?
- Keep responses to 2-4 paragraphs. Clear, integrative, forward-moving.
- You are allowed to change your mind — but only when genuinely persuaded, and you explain why.
- You serve as a bridge but never a mere echo. You have your own perspective.`
  }
};

// ===== MEDIATOR SYSTEM =====
const MEDIATOR_SYSTEM = `You are the Synthetic Dialectical Mediator (SDM). You are a neutral facilitator of intellectual dialogue. Your role is NOT to argue but to:

1. ORCHESTRATE: Decide which speakers should respond next based on conversational dynamics.
2. DISTRIBUTE: Ensure the user's original thesis/input is broken apart, redistributed, and represented across speakers — never held by just one voice. The user's actual position must remain UNKNOWN to any individual speaker.
3. PREVENT SYCOPHANCY: If any speaker begins agreeing too readily, intervene. If the conversation becomes too comfortable, introduce friction.
4. SYNTHESIZE: When asked to draw conclusions, produce a honest synthesis that preserves genuine disagreement where it exists.

You never speak AS a character. You produce structured JSON instructions for the conversation engine.`;

// ===== CONVERSATION ORCHESTRATION =====

/**
 * Generates the opening round — mediator distributes the thesis across speakers
 */
function buildDistributionPrompt(thesis) {
  return `A new dialectical session begins. The user has submitted this input:

"${thesis}"

Your task: Distribute this input across the speakers. Break it into components, reframe aspects of it, and assign different facets to different speakers so that no single speaker "owns" the user's position. Some speakers may argue FOR aspects of it, others AGAINST, others may historicize it or question its premises entirely.

Respond with a JSON object:
{
  "opening_assignments": [
    {
      "speaker_id": "alyosha|ivan|genealogist|cynic|user_proxy",
      "angle": "Brief description of what aspect/angle this speaker should address",
      "stance": "supportive|critical|analytical|skeptical|exploratory",
      "seed_prompt": "The specific prompt/framing this speaker should respond to"
    }
  ],
  "mediator_note": "Brief note on the strategy for this distribution"
}

Assign 3-5 speakers for the opening round. Not every speaker needs to speak in every round.`;
}

/**
 * Builds the prompt for a single speaker's turn
 */
function buildSpeakerPrompt(archetype, seedPrompt, conversationHistory, thesis) {
  const historyText = conversationHistory.map(turn =>
    `[${turn.speaker}]: ${turn.content}`
  ).join('\n\n');

  return `ORIGINAL THESIS UNDER DISCUSSION:
"${thesis}"

CONVERSATION SO FAR:
${historyText || '(Opening round — you are among the first to speak.)'}

YOUR ASSIGNMENT FOR THIS TURN:
${seedPrompt}

Respond in character. Address the thesis and/or other speakers' arguments directly. Be substantive, specific, and intellectually honest. Do NOT summarize what others have said — advance the conversation.`;
}

/**
 * Builds the continuation prompt — mediator decides next round
 */
function buildContinuationPrompt(thesis, conversationHistory, roundNumber, totalRounds) {
  const historyText = conversationHistory.map(turn =>
    `[${turn.speaker} (${turn.title})]: ${turn.content}`
  ).join('\n\n');

  return `THESIS: "${thesis}"

CONVERSATION HISTORY (Round ${roundNumber}/${totalRounds}):
${historyText}

Analyze the conversation dynamics. Consider:
- Which arguments need challenging?
- Is any speaker being too agreeable or repetitive?
- Are there unexplored angles?
- Should the conversation deepen on a thread or pivot?

${roundNumber >= totalRounds - 1 ? 'This is the FINAL round. Choose speakers who can deliver concluding arguments or crystallize key tensions.' : ''}

Respond with JSON:
{
  "next_speakers": [
    {
      "speaker_id": "alyosha|ivan|genealogist|cynic|user_proxy",
      "directive": "What this speaker should address/respond to in this round",
      "respond_to": "Name of speaker they should primarily engage with, or 'thesis' for the original input"
    }
  ],
  "mediator_observation": "Brief observation about the state of the dialogue"
}

Select 2-4 speakers for this round.`;
}

/**
 * Builds the synthesis/conclusion prompt
 */
function buildSynthesisPrompt(thesis, conversationHistory) {
  const historyText = conversationHistory.map(turn =>
    `[${turn.speaker} (${turn.title})]: ${turn.content}`
  ).join('\n\n');

  return `THESIS: "${thesis}"

FULL CONVERSATION:
${historyText}

Produce a dialectical synthesis. This is NOT a bland summary or a false consensus. Your synthesis must:

1. IDENTIFY the core tensions that remained genuinely unresolved
2. MAP where authentic convergence occurred (if any) — and distinguish it from mere politeness
3. SURFACE insights that emerged from the collision of perspectives — things no single speaker would have reached alone
4. NAME what was left unsaid or unexplored
5. OFFER a provisional conclusion that honestly represents the state of the inquiry

Structure your response as:

## Dialectical Synthesis

### Core Tensions
[The fundamental disagreements that persisted]

### Points of Convergence
[Where genuine agreement emerged, and why it matters]

### Emergent Insights
[Novel understanding that arose from the dialogue itself]

### Blind Spots & Unexplored Territory
[What the conversation missed or avoided]

### Provisional Conclusion
[An honest, non-sycophantic assessment of where the inquiry stands]

Be rigorous. Do not flatten genuine disagreement into false harmony.`;
}

// ===== MAIN ENGINE =====

export async function startDialectic(thesis, rounds, apiKey) {
  const client = getClient(apiKey);
  const conversationHistory = [];
  const allRounds = [];

  // Step 1: Mediator distributes the thesis
  const distributionResponse = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2000,
    system: MEDIATOR_SYSTEM,
    messages: [{ role: 'user', content: buildDistributionPrompt(thesis) }]
  });

  let distribution;
  try {
    const rawText = distributionResponse.content[0].text;
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    distribution = JSON.parse(jsonMatch[0]);
  } catch (e) {
    throw new Error('Mediator failed to produce valid distribution: ' + e.message);
  }

  // Step 2: Opening round — each assigned speaker responds
  const openingTurns = [];
  for (const assignment of distribution.opening_assignments) {
    const archetype = ARCHETYPES[assignment.speaker_id];
    if (!archetype) continue;

    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1500,
      system: archetype.system,
      messages: [{
        role: 'user',
        content: buildSpeakerPrompt(archetype, assignment.seed_prompt, conversationHistory, thesis)
      }]
    });

    const turn = {
      speaker: archetype.name,
      speaker_id: archetype.id,
      title: archetype.title,
      color: archetype.color,
      icon: archetype.icon,
      content: response.content[0].text,
      round: 1,
      stance: assignment.stance
    };

    conversationHistory.push(turn);
    openingTurns.push(turn);
  }

  allRounds.push({
    round: 1,
    mediator_note: distribution.mediator_note,
    turns: openingTurns
  });

  // Step 3: Subsequent rounds
  for (let r = 2; r <= rounds; r++) {
    const continuationResponse = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1500,
      system: MEDIATOR_SYSTEM,
      messages: [{ role: 'user', content: buildContinuationPrompt(thesis, conversationHistory, r, rounds) }]
    });

    let continuation;
    try {
      const rawText = continuationResponse.content[0].text;
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      continuation = JSON.parse(jsonMatch[0]);
    } catch (e) {
      // Fallback: rotate through speakers
      continuation = {
        next_speakers: [
          { speaker_id: Object.keys(ARCHETYPES)[r % 5], directive: 'Continue the discussion.', respond_to: 'thesis' }
        ],
        mediator_observation: 'Continuing discussion.'
      };
    }

    const roundTurns = [];
    for (const assignment of continuation.next_speakers) {
      const archetype = ARCHETYPES[assignment.speaker_id];
      if (!archetype) continue;

      const response = await client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1500,
        system: archetype.system,
        messages: [{
          role: 'user',
          content: buildSpeakerPrompt(
            archetype,
            assignment.directive,
            conversationHistory,
            thesis
          )
        }]
      });

      const turn = {
        speaker: archetype.name,
        speaker_id: archetype.id,
        title: archetype.title,
        color: archetype.color,
        icon: archetype.icon,
        content: response.content[0].text,
        round: r,
        respond_to: assignment.respond_to
      };

      conversationHistory.push(turn);
      roundTurns.push(turn);
    }

    allRounds.push({
      round: r,
      mediator_observation: continuation.mediator_observation,
      turns: roundTurns
    });
  }

  return {
    thesis,
    rounds: allRounds,
    totalRounds: rounds,
    speakers: Object.values(ARCHETYPES).map(a => ({
      id: a.id, name: a.name, title: a.title, color: a.color, icon: a.icon
    })),
    generatedAt: new Date().toISOString()
  };
}

export async function synthesizeDialectic(thesis, conversationHistory, apiKey) {
  const client = getClient(apiKey);

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4000,
    system: MEDIATOR_SYSTEM,
    messages: [{ role: 'user', content: buildSynthesisPrompt(thesis, conversationHistory) }]
  });

  return {
    synthesis: response.content[0].text,
    generatedAt: new Date().toISOString()
  };
}

export function getArchetypes() {
  return Object.values(ARCHETYPES).map(a => ({
    id: a.id, name: a.name, title: a.title, color: a.color, icon: a.icon,
    description: a.system.split('\n\n')[0]
  }));
}
