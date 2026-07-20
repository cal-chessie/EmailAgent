/**
 * Multi-turn Qualification Agent
 * 
 * If the initial email doesn't have enough info to book,
 * sends follow-up questions via email and processes replies.
 * Maintains state per conversation thread.
 */

import { sendEmail } from '../tools/pollEmail.js';
import { getThreadMemory, saveThreadMemory } from '../memory/threadMemory.js';
import { info, warn } from '../tools/logger.js';

export const REQUIRED_FIELDS = ['name', 'type', 'bill', 'timeline'];

/**
 * Single-turn qualification — extracts data from one email, no follow-ups.
 * Used by the main agent loop.
 */
export async function qualifyLead(email) {
  const { analyzeWithLLM } = await import('../tools/llm.js');

  const subject = email.subject || '';
  const body = email.body || '';

  const prompt = `
You are a solar installation sales agent. Extract key lead info from this inbound enquiry.

Reply with JSON (no markdown):
{
  "name": "extracted name or 'Unknown'",
  "phone": "extracted phone or null",
  "type": "domestic" | "commercial" | "unknown",
  "property": "brief property description or null",
  "bill": "monthly electricity bill in € or null",
  "timeline": "eager" | "considering" | "browsing" | "unknown",
  "notes": "any other relevant context"
}

Email:
From: ${email.from}
Subject: ${subject}
Body: ${body}
`.trim();

  try {
    const raw = await analyzeWithLLM(prompt);
    const cleaned = raw.replace(/^```json\n?|^```\n?/gm, '').trim();
    return JSON.parse(cleaned);
  } catch (e) {
    return {
      name: email.from.split('@')[0],
      phone: null,
      type: 'unknown',
      property: null,
      bill: null,
      timeline: 'unknown',
      notes: raw,
    };
  }
}

const QUESTION_MAP = {
  name: 'What is your full name?',
  type: 'Is this a domestic or commercial property?',
  bill: 'What is your approximate monthly electricity bill (€)?',
  timeline: 'When are you looking to install — within 3 months, 3–6 months, or later?',
  phone: 'Could you share your phone number for a WhatsApp reminder?',
};

export async function qualifyLeadMultiTurn(email) {
  const threadId = email.threadId || email.id;
  let memory = getThreadMemory(threadId);

  // First contact — create new thread memory
  if (memory.status === 'new') {
    memory = {
      threadId,
      emailFrom: email.from,
      emailSubject: email.subject,
      status: 'in_progress',
      data: {},
      questionsAsked: [],
      nextQuestion: null,
      createdAt: new Date().toISOString(),
    };

    // Extract what we can from the initial email
    const { analyzeWithLLM } = await import('../tools/llm.js');
    const extracted = await extractFromEmail(email, null);

    memory.data = extracted;
    memory.nextQuestion = getNextMissingField(extracted);

    saveThreadMemory(threadId, memory);
    info('QualificationMT', `New thread started for ${email.from}`, { nextQuestion: memory.nextQuestion });

    // If we have enough to book, skip to booking
    if (isReadyToBook(extracted)) {
      memory.status = 'ready';
      saveThreadMemory(threadId, memory);
      return { ...extracted, status: 'ready' };
    }

    // Ask first question
    if (memory.nextQuestion) {
      await askNextQuestion(email, memory.nextQuestion, memory.data);
      memory.questionsAsked.push(memory.nextQuestion);
      memory.nextQuestion = null; // will be recalculated after reply
      saveThreadMemory(threadId, memory);
    }

    return { ...memory.data, status: 'needs_info', nextQuestion: memory.questionsAsked[memory.questionsAsked.length - 1] };
  }

  // Subsequent reply — update memory
  if (memory.status === 'in_progress') {
    // Extract new info from this reply
    const { analyzeWithLLM } = await import('../tools/llm.js');
    const newData = await extractFromEmail(email, memory.data);
    
    // Merge new data into memory
    memory.data = { ...memory.data, ...newData };
    memory.nextQuestion = getNextMissingField(memory.data);

    saveThreadMemory(threadId, memory);
    info('QualificationMT', `Updated thread for ${email.from}`, { nextQuestion: memory.nextQuestion });

    if (isReadyToBook(memory.data)) {
      memory.status = 'ready';
      saveThreadMemory(threadId, memory);
      return { ...memory.data, status: 'ready' };
    }

    if (memory.nextQuestion) {
      await askNextQuestion(email, memory.nextQuestion, memory.data);
      memory.questionsAsked.push(memory.nextQuestion);
      memory.nextQuestion = null;
      saveThreadMemory(threadId, memory);
    }

    return { ...memory.data, status: 'needs_info' };
  }

  // Already ready — return as-is
  if (memory.status === 'ready') {
    return { ...memory.data, status: 'ready' };
  }

  return { ...memory.data, status: 'unknown' };
}

async function extractFromEmail(email, existingData) {
  const { analyzeWithLLM } = await import('../tools/llm.js');

  const systemPrompt = `You are a solar installation sales agent extracting lead information.
Fields already known: ${JSON.stringify(existingData || {})}
Reply with JSON only (no markdown):
{
  "name": "extracted or null",
  "phone": "extracted or null",
  "type": "domestic" | "commercial" | null",
  "property": "brief description or null",
  "bill": "monthly electricity bill in € or null",
  "timeline": "eager" | "considering" | "browsing" | null",
  "notes": "any other relevant info"
}
Only fill in fields you are confident about. Null fields are OK.`;

  let prompt = `From: ${email.from}\nSubject: ${email.subject}\nBody: ${email.body}`;

  // Add context from conversation history
  if (existingData && Object.keys(existingData).length > 0) {
    prompt = `Previous data known: ${JSON.stringify(existingData)}\n\nNew email:\n${prompt}`;
  }

  try {
    const raw = await analyzeWithLLM(`${systemPrompt}\n\n${prompt}`);
    const cleaned = raw.replace(/^```json\n?|^```\n?/gm, '').trim();
    return JSON.parse(cleaned);
  } catch (err) {
    warn('QualificationMT', 'LLM parse failed', { error: err.message });
    return existingData || {};
  }
}

function getNextMissingField(data) {
  // Priority order for questions
  const priority = ['type', 'bill', 'timeline', 'phone', 'name'];
  for (const field of priority) {
    if (!data[field]) return field;
  }
  return null;
}

function isReadyToBook(data) {
  return data.name && data.type && data.bill && data.timeline;
}

async function askNextQuestion(email, field, currentData) {
  const question = QUESTION_MAP[field] || `Can you tell me more about your ${field}?`;
  const name = currentData.name || 'there';

  const body = `
Hi ${name},

Thanks for your solar enquiry! I'm working on getting you a quote and just need one piece of information:

**${question}**

Just reply to this email and I'll take it from there.

—
The Solar Team
  `.trim();

  await sendEmail(email.from, 'Re: Your Solar Enquiry', body);
  info('QualificationMT', `Asked follow-up question: ${field}`, { to: email.from });
}