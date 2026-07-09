# FilVault Bridge

**Portable AI Memory — Powered by Filecoin**

A single-page web app that demonstrates **portable AI memory across LLM providers** using Filecoin as the storage layer. Chat with Model A, save the conversation memory to Filecoin, then load it into Model B — proving memory is genuinely portable and not tied to one provider.

**Live demo:** _(add Vercel/Netlify URL here after deploy)_
**X post:** _(add your post URL here after publishing — remember to tag @Filecoin and @FilecoinTLDR)_

---

## Project Pitch

AI assistants today have **no portable memory**. Switch from Claude to ChatGPT and your conversation history, decisions, and preferences are left behind. FilVault Bridge solves this by storing structured conversation memory on **Filecoin** — a decentralized storage network — so that any AI model can pick up where another left off.

The demo proves three things:
1. Filecoin can store structured AI memory (not just files)
2. That memory is retrievable by CID from any application
3. A different LLM can consume that memory and *genuinely use it* — not just echo it back

## Agent Mechanic

The app uses an **LLM-as-extractor** pattern:

1. **Chat** — User talks with **Model A (Gemini 2.0 Flash)** about a topic, making decisions and stating preferences
2. **Summarize** — A second LLM call (Gemini) extracts key facts, decisions, and preferences into a structured JSON schema
3. **Store** — That JSON is saved to a mock Filecoin store (or real Lighthouse.storage when deployed); the returned CID is the address of this memory
4. **Retrieve** — **Model B (Llama 3.3 70B on Groq)** accepts the CID, fetches the JSON, and injects it into the system prompt
5. **Prove** — The user asks a follow-up question; Model B answers with full context from the Model A conversation

The agent mechanic is: **LLM (Gemini) → Structured JSON → Filecoin → CID → Different LLM (Groq/Llama)**. Using two different LLM providers proves memory is genuinely portable — not just a handoff within the same API.

## Filecoin Integration

### What's stored

Each "save" stores a JSON blob on Filecoin containing:
- `topic` — the main subject discussed
- `key_facts` — important factual statements from the conversation
- `decisions` — conclusions or decisions reached
- `preferences` — user preferences or opinions expressed
- `summary` — 2-3 sentence overview
- `source_model` — which model generated the conversation
- `saved_at` — ISO timestamp

### How CIDs work here

- The JSON is uploaded to **Lighthouse.storage**, a Filecoin storage API that pins data to IPFS and backs it up on Filecoin
- The upload returns a **Content Identifier (CID)** — a cryptographic hash of the content
- The CID is displayed prominently in the UI. The user copies it to load into Model B
- Retrieval goes through Lighthouse's IPFS gateway: `https://gateway.lighthouse.storage/ipfs/<CID>`
- Because the CID is content-addressed, it **proves the memory wasn't tampered with** — any change to the JSON would produce a different CID

This is a minimal but complete demonstration of the Filecoin storage + retrieval lifecycle.

## Prerequisites

1. **Gemini API key** — get one at https://aistudio.google.com/apikey
2. **Groq API key** — get one at https://console.groq.com/keys
3. **Lighthouse API key** (optional) — sign up at https://lighthouse.storage/ and get your API key from the dashboard

## Setup

```bash
# Clone / enter the repo
cd filvault-bridge

# Install dependencies
npm install

# Set your API keys
cp .env.local.example .env.local
# Edit .env.local and add at minimum GEMINI_API_KEY and GROQ_API_KEY

# Run dev server
npm run dev
```

Open http://localhost:3000 in your browser.

## Deploy

### Vercel

```bash
npm i -g vercel
vercel
```

Set the environment variables `GEMINI_API_KEY`, `GROQ_API_KEY`, and optionally `LIGHTHOUSE_API_KEY` in the Vercel dashboard.

### Netlify

Connect your repo to Netlify, set the build command to `npm run build` and publish directory to `.next`. Set the same environment variables (`GEMINI_API_KEY`, `GROQ_API_KEY`, optionally `LIGHTHOUSE_API_KEY`).

## Tech Stack

- **Frontend:** Next.js (Pages Router) + plain CSS
- **Model A:** Google Gemini 2.0 Flash (direct REST API)
- **Model B:** Llama 3.3 70B Versatile via Groq API
- **Summarizer:** Gemini 2.0 Flash (extracts structured JSON from conversations)
- **Storage:** In-memory fallback with mock CIDs (`filvault-...`) locally; Lighthouse.storage (Filecoin/IPFS) when deployed with `LIGHTHOUSE_API_KEY`
- **Deploy:** Vercel / Netlify

> **Fallback storage mode:** If `LIGHTHOUSE_API_KEY` is not set, the app uses an in-memory fallback store with mock CIDs (`filvault-...`). The full demo flow works the same way. Set a real Lighthouse key for actual Filecoin/IPFS storage. Note: the Lighthouse upload API (`node.lighthouse.storage`) may be unreachable from certain networks — it works when deployed to Vercel/GCP/AWS.

## AI Build Log

This project was built entirely using **Claude Code (opencode)** as the AI coding assistant, as part of the FilecoinTLDR Builder Challenge - Cycle 2.

### How AI was used throughout

| Phase | AI Role |
|---|---|
| **Ideation** | Claude Code helped refine the "portable AI memory" concept based on the hackathon brief, suggesting the LLM-as-extractor pattern and Lighthouse.storage integration |
| **Architecture** | AI generated the file structure, API route design, JSON schema for memory, and deployment strategy |
| **Implementation** | All code (Next.js pages, API routes, CSS styling, Filecoin integration) was written by Claude Code via natural language prompts |
| **Debugging** | Build errors, API issues, and CSS layout problems were resolved iteratively through AI-suggested fixes |
| **Documentation** | This README was drafted by Claude Code based on the implemented code |

### Prompt examples used

- *"Scaffold a Next.js app with two chat panels, Model A and Model B, using Gemini API"*
- *"Add a Save to Filecoin button that summarizes the conversation and uploads to Lighthouse"*
- *"Add a Load from Filecoin flow that fetches JSON by CID and injects it into Model B's system prompt"*
- *"Switch Model B from Gemini to Groq/Llama for true cross-provider memory portability"*
- *"Fix Node.js ETIMEDOUT to Groq API by resolving IPv4 addresses explicitly"*

The entire build took approximately 2 hours from concept to working demo.

---

Built for [FilecoinTLDR Builder Challenge - Cycle 2](https://filecointldr.io/)
