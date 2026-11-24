'use strict';
// Optional LLM adapter. Default: none (templates only).

const cache = new Map();

function getConfig() {
  return {
    provider: process.env.LLM_PROVIDER || 'none',
    baseUrl: process.env.LLM_BASE_URL || '',
    apiKey: process.env.LLM_API_KEY || '',
    model: process.env.LLM_MODEL || '',
    dailyCap: parseInt(process.env.LLM_DAILY_CAP || '100', 10),
  };
}

let dailyCount = 0;
let dailyDate = new Date().toISOString().slice(0, 10);

function checkCap() {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== dailyDate) { dailyCount = 0; dailyDate = today; }
  const cfg = getConfig();
  if (dailyCount >= cfg.dailyCap) return false;
  return true;
}

async function polish(text, context) {
  const cfg = getConfig();
  if (cfg.provider === 'none') return text;
  if (!checkCap()) return text;
  const key = cfg.provider + ':' + cfg.model + ':' + text.slice(0, 200);
  if (cache.has(key)) return cache.get(key);
  try {
    // Generic OpenAI-compatible chat completions
    const url = cfg.baseUrl.replace(/\/+$/, '') + '/chat/completions';
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'authorization': 'Bearer ' + cfg.apiKey },
      body: JSON.stringify({ model: cfg.model, messages: [{ role: 'user', content: context + '\n\nPolish this text (keep facts, improve wording, max 300 words):\n' + text }], max_tokens: 500 }),
    });
    if (!res.ok) throw new Error('LLM error ' + res.status);
    const j = await res.json();
    const out = j?.choices?.[0]?.message?.content || text;
    dailyCount++;
    cache.set(key, out);
    return out;
  } catch (e) {
    console.log('LLM fallback:', e.message);
    return text;
  }
}

function summarize(text) {
  // Simple template-based summary (no LLM needed)
  const lines = text.split('\n').filter(l => l.trim()).slice(0, 5);
  return lines.join(' ').slice(0, 300);
}

module.exports = { polish, summarize, getConfig, checkCap };
