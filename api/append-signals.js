// api/append-signals.js v3 — + investor query mode
// GET ?mode=inv&code=XXXXXX  -> fetch KIS investor trend for code
// GET ?mode=inv&codes=a,b,c  -> batch (max 15)
// GET (no params)            -> list stored signals metadata
// POST                        -> append chunk (existing behavior)
const https = require('https');

const KIS_HOST = 'openapi.koreainvestment.com';
const KIS_PORT = 9443;
const AK = process.env.KIS_APP_KEY;
const SK = process.env.KIS_APP_SECRET;

let _token = null;
let _tokenExp = 0;

const sleep = ms => new Promise(r => setTimeout(r, ms));

function req(opts, body) {
  return new Promise((resolve, reject) => {
    const r = https.request(opts, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({status: res.statusCode, body: Buffer.concat(chunks).toString('utf8')}));
    });
    r.on('error', reject);
    r.setTimeout(30000, () => r.destroy(new Error('timeout')));
    if (body) r.write(body);
    r.end();
  });
}

async function getToken() {
  if (_token && Date.now() < _tokenExp) return _token;
  const body = JSON.stringify({grant_type:'client_credentials', appkey:AK, appsecret:SK});
  const r = await req({
    hostname: KIS_HOST, port: KIS_PORT, path: '/oauth2/tokenP', method: 'POST',
    headers: {'Content-Type':'application/json', 'Content-Length': Buffer.byteLength(body)}
  }, body);
  const d = JSON.parse(r.body);
  if (!d.access_token) throw new Error('tokfail ' + r.body.slice(0,200));
  _token = d.access_token;
  _tokenExp = Date.now() + 23*3600*1000;
  return _token;
}

async function fetchInv(code) {
  const t = await getToken();
  const path = '/uapi/domestic-stock/v1/quotations/inquire-investor?FID_COND_MRKT_DIV_CODE=J&FID_INPUT_ISCD=' + code;
  const r = await req({
    hostname: KIS_HOST, port: KIS_PORT, path, method: 'GET',
    headers: {
      'Content-Type':'application/json; charset=utf-8',
      'authorization':'Bearer ' + t,
      'appkey':AK, 'appsecret':SK,
      'tr_id':'FHKST01010900', 'custtype':'P'
    }
  });
  return {status: r.status, body: r.body};
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

module.exports = async (q, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (q.method === 'OPTIONS') return res.status(200).end();

  // === MODE: investor ===
  if (q.method === 'GET' && q.query && q.query.mode === 'inv') {
    if (!AK || !SK) return res.status(500).json({ok:false, error:'KIS keys missing'});
    try {
      const code = q.query.code;
      const codes = q.query.codes;
      if (code) {
        const r = await fetchInv(code);
        try { return res.status(200).json({ok:true, code, data: JSON.parse(r.body)}); }
        catch(_) { return res.status(200).json({ok:false, code, status:r.status, raw: r.body.slice(0,500)}); }
      }
      if (codes) {
        const list = codes.split(',').filter(Boolean).slice(0, 15);
        const data = {};
        const errors = [];
        for (const c of list) {
          const r = await fetchInv(c);
          await sleep(180);
          try {
            const d = JSON.parse(r.body);
            if (d.rt_cd === '0') data[c] = d.output || [];
            else errors.push({code: c, msg: d.msg1 || d.msg_cd});
          } catch(e) { errors.push({code: c, parse: e.message}); }
        }
        return res.status(200).json({ok:true, count: list.length, data, errors});
      }
      return res.status(400).json({ok:false, error:'missing code or codes'});
    } catch(e) {
      return res.status(500).json({ok:false, error: e.message});
    }
  }

  // === SIGNALS (existing) ===
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
      if (r.status === 404) return res.status(200).json({ok:true, total:0, chunks:[], sha:null});
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
      let existing = {signals: [], chunks: [], last_updated: null};
      let sha = null;
      const getR = await req({hostname:'api.github.com', port:443, path:repoPath+'?ref=main', method:'GET', headers:ghHeaders});
      if (getR.status === 200) {
        const gd = JSON.parse(getR.body);
        sha = gd.sha;
        try { existing = JSON.parse(Buffer.from(gd.content, 'base64').toString('utf8')); } catch(_){}
      }
      const key = s => s.code + ':' + s.date;
      const seen = new Set((existing.signals || []).map(key));
      let added = 0;
      for (const s of newSignals) {
        if (!seen.has(key(s))) { existing.signals.push(s); seen.add(key(s)); added++; }
      }
      existing.chunks = existing.chunks || [];
      existing.chunks.push({...chunkMeta, ts: new Date().toISOString(), new_signals: added});
      existing.last_updated = new Date().toISOString();
      const newContent = Buffer.from(JSON.stringify(existing, null, 1)).toString('base64');
      const putBody = JSON.stringify({
        message: 'append chunk y=' + (chunkMeta.year || '?') + ' s=' + (chunkMeta.start || '?') + ' (+' + added + ')',
        content: newContent, branch: 'main',
        ...(sha ? {sha} : {})
      });
      const putR = await req({hostname:'api.github.com', port:443, path:repoPath, method:'PUT',
        headers: {...ghHeaders, 'Content-Type':'application/json', 'Content-Length': Buffer.byteLength(putBody)}
      }, putBody);
      if (putR.status === 200 || putR.status === 201) {
        const pd = JSON.parse(putR.body);
        return res.status(200).json({ok:true, committed:true, total: existing.signals.length, added, chunks: existing.chunks.length, sha: pd.content.sha, attempts: attempt+1});
      }
      if (putR.status === 409 || putR.status === 422) {
        await sleep(300 + Math.random()*500);
        continue;
      }
      return res.status(putR.status).json({ok:false, error:'PUT failed', status:putR.status, body: putR.body.slice(0,300)});
    }
    return res.status(429).json({ok:false, error:'sha conflict max retries'});
  } catch(e) {
    return res.status(500).json({ok:false, error:e.message, stack:(e.stack||'').slice(0,400)});
  }
};
