import crypto from 'crypto';
import https from 'https';
import dns from 'dns';

const memoryStore = new Map();
let fallbackCounter = 0;

function makeMockCid(data) {
  const hash = crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex');
  return `filvault-${hash.slice(0, 16)}-${++fallbackCounter}`;
}

async function httpsGetJson(hostname, path) {
  const { address } = await dns.promises.lookup(hostname, { family: 4 });
  return new Promise((resolve, reject) => {
    const opts = { hostname: address, path, method: 'GET', timeout: 15000, rejectUnauthorized: false, headers: { Host: hostname } };
    const req = https.request(opts, (resp) => {
      let data = '';
      resp.on('data', (c) => { data += c; });
      resp.on('end', () => {
        if (!resp.statusCode || resp.statusCode >= 400) return reject(new Error(`HTTP ${resp.statusCode}`));
        try { resolve(JSON.parse(data)); } catch { reject(new Error('Invalid JSON')); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timed out')); });
    req.end();
  });
}

async function lighthouseUpload(data) {
  const apiKey = process.env.LIGHTHOUSE_API_KEY;
  if (!apiKey) return null;

  const body = JSON.stringify(data, null, 2);
  const boundary = `----Filvault${Date.now()}`;
  const parts = [
    `--${boundary}`,
    'Content-Disposition: form-data; name="file"; filename="memory.json"',
    'Content-Type: application/json',
    '',
    body,
    `--${boundary}--`,
  ];
  const multipart = parts.join('\r\n');

  const resp = await fetch('https://node.lighthouse.storage/api/v0/add', {
    method: 'POST',
    headers: {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      Authorization: `Bearer ${apiKey}`,
    },
    body: multipart,
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Lighthouse upload failed: ${resp.status} ${text.slice(0, 200)}`);
  }

  const result = await resp.json();
  return { cid: result.Hash, size: result.Size };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { action, data, cid } = req.body;

  if (action === 'upload') {
    if (!data) return res.status(400).json({ error: 'Data is required for upload' });
    return handleUpload(data, res);
  }

  if (action === 'retrieve') {
    if (!cid) return res.status(400).json({ error: 'CID is required for retrieve' });
    return handleRetrieve(cid, res);
  }

  return res.status(400).json({ error: 'Action must be "upload" or "retrieve"' });
}

async function handleUpload(data, res) {
  // Try real Lighthouse when the key is set (works on Vercel)
  if (process.env.LIGHTHOUSE_API_KEY) {
    try {
      const result = await lighthouseUpload(data);
      if (result) {
        return res.status(200).json(result);
      }
    } catch (err) {
      console.error('Lighthouse upload failed, falling back:', err.message);
    }
  }

  // Fallback: in-memory mock
  const mockCid = makeMockCid(data);
  memoryStore.set(mockCid, data);
  return res.status(200).json({
    cid: mockCid,
    size: JSON.stringify(data).length,
    note: process.env.LIGHTHOUSE_API_KEY
      ? 'In-memory fallback (Lighthouse upload failed)'
      : 'In-memory fallback (set LIGHTHOUSE_API_KEY for real Filecoin storage)',
  });
}

function factCount(data) {
  const src = data.key_facts ? data : data.summary || data;
  return (src.key_facts?.length || 0) + (src.decisions?.length || 0) + (src.preferences?.length || 0);
}

async function handleRetrieve(cid, res) {
  // Real Lighthouse CID — fetch from gateway
  if (!cid.startsWith('filvault-')) {
    try {
      const data = await httpsGetJson('gateway.lighthouse.storage', `/ipfs/${cid}`);
      return res.status(200).json({ data, factCount: factCount(data) });
    } catch (err) {
      console.error('Gateway retrieve error:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  // Mock CID — check in-memory store
  const data = memoryStore.get(cid);
  if (!data) return res.status(404).json({ error: 'Data not found in fallback store' });
  return res.status(200).json({ data, factCount: factCount(data) });
}
