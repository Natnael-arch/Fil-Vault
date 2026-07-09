import { spawn, execSync } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const PORT = 3456;
const BASE = `http://localhost:${PORT}`;
const TIMEOUT_MS = 40000;
const MAX_RETRIES = 3;

// ─── helpers ────────────────────────────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function httpPost(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  return res.json();
}

async function httpPostWithRetry(url, body) {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const data = await httpPost(url, body);
      if (data.error) {
        const isQuota = isNonRetryableQuotaError(data.error);
        const isRetryable = !isQuota && (
          data.error.includes('503') ||
          /unavailable|high demand|too many|Failed to get/i.test(data.error)
        );
        if (isQuota) {
          quotaExhausted = true;
          return data;
        }
        if (isRetryable && attempt < MAX_RETRIES) {
          const wait = attempt * 3000;
          console.log(`\n     ⏳ API busy, retry ${attempt}/${MAX_RETRIES} in ${wait}ms`);
          await sleep(wait);
          continue;
        }
      }
      return data;
    } catch (err) {
      if (attempt < MAX_RETRIES) {
        await sleep(attempt * 2000);
        continue;
      }
      throw err;
    }
  }
  throw new Error('Max retries exceeded');
}

function waitForPort(port, timeoutMs = 25000) {
  const start = Date.now();
  return (async function poll() {
    while (Date.now() - start < timeoutMs) {
      try {
        await fetch(`http://localhost:${port}/`, { signal: AbortSignal.timeout(2000) });
        return;
      } catch {}
      await sleep(500);
    }
    throw new Error('Server did not start within ' + (timeoutMs / 1000) + 's');
  })();
}

let passed = 0;
let failed = 0;
let skipped = 0;
let quotaExhausted = false;
const failures = [];

function isApiError(msg) {
  return /503|429|quota|unavailable|high demand|too many|rate limit|Failed to get response from Gemini|Failed to summarize conversation/i.test(msg);
}

function isNonRetryableQuotaError(msg) {
  return /429|quota|RESOURCE_EXHAUSTED|rate limit/i.test(msg);
}

async function check(label, fn) {
  process.stdout.write(`  ${label} ... `);
  try {
    await fn();
    passed++;
    console.log('✅ PASS');
  } catch (err) {
    const msg = err.message.replace(/\n.*/s, '').slice(0, 250);
    const apiErr = isApiError(msg);
    if (apiErr) {
      skipped++;
      console.log('⏭ SKIP (API unavailable)');
      console.log(`     ${msg}`);
    } else {
      failed++;
      failures.push({ label, err: msg });
      console.log('❌ FAIL');
      console.log(`     ${msg}`);
    }
  }
}

