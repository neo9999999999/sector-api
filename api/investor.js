// api/investor.js — KIS 종목별 일별 투자자 매매동향
const https = require('https');

const KIS_HOST = 'openapi.koreainvestment.com';
const KIS_PORT = 9443;
const AK = process.env.KIS_APP_KEY;
const SK = process.env.KIS_APP_SECRET;

let _token = null;
let _tokenExp = 0;

const sleep = ms => new Promise(r => setTimeout(r, ms));

function httpReq(opts, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(opts, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({status: res.statusCode, body: Buffer.concat(chunks).toString('utf8')}));
    });
    req.on('error', reject);
    req.setTimeout(30000, () => req.destroy(new Error('timeout')));
    if (body) req.write(body);
    req.end();
  });
}

async function getToken() {
  if (_token && Date.now() < _tokenExp) return _token;
  const body = JSON.stringify({grant_type:'client_credentials', appkey:AK, appsecret:SK});
  const r = await httpReq({
    hostname: KIS_HOST, port: KIS_PORT, path: '/oauth2/tokenP', method: 'POST',
    headers: {'Content-Type':'application/json', 'Content-Length': Buffer.byteLength(body)}
  }, body);
  const d = JSON.parse(r.body);
  if (!d.access_token) throw new Error('token fail: ' + r.body.slice(0,200));
  _token = d.access_token;
  _tokenExp = Date.now() + 23 * 3600 * 1000;
  return _token;
}

// 종목별 투자자 매매 동향 (기관/외인/개인 일별 순매수 수량)
// tr_id: FHKST01010900 — 종목별 투자자매매동향 (최근 90일)
async function fetchInvestor(code, maxRetry = 2) {
  const token = await getToken();
  const path = '/uapi/domestic-stock/v1/quotations/inquire-investor' +
    '?FID_COND_MRKT_DIV_CODE=J' +
    '&FID_INPUT_ISCD=' + code;
  for (let attempt = 0; attempt <= maxRetry; attempt++) {
    try {
      const r = await httpReq({
        hostname: KIS_HOST, port: KIS_PORT, path, method: 'GET',
        headers: {
          'Content-Type':'application/json; charset=utf-8',
          'authorization': 'Bearer ' + token,
          'appkey': AK, 'appsecret': SK,
          'tr_id': 'FHKST01010900', 'custtype': 'P'
        }
      });
      if (r.status !== 200) {
        if (r.body.includes('EGW00201') && attempt < maxRetry) { await sleep(400 * (attempt + 1)); continue; }
        return {error: 'status ' + r.status, body: r.body.slice(0,300)};
      }
      const d = JSON.parse(r.body);
      if (d.rt_cd === '1') {
        if (d.msg_cd === 'EGW00201' && attempt < maxRetry) { await sleep(400 * (attempt + 1)); continue; }
        return {error: d.msg1 || d.msg_cd, body: r.body.slice(0,300)};
      }
      return {rows: d.output || []};
    } catch(e) {
      if (attempt < maxRetry) { await sleep(400 * (attempt + 1)); continue; }
      return {error: e.message};
    }
  }
  return {error: 'max retry exceeded'};
}

module.exports = async (q, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (q.method === 'OPTIONS') return res.status(200).end();
  if (!AK || !SK) return res.status(500).json({ok:false, error:'KIS keys missing'});

  const code = q.query.code;
  const codesParam = q.query.codes;  // comma-separated list for batch
  
  try {
    // 단일 종목 조회
    if (code) {
      const r = await fetchInvestor(code);
      if (r.error) return res.status(500).json({ok:false, error:r.error, body:r.body});
      return res.status(200).json({ok:true, code, rows: r.rows});
    }
    
    // 배치 (codes=aaa,bbb,ccc)
    if (codesParam) {
      const codes = codesParam.split(',').filter(Boolean).slice(0, 30);  // 안전 cap
      const out = {};
      const errors = [];
      for (const c of codes) {
        const r = await fetchInvestor(c);
        await sleep(150);
        if (r.error) { errors.push({code:c, error:r.error}); continue; }
        out[c] = r.rows;
      }
      return res.status(200).json({ok:true, codes_count: codes.length, data: out, errors});
    }
    
    return res.status(400).json({ok:false, error:'missing code or codes param'});
  } catch(e) {
    return res.status(500).json({ok:false, error:e.message, stack:(e.stack||'').slice(0,400)});
  }
};
