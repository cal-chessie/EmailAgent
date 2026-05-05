/**
 * LLM integration — OpenAI wrapper (Anthropic-compatible interface)
 */
import 'dotenv/config';

export async function analyzeWithLLM(prompt, model = 'gpt-4o') {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY not set — add it to .env');
  }

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI error: ${res.status} — ${err}`);
  }

  const data = await res.json();
  return data.choices[0].message.content;
}
