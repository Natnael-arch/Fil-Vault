import crypto from 'crypto';
import https from 'https';
import dns from 'dns';
import { ObjectManager } from '@filebase/sdk';

const memoryStore = new Map();
let fallbackCounter = 0;

let _objectManager = null;

function getObjectManager() {
  if (_objectManager) return _objectManager;
  const key = process.env.FILEBASE_ACCESS_KEY;
  const secret = process.env.FILEBASE_SECRET_KEY;
  const bucket = process.env.FILEBASE_BUCKET;
  if (!key || !secret || !bucket) {
    return null;
  }
  _objectManager = new ObjectManager(key, secret, { bucket });
  return _objectManager;
}

function makeMockCid(data) {
  const hash = crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex');
  return `filvault-${hash.slice(0, 16)}-${++fallbackCounter}`;
}

async function httpsGetJson(hostname, path) {
  const { address } = await dns.promises.lookup(hostname, { family: 4 });
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: address,
      path,
      method: 'GET',
      timeout: 15000,
      rejectUnauthorized: false,
      headers: { Host: hostname },
    };
    const req = https.request(opts, (resp) => {
      let data = '';
      resp.on('data', (c) => { data += c; });
      resp.on('end', () => {
        if (!resp.statusCode || resp.statusCode >= 400) {
          return reject(new Error(`HTTP ${resp.statusCode}`));
        }
        try { resolve(JSON.parse(data)); } catch { reject(new Error('Invalid JSON')); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timed out')); });
    req.end();
  });
}

async function filebaseUpload(data) {
  const manager = getObjectManager();
  if (!manager) return null;

  const jsonString = JSON.stringify(data);
  const key = `mem-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

  const result = await manager.upload(key, Buffer.from(jsonString));
  const cid = result.cid;

  // Also store with CID as key for S3-based retrieval fallback
  try {
    await manager.upload(cid, Buffer.from(jsonString));
    await manager.delete(key);
  } catch (storeErr) {
    console.warn('[filecoin] Failed to store CID-keyed copy:', storeErr.message);
  }

  return { cid, size: jsonString.length };
}

async function filebaseRetrieve(cid) {
  const manager = getObjectManager();

  // Attempt S3 download by CID key first
  if (manager) {
    try {
      const stream = await manager.download(cid);
      const chunks = [];
      for await (const chunk of stream) {
        chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
      }
      const buffer = Buffer.concat(chunks);
      return JSON.parse(buffer.toString('utf-8'));
    } catch (s3Err) {
      console.warn('[filecoin] S3 download failed, trying gateway:', s3Err.message);
    }
  }

  // Fall back to IPFS gateway (DNS-resolving HTTPS GET)
  const data = await httpsGetJson('ipfs.filebase.io', `/ipfs/${cid}`);
  return data;
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
  if (process.env.FILEBASE_ACCESS_KEY) {
    try {
      const result = await filebaseUpload(data);
      if (result) {
        return res.status(200).json(result);
      }
    } catch (err) {
      console.error('[filecoin] Filebase upload failed:', err);
    }
  }

  const mockCid = makeMockCid(data);
  memoryStore.set(mockCid, data);
  return res.status(200).json({
    cid: mockCid,
    size: JSON.stringify(data).length,
    note: process.env.FILEBASE_ACCESS_KEY
      ? 'In-memory fallback (Filebase upload failed)'
      : 'In-memory fallback (set FILEBASE_ACCESS_KEY, FILEBASE_SECRET_KEY, FILEBASE_BUCKET for real IPFS storage)',
  });
}

function factCount(data) {
  const src = data.key_facts ? data : data.summary || data;
  return (src.key_facts?.length || 0) + (src.decisions?.length || 0) + (src.preferences?.length || 0);
}

async function handleRetrieve(cid, res) {
  if (!cid.startsWith('filvault-')) {
    try {
      const data = await filebaseRetrieve(cid);
      return res.status(200).json({ data, factCount: factCount(data) });
    } catch (err) {
      console.error('[filecoin] Retrieve error:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  const data = memoryStore.get(cid);
  if (!data) return res.status(404).json({ error: 'Data not found in fallback store' });
  return res.status(200).json({ data, factCount: factCount(data) });
}
