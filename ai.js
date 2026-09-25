// POST /api/ai  { prompt }  → streams plain text from Claude.
// Env: ANTHROPIC_API_KEY (required), ANTHROPIC_MODEL (optional).

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ error: 'ANTHROPIC_API_KEY is not set' });

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const prompt = String(body.prompt || '').slice(0, 60000);
  if (!prompt) return res.status(400).json({ error: 'prompt required' });

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({ model: MODEL, max_tokens: 2000, stream: true, messages: [{ role: 'user', content: prompt }] }),
  });
  if (!r.ok || !r.body) {
    const t = await r.text().catch(() => '');
    return res.status(r.status === 429 ? 429 : 502).json({ error: `Anthropic error ${r.status}: ${t.slice(0, 300)}` });
  }

  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line.startsWith('data:')) continue;
      try {
        const ev = JSON.parse(line.slice(5));
        if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') res.write(ev.delta.text);
      } catch {}
    }
  }
  res.end();
}
