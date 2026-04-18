// api/append-signals.js v2 — sha conflict retry
const https = require('https');

function req(opts, body) {
  return new Promise((resolve, reject) => {
    const r = https.request(opts, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({status: res.statusCode, body: Buffer.concat(chunks).toString('utf8')}));
    });
    r.on('error', reject);
    if (body) r.write(body);
    r.end();
  });
}

async function readBody(q) {
  if (q.body && typeof q.body === 'object') return q.body;
  return new Promise((resolve, reject) => {
    let data = '';
    q.on('data', c => data += c);
    q.on('end', () => { try { resolve(JSON.parse(data)); } catch(e) { reject(e); } });
    q.on('error', reject);
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

module.exports = async (q, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (q.method === 'OPTIONS') return res.status(200).end();

  const token = process.env.GITHUB_TOKEN;
  if (!token) return res.status(500).json({ok:false, error:'GITHUB_TOKEN missing'});

  const repoPath = '/repos/neo9999999999/neo-score/contents/data/signals-raw.json';
  const ghHeaders = {
    'Authorization': 'Bearer ' + token,
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'neo-score-signals',
    'X-GitHub-Api-Version': '2022-11-28'
  };

  try {
    if (q.method === 'GET') {
      const r = await req({hostname:'api.github.com', port:443, path:repoPath+'?ref=main', method:'GET', headers:ghHeaders});
      if (r.status === 404) return res.status(200).json({ok:true, total:0, chunks:[], signals:[], sha:null});
      if (r.status !== 200) return res.status(r.status).json({ok:false, error:'GET failed', body:r.body.slice(0,300)});
      const gd = JSON.parse(r.body);
      const content = Buffer.from(gd.content, 'base64').toString('utf8');
      const data = JSON.parse(content);
      return res.status(200).json({ok:true, total: data.signals?.length || 0, chunks_count: data.chunks?.length || 0, chunks: data.chunks, last_updated: data.last_updated, sha: gd.sha});
    }

    const body = await readBody(q);
    const newSignals = body.signals || [];
    const chunkMeta = body.chunk || {};

    if (!Array.isArray(newSignals)) return res.status(400).json({ok:false, error:'signals must be array'});

    const MAX_RETRY = 5;
    for (let attempt = 0; attempt < MAX_RETRY; attempt++) {
      // 1. read latest
      let existing = {signals: [], chunks: [], last_updated: null};
      let sha = null;
      const getR = await req({hostname:'api.github.com', port:443, path:repoPath+'?ref=main', method:'GET', headers:ghHeaders});
      if (getR.status === 200) {
        const gd = JSON.parse(getR.body);
        sha = gd.sha;
        try {
          existing = JSON.parse(Buffer.from(gd.content, 'base64').toString('utf8'));
        } catch(_){}
      }

      // 2. merge
      const key = s => s.code + ':' + s.date;
      const seen = new Set((existing.signals || []).map(key));
      let added = 0;
      for (const s of newSignals) {
        if (!seen.has(key(s))) {
          existing.signals.push(s);
          seen.add(key(s));
          added++;
        }
      }
      existing.chunks = existing.chunks || [];
      existing.chunks.push({...chunkMeta, ts: new Date().toISOString(), new_signals: added});
      existing.last_updated = new Date().toISOString();

      // 3. PUT
      const newContent = Buffer.from(JSON.stringify(existing, null, 1)).toString('base64');
      const putBody = JSON.stringify({
        message: 'append chunk y=' + (chunkMeta.year || '?') + ' s=' + (chunkMeta.start || '?') + ' (+' + added + ')',
        content: newContent,
        branch: 'main',
        ...(sha ? {sha} : {})
      });
      const putR = await req({hostname:'api.github.com', port:443, path:repoPath, method:'PUT',
        headers: {...ghHeaders, 'Content-Type':'application/json', 'Content-Length': Buffer.byteLength(putBody)}
      }, putBody);

      if (putR.status === 200 || putR.status === 201) {
        const pd = JSON.parse(putR.body);
        return res.status(200).json({ok:true, committed:true, total: existing.signals.length, added, chunks: existing.chunks.length, sha: pd.content.sha, attempts: attempt+1});
      }

      // sha mismatch (409 Conflict) 혹은 422 — retry
      if (putR.status === 409 || putR.status === 422) {
        await sleep(300 + Math.random() * 500);  // jitter
        continue;
      }

      return res.status(putR.status).json({ok:false, error:'PUT failed', status:putR.status, body: putR.body.slice(0,300)});
    }
    return res.status(429).json({ok:false, error:'sha conflict, max retries exceeded'});
  } catch(e) {
    return res.status(500).json({ok:false, error:e.message, stack:(e.stack||'').slice(0,400)});
  }
};
