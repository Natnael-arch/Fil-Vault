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
  const mockCid = makeMockCid(data);
  memoryStore.set(mockCid, data);
  return res.status(200).json({
    cid: mockCid,
    size: JSON.stringify(data).length,
    note: 'In-memory fallback (Lighthouse API unreachable from this network — set key on deployment)',
  });
}

async function handleRetrieve(cid, res) {
  // Real Lighthouse CIDs start with "bafy" — try the gateway
  if (!cid.startsWith('filvault-')) {
    try {
      const data = await httpsGetJson('gateway.lighthouse.storage', `/ipfs/${cid}`);
      const factCount = (data.key_facts?.length || 0) + (data.decisions?.length || 0) + (data.preferences?.length || 0);
      return res.status(200).json({ data, factCount });
    } catch (err) {
      console.error('Gateway retrieve error:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  const data = memoryStore.get(cid);
  if (!data) return res.status(404).json({ error: 'Data not found in fallback store' });
  const factCount = (data.key_facts?.length || 0) + (data.decisions?.length || 0) + (data.preferences?.length || 0);
  return res.status(200).json({ data, factCount });
}
