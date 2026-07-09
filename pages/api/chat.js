const MODEL_SYSTEM_PROMPTS = {
  a: 'You are Model A, part of the FilVault Bridge demo. Keep answers short and direct.',
  b: 'You are Model B, part of the FilVault Bridge demo. Keep answers short and direct.',
};

const GROQ_MODEL = 'llama-3.3-70b-versatile';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { messages, model = 'a', contextPrompt = '' } = req.body;

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'Messages array is required' });
  }

  let systemPrompt = MODEL_SYSTEM_PROMPTS[model] || MODEL_SYSTEM_PROMPTS.a;
  const contextStr = typeof contextPrompt === 'string' ? contextPrompt : JSON.stringify(contextPrompt);

  if (contextStr) {
    systemPrompt += `\n\n--- LOADED CONTEXT (from Filecoin) ---\n${contextStr}\n--- END CONTEXT ---\n\nUse the loaded context above to answer the user's questions. It contains key facts, decisions, and preferences saved from a previous conversation.`;
  }

  if (model === 'b') {
    return handleGroq(systemPrompt, messages, res);
  }
  return handleGemini(systemPrompt, messages, res);
}

async function handleGroq(systemPrompt, messages, res) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'GROQ_API_KEY not configured' });
  }

  const groqMessages = [{ role: 'system', content: systemPrompt }];
  for (const msg of messages) {
    groqMessages.push({ role: msg.role, content: msg.content });
  }

  const https = require('https');
  const dns = require('dns');

  try {
    const body = JSON.stringify({
      model: GROQ_MODEL,
      messages: groqMessages,
      max_tokens: 1024,
    });

    const { address } = await dns.promises.lookup('api.groq.com', { family: 4 });

    const text = await new Promise((resolve, reject) => {
      const req = https.request({
        hostname: address,
        path: '/openai/v1/chat/completions',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'Content-Length': Buffer.byteLength(body),
          Host: 'api.groq.com',
        },
        timeout: 20000,
        rejectUnauthorized: false,
      }, (resp) => {
        let data = '';
        resp.on('data', (chunk) => { data += chunk; });
        resp.on('end', () => {
          if (!resp.statusCode || resp.statusCode >= 400) {
            return reject(new Error(`Groq API error ${resp.statusCode}: ${data.slice(0, 200)}`));
          }
          try {
            const result = JSON.parse(data);
            resolve(result?.choices?.[0]?.message?.content || '');
          } catch (e) {
            reject(new Error('Invalid JSON from Groq'));
          }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Groq request timed out')); });
      req.write(body);
      req.end();
    });

    return res.status(200).json({ message: text });
  } catch (err) {
    console.error('Groq error:', err);
    return res.status(500).json({ error: 'Failed to get response from Groq' });
  }
}

async function handleGemini(systemPrompt, messages, res) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'GEMINI_API_KEY not configured' });
  }

  const geminiContents = [{ role: 'user', parts: [{ text: systemPrompt }] }];
  for (const msg of messages) {
    geminiContents.push({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: msg.content }],
    });
  }

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: geminiContents }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Gemini API error ${response.status}: ${errText.slice(0, 200)}`);
    }

    const result = await response.json();
    const text = result?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    return res.status(200).json({ message: text });
  } catch (err) {
    console.error('Gemini error:', err);
    return res.status(500).json({ error: 'Failed to get response from Gemini' });
  }
}
