import { callHuggingFace } from './lib/huggingface.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { messages } = req.body;

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'Messages array is required' });
  }

  if (!process.env.HF_API_KEY) {
    return res.status(500).json({ error: 'HF_API_KEY not configured' });
  }

  const conversationText = messages
    .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
    .join('\n\n');

  const prompt = `You are a summarization agent. Extract key information from the following conversation into a structured JSON object.

Extract:
1. "topic": the main topic or subject discussed
2. "key_facts": an array of important factual statements made
3. "decisions": an array of decisions or conclusions reached
4. "preferences": an array of stated preferences or opinions (if any)
5. "summary": a 2-3 sentence overall summary

Return ONLY valid JSON with no markdown formatting, no code blocks, no extra text.

Conversation:
${conversationText}`;

  try {
    const text = await callHuggingFace([{ role: 'user', content: prompt }]);

    let cleaned = text;
    if (cleaned.includes('```')) {
      cleaned = cleaned.replace(/```json?\s*/g, '').replace(/```\s*/g, '');
    }
    cleaned = cleaned.trim();

    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      cleaned = cleaned.slice(firstBrace, lastBrace + 1);
    }

    const raw = JSON.parse(cleaned);

    const summary = {
      topic: typeof raw.topic === 'string' ? raw.topic : '',
      key_facts: Array.isArray(raw.key_facts) ? raw.key_facts : [],
      decisions: Array.isArray(raw.decisions) ? raw.decisions : [],
      preferences: Array.isArray(raw.preferences) ? raw.preferences : [],
      summary: typeof raw.summary === 'string' ? raw.summary : '',
    };

    return res.status(200).json({ summary });
  } catch (err) {
    console.error('Summarize error:', err);
    const isWarming = err.message && err.message.includes('warming up');
    if (isWarming) {
      return res.status(503).json({ error: err.message });
    }
    return res.status(500).json({ error: 'Failed to summarize conversation' });
  }
}
