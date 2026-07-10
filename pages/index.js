import { useState, useRef, useEffect, useCallback } from 'react';

function ChatMessage({ role, content }) {
  const label = role === 'user' ? 'You' : role === 'system' ? 'System' : 'Model';
  return (
    <div className={`message ${role}`}>
      <div style={{ fontSize: '0.7rem', opacity: 0.6, marginBottom: 2 }}>{label}</div>
      {content}
    </div>
  );
}

function ChatPanel({ modelId, label, badgeClass, otherCid, onCidChange }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [filecoinLoading, setFilecoinLoading] = useState(false);
  const [cid, setCid] = useState('');
  const [statusMsg, setStatusMsg] = useState(null);
  const [contextLoaded, setContextLoaded] = useState(null);
  const [loadCid, setLoadCid] = useState('');
  const chatEndRef = useRef(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (otherCid && modelId === 'b') {
      setLoadCid(otherCid);
    }
  }, [otherCid, modelId]);

  const sendMessage = useCallback(async () => {
    if (!input.trim() || loading) return;
    const userMsg = input.trim();
    setInput('');
    setMessages((prev) => [...prev, { role: 'user', content: userMsg }]);
    setLoading(true);
    setStatusMsg(null);

    const contextForB = modelId === 'b' && contextLoaded
      ? JSON.stringify(contextLoaded, null, 2)
      : '';

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [...messages, { role: 'user', content: userMsg }],
          model: modelId,
          contextPrompt: contextForB,
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setMessages((prev) => [...prev, { role: 'assistant', content: data.message }]);
    } catch (err) {
      setStatusMsg({ type: 'error', text: `Error: ${err.message}` });
    } finally {
      setLoading(false);
    }
  }, [input, loading, messages, modelId, contextLoaded]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const saveToFilecoin = async () => {
    const chatMessages = messages.filter((m) => m.role !== 'system');
    if (chatMessages.length < 2) {
      setStatusMsg({ type: 'error', text: 'Have at least one exchange before saving.' });
      return;
    }
    setFilecoinLoading(true);
    setStatusMsg({ type: null, text: 'Summarizing conversation...' });
    try {
      const summaryRes = await fetch('/api/summarize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: chatMessages }),
      });
      const summaryData = await summaryRes.json();
      if (summaryData.error) throw new Error(summaryData.error);

      setStatusMsg({ type: null, text: 'Uploading to Filecoin via Lighthouse...' });

      const savedSummary = summaryData.summary || {};
      const uploadPayload = {
        topic: savedSummary.topic || '',
        key_facts: Array.isArray(savedSummary.key_facts) ? savedSummary.key_facts : [],
        decisions: Array.isArray(savedSummary.decisions) ? savedSummary.decisions : [],
        preferences: Array.isArray(savedSummary.preferences) ? savedSummary.preferences : [],
        summary: savedSummary.summary || '',
        source_model: `Model ${modelId.toUpperCase()}`,
        saved_at: new Date().toISOString(),
      };

      const uploadRes = await fetch('/api/filecoin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'upload', data: uploadPayload }),
      });
      const uploadData = await uploadRes.json();
      if (uploadData.error) throw new Error(uploadData.error);

      setCid(uploadData.cid);
      onCidChange(uploadData.cid);
      setStatusMsg({ type: 'success', text: `Saved! CID: ${uploadData.cid}` });
    } catch (err) {
      setStatusMsg({ type: 'error', text: `Failed: ${err.message}` });
    } finally {
      setFilecoinLoading(false);
    }
  };

  const loadFromFilecoin = async () => {
    if (!loadCid.trim()) {
      setStatusMsg({ type: 'error', text: 'Enter a CID first.' });
      return;
    }
    setFilecoinLoading(true);
    setStatusMsg({ type: null, text: 'Fetching from Filecoin via Lighthouse...' });
    try {
      const retrieveRes = await fetch('/api/filecoin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'retrieve', cid: loadCid.trim() }),
      });
      const retrieveData = await retrieveRes.json();
      if (retrieveData.error) throw new Error(retrieveData.error);

      const raw = retrieveData.data || {};
      const src = raw.key_facts ? raw : (raw.summary || raw);
      setContextLoaded({
        topic: src.topic || '',
        key_facts: Array.isArray(src.key_facts) ? src.key_facts : [],
        decisions: Array.isArray(src.decisions) ? src.decisions : [],
        preferences: Array.isArray(src.preferences) ? src.preferences : [],
        summary: src.summary || '',
        source_model: raw.source_model || '',
        saved_at: raw.saved_at || '',
      });
      setMessages([]);
      if (retrieveData.factCount === 0) {
        setStatusMsg({
          type: 'error',
          text: 'No facts were found in the saved context. The conversation may not have contained enough information to extract facts.',
        });
      } else {
        setStatusMsg({
          type: 'success',
          text: `Context loaded: ${retrieveData.factCount} facts retrieved from Filecoin. Model B now has full context.`,
        });
      }
    } catch (err) {
      setStatusMsg({ type: 'error', text: `Failed: ${err.message}` });
    } finally {
      setFilecoinLoading(false);
    }
  };

  return (
    <div className="panel">
      <div className="panel-header">
        <h2>
          {label}
          <span className={`badge ${badgeClass}`} style={{ marginLeft: 8 }}>
            {modelId === 'a' ? 'Llama 3.1 8B (HuggingFace)' : 'Llama 3.3 70B (Groq)'}
          </span>
        </h2>
      </div>

      <div className="chat-area">
        {messages.length === 0 && (
          <div style={{ color: '#8b949e', textAlign: 'center', padding: 40, fontSize: '0.85rem' }}>
            {modelId === 'a'
              ? 'Chat with Model A. Then save the memory to Filecoin.'
              : contextLoaded
                ? 'Context loaded! Ask a follow-up question.'
                : 'Load context from Filecoin, then chat with Model B.'}
          </div>
        )}
        {messages.map((msg, i) => (
          <ChatMessage key={i} role={msg.role} content={msg.content} />
        ))}
        <div ref={chatEndRef} />
      </div>

      <div className="input-area">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a message..."
          disabled={loading}
        />
        <button className="btn-primary" onClick={sendMessage} disabled={loading || !input.trim()}>
          {loading ? <><span className="spinner" />Thinking...</> : 'Send'}
        </button>
      </div>

      <div className="filecoin-section">
        {modelId === 'a' ? (
          <>
            <button
              className="btn-filecoin"
              onClick={saveToFilecoin}
              disabled={filecoinLoading || messages.filter((m) => m.role !== 'system').length < 2}
              style={{ width: '100%' }}
            >
              {filecoinLoading ? <><span className="spinner" />Processing...</> : <>💾 Save to Filecoin</>}
            </button>
            {cid && (
              <div>
                <div style={{ fontSize: '0.75rem', color: '#8b949e', marginBottom: 4 }}>Saved CID:</div>
                <div className="cid-display">{cid}</div>
              </div>
            )}
          </>
        ) : (
          <>
            <div className="row">
              <input
                value={loadCid}
                onChange={(e) => setLoadCid(e.target.value)}
                placeholder="Enter CID to load..."
              />
              <button
                className="btn-filecoin"
                onClick={loadFromFilecoin}
                disabled={filecoinLoading || !loadCid.trim()}
              >
                {filecoinLoading ? <><span className="spinner" />Loading...</> : '📂 Load from Filecoin'}
              </button>
            </div>
          </>
        )}
        {statusMsg && (
          <div className={`status-msg ${statusMsg.type || ''}`}>
            {statusMsg.text}
          </div>
        )}
      </div>
    </div>
  );
}

export default function Home() {
  const [lastCid, setLastCid] = useState('');

  return (
    <div className="container">
      <header>
        <h1>FilVault Bridge</h1>
        <p>Portable AI Memory · Powered by Filecoin</p>
      </header>

      <div className="demo-steps">
        <strong>Demo Flow:</strong><br />
        1. Chat with <strong>Model A</strong> about a topic → make decisions, state preferences<br />
        2. Click <code>Save to Filecoin</code> → conversation is summarized and uploaded as JSON via Lighthouse<br />
        3. Switch to <strong>Model B</strong> (fresh chat, zero prior messages)<br />
        4. Click <code>Load from Filecoin</code> → the saved context is injected into Model B's system prompt<br />
        5. Ask a follow-up → Model B answers with full context from Model A's conversation
      </div>

      <div className="panels">
        <ChatPanel
          modelId="a"
          label="Model A"
          badgeClass="badge-a"
          otherCid=""
          onCidChange={setLastCid}
        />
        <ChatPanel
          modelId="b"
          label="Model B"
          badgeClass="badge-b"
          otherCid={lastCid}
          onCidChange={() => {}}
        />
      </div>
    </div>
  );
}
