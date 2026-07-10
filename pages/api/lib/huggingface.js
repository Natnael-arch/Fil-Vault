const HF_MODEL = 'meta-llama/Llama-3.1-8B-Instruct';

const https = require('https');
const dns = require('dns');

export async function callHuggingFace(messages) {
  const apiKey = process.env.HF_API_KEY;
  if (!apiKey) {
    throw new Error('HF_API_KEY not configured');
  }

  const body = JSON.stringify({
    model: HF_MODEL,
    messages,
    max_tokens: 1024,
  });

  const { address } = await dns.promises.lookup('router.huggingface.co', { family: 4 });

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: address,
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'Content-Length': Buffer.byteLength(body),
        Host: 'router.huggingface.co',
      },
      timeout: 30000,
      rejectUnauthorized: false,
    }, (resp) => {
      let data = '';
      resp.on('data', (chunk) => { data += chunk; });
      resp.on('end', () => {
        if (resp.statusCode === 503) {
          try {
            const errBody = JSON.parse(data);
            const estimated = errBody.estimated_time;
            const msg = estimated
              ? `Model is warming up — try again in about ${Math.ceil(estimated)} seconds`
              : 'Model is warming up, please try again in a few seconds';
            return reject(new Error(msg));
          } catch {
            return reject(new Error('Model is warming up, please try again in a few seconds'));
          }
        }
        if (!resp.statusCode || resp.statusCode >= 400) {
          return reject(new Error(`HuggingFace API error ${resp.statusCode}: ${data.slice(0, 200)}`));
        }
        try {
          const result = JSON.parse(data);
          resolve(result?.choices?.[0]?.message?.content || '');
        } catch (e) {
          reject(new Error('Invalid JSON from HuggingFace'));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('HuggingFace request timed out')); });
    req.write(body);
    req.end();
  });
}