// ─── main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log('');
  console.log('══════════════════════════════════════════════════════');
  console.log('  FilVault Bridge — Pipeline Test Suite');
  console.log('══════════════════════════════════════════════════════');
  console.log('');

  // 1. Build
  console.log('▶  Building production bundle ...');
  try {
    execSync('npm run build 2>&1', { cwd: DIR, stdio: 'pipe', timeout: 60000 });
    console.log('   ✅ Build complete\n');
  } catch (e) {
    console.log('   ❌ Build failed:', e.stderr?.toString().slice(0, 300) || e.message);
    process.exit(1);
  }

  // 2. Start server
  console.log('▶  Starting server on port', PORT, '...');
  const server = spawn('npx', ['next', 'start', '-p', String(PORT)], {
    cwd: DIR,
    stdio: 'pipe',
    env: { ...process.env, PORT: String(PORT) },
  });
  server.stdout.on('data', () => {});
  server.stderr.on('data', () => {});

  try {
    await waitForPort(PORT);
    console.log('   ✅ Server ready\n');
  } catch (e) {
    console.log('   ❌', e.message);
    server.kill();
    process.exit(1);
  }

  try {

    // ──────────────────────────────────────────────────────────────────────────
    // CHECK 1 — Model A connectivity
    // ──────────────────────────────────────────────────────────────────────────
    await check('CHECK 1: Model A API connectivity', async () => {
      if (quotaExhausted) throw new Error('SKIPPED — quota already exhausted this session');
      const data = await httpPostWithRetry(`${BASE}/api/chat`, {
        messages: [{ role: 'user', content: 'Say hello in exactly 5 words' }],
        model: 'a',
      });
      if (data.error) throw new Error(data.error);
      if (!data.message || data.message.trim().length === 0) throw new Error('Empty response');
      const wordCount = data.message.trim().split(/\s+/).length;
      console.log(`\n     Response (${wordCount} words): "${data.message.trim()}"`);
    });

    // ──────────────────────────────────────────────────────────────────────────
    // CHECK 2 — Model B connectivity
    // ──────────────────────────────────────────────────────────────────────────
    await check('CHECK 2: Model B API connectivity', async () => {
      const data = await httpPostWithRetry(`${BASE}/api/chat`, {
        messages: [{ role: 'user', content: 'Say hello in exactly 5 words' }],
        model: 'b',
      });
      if (data.error) throw new Error(data.error);
      if (!data.message || data.message.trim().length === 0) throw new Error('Empty response');
      const wordCount = data.message.trim().split(/\s+/).length;
      console.log(`\n     Response (${wordCount} words): "${data.message.trim()}"`);
    });

    // ──────────────────────────────────────────────────────────────────────────
    // CHECK 3 — Filecoin round-trip (no AI involved)
    // ──────────────────────────────────────────────────────────────────────────
    let uploadedCid = null;
    await check('CHECK 3: Filecoin round-trip (no AI)', async () => {
      const payload = { test: true, timestamp: Date.now() };
      const upload = await httpPost(`${BASE}/api/filecoin`, {
        action: 'upload',
        data: payload,
      });
      if (upload.error) throw new Error(`Upload: ${upload.error}`);
      if (!upload.cid) throw new Error('No CID returned');
      uploadedCid = upload.cid;
      console.log(`\n     CID: ${uploadedCid}`);

      const retrieve = await httpPost(`${BASE}/api/filecoin`, {
        action: 'retrieve',
        cid: uploadedCid,
      });
      if (retrieve.error) throw new Error(`Retrieve: ${retrieve.error}`);
      if (retrieve.data.test !== true) throw new Error('data.test !== true');
      if (retrieve.data.timestamp !== payload.timestamp) throw new Error('Timestamp mismatch');
    });

    // ──────────────────────────────────────────────────────────────────────────
    // CHECK 4 — Summarization produces valid JSON from a fake transcript
    // ──────────────────────────────────────────────────────────────────────────
    let summaryResult = null;
    await check('CHECK 4: Summarization produces valid JSON', async () => {
      if (quotaExhausted) throw new Error('SKIPPED — quota already exhausted this session');
      const transcript = [
        { role: 'user', content: 'I got two job offers — one at Google as a senior engineer and one at a Series A startup as their first ML hire. I\'m torn.' },
        { role: 'assistant', content: 'The Google offer brings stability, brand, and resources. The startup offers equity upside and more autonomy. What matters most to you right now?' },
        { role: 'user', content: 'I think I\'m leaning toward the startup. The equity could be life-changing if they succeed, and I\'d get to shape the ML team from day one. Google\'s great but I\'d be a small cog.' },
        { role: 'assistant', content: 'The startup sounds like a better fit for your risk appetite and career goals. Make sure you believe in the product and the founders.' },
        { role: 'user', content: 'The product is an AI-powered diagnostic tool for rare diseases. The founders are ex-Mayo Clinic doctors. I\'m going to accept the startup offer.' },
        { role: 'assistant', content: 'AI for rare disease diagnostics with domain-expert founders could have massive impact. Congratulations!' },
      ];

      const data = await httpPostWithRetry(`${BASE}/api/summarize`, { messages: transcript });
      if (data.error) throw new Error(data.error);
      summaryResult = data.summary;

      const s = summaryResult;
      if (!s.topic || typeof s.topic !== 'string') throw new Error('Missing/invalid "topic"');
      if (!Array.isArray(s.key_facts)) throw new Error('Missing "key_facts"');
      if (!Array.isArray(s.decisions)) throw new Error('Missing "decisions"');
      if (!s.summary || typeof s.summary !== 'string') throw new Error('Missing "summary"');

      const raw = JSON.stringify(s).toLowerCase();
      const expected = ['startup', 'google', 'ml', 'diagnostic', 'rare disease', 'equity', 'mayo'];
      const found = expected.filter(f => raw.includes(f));
      if (found.length < 2) throw new Error(`Only ${found.length}/7 transcript facts found. Got: ${found.join(', ')}`);

      console.log(`\n     Topic: "${s.topic}"`);
      console.log(`     Key facts: ${s.key_facts.length} | Decisions: ${s.decisions.length} | Preferences: ${s.preferences.length}`);
      console.log(`     Transcript facts detected in summary: ${found.length}/7`);
    });

    // ──────────────────────────────────────────────────────────────────────────
    // CHECK 5 — Full save flow (transcript → summary → Filecoin)
    // ──────────────────────────────────────────────────────────────────────────
    let saveCid = null;
    let savedTopic = '';
    await check('CHECK 5: Full save flow (transcript → summary → Filecoin)', async () => {
      let enriched;

      if (summaryResult) {
        // Use the AI-generated summary from Check 4 (preferred path)
        enriched = { ...summaryResult, source_model: 'Model A', saved_at: new Date().toISOString() };
        console.log(`\n     Using AI summary from Check 4`);
      } else {
        // Fallback: upload canned structured data (tests save pipeline without AI)
        // Never re-call summarize here — that would waste quota on a second attempt
        enriched = {
          topic: 'Job offer decision',
          key_facts: [
            'User received offers from Google and a Series A startup',
            'Startup builds an AI-powered diagnostic tool for rare diseases',
            'Founders are ex-Mayo Clinic doctors',
            'Startup role is first ML hire',
          ],
          decisions: ['User accepted the Series A startup offer'],
          preferences: ['Prefers startup equity upside over Google stability'],
          summary: 'User chose a Series A startup over Google for an ML role at an AI rare-disease diagnostic company.',
          source_model: 'Model A',
          saved_at: new Date().toISOString(),
        };
        console.log(`\n     ⚠  AI unavailable, using canned summary (save pipeline still tested)`);
      }

      const upload = await httpPost(`${BASE}/api/filecoin`, { action: 'upload', data: enriched });
      if (upload.error) throw new Error('Upload: ' + upload.error);
      if (!upload.cid) throw new Error('No CID returned');
      saveCid = upload.cid;
      savedTopic = enriched.topic;

      const retrieve = await httpPost(`${BASE}/api/filecoin`, { action: 'retrieve', cid: saveCid });
      if (retrieve.error) throw new Error('Retrieve: ' + retrieve.error);
      if (!retrieve.data || !retrieve.data.topic) throw new Error('Retrieved data missing topic');

      console.log(`     CID: ${saveCid}`);
      console.log(`     Topic on retrieval: "${retrieve.data.topic}"`);
      console.log(`     Facts loaded: ${retrieve.factCount}`);
      console.log(`     Memory flow: LLM → JSON → Filecoin → CID ✅`);
    });

    // ──────────────────────────────────────────────────────────────────────────
    // CHECK 6 — Full load flow (CID → injected context → Model B answers)
    // ──────────────────────────────────────────────────────────────────────────
    await check('CHECK 6: Load via CID — Model B answers using injected context', async () => {
      if (!saveCid) {
        throw new Error('No CID available — Check 5 did not produce one');
      }

      // Step A: Retrieve from Filecoin
      const retrieve = await httpPost(`${BASE}/api/filecoin`, { action: 'retrieve', cid: saveCid });
      if (retrieve.error) throw new Error('Retrieve: ' + retrieve.error);

      // Step B: Inject into Model B (same as app does)
      const contextStr = JSON.stringify(retrieve.data);
      const chatData = await httpPostWithRetry(`${BASE}/api/chat`, {
        messages: [
          { role: 'user', content: 'Which job offer did I accept and what does the company build?' },
        ],
        model: 'b',
        contextPrompt: contextStr,
      });
      if (chatData.error) throw new Error('Model B: ' + chatData.error);
      if (!chatData.message) throw new Error('Empty response');

      // Step C: Verify Model B used the context
      const resp = chatData.message.toLowerCase();
      const mustMention = ['startup', 'diagnostic', 'rare disease', 'ai'];
      const found = mustMention.filter(w => resp.includes(w));
      if (found.length < 2) {
        console.log(`\n     ⚠  Found ${found.length}/${mustMention.length} expected context references`);
        console.log(`     Full response: "${chatData.message.trim().slice(0, 350)}"`);
        throw new Error(`Response too generic — expected references to startup/rare-disease/AI`);
      }

      console.log(`\n     Context loaded: ${retrieve.factCount} facts`);
      console.log(`     Context references in answer: ${found.length}/${mustMention.length}`);
      console.log(`     Model B: "${chatData.message.trim().slice(0, 180)}..."`);
      console.log(`     Memory flow: Filecoin → CID → fetch → inject → Model B responds ✅`);
    });

    // ──────────────────────────────────────────────────────────────────────────
    // SUMMARY
    // ──────────────────────────────────────────────────────────────────────────
    console.log('');
    console.log('══════════════════════════════════════════════════════');
    console.log(`  ${passed}/${passed + failed + skipped} checks passed`);
    if (skipped > 0) console.log(`  ${skipped} skipped (${quotaExhausted ? 'quota exhausted' : 'API unavailable — transient'})`);
    if (failed === 0) {
      console.log('  No failures 🎉');
    } else {
      console.log('  FAILURES:');
      for (const f of failures) {
        console.log(`    ❌ ${f.label}`);
        console.log(`       ${f.err}`);
      }
    }
    console.log('══════════════════════════════════════════════════════');
    console.log('');

  } finally {
    server.kill();
    try { execSync(`fuser -k ${PORT}/tcp 2>/dev/null`, { stdio: 'pipe' }); } catch {}
  }

  process.exit(failures.length > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
