// api/auto-signals.js — KIS fluctuation 자동 신호 생성 + GitHub commit
const https = require('https');
const AK = process.env.KIS_APP_KEY;
const AS = process.env.KIS_APP_SECRET;
const GH_TOKEN = process.env.GITHUB_TOKEN;
const CRON_SECRET = process.env.CRON_SECRET || 'neo-cron-2026';

const GH_OWNER = 'neo9999999999';
const GH_REPO = 'neo-score';
const KIS_HOST = 'openapi.koreainvestment.com';
const KIS_PORT = 9443;
const GH_API = 'api.github.com';

function httpsReq(host, port, path, headers, body, method) {
  method = method || 'GET';
  return new Promise(function(resolve, reject) {
    var opts = { host: host, port: port || 443, path: path, method: method, headers: headers || {} };
    var req = https.request(opts, function(res) {
      var buf = '';
      res.on('data', function(c) { buf += c; });
      res.on('end', function() {
        try { resolve({ status: res.statusCode, json: JSON.parse(buf) }); }
        catch(e) { resolve({ status: res.statusCode, raw: buf }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

async function getToken() {
  var r = await httpsReq(KIS_HOST, KIS_PORT, '/oauth2/tokenP',
    { 'Content-Type': 'application/json' },
    { grant_type: 'client_credentials', appkey: AK, appsecret: AS },
    'POST');
  return r.json && r.json.access_token;
}

async function fetchFluctuation(tk, marketDiv, sortCode) {
  var qs = [
    'fid_cond_mrkt_div_code=' + marketDiv,
    'fid_cond_scr_div_code=20170',
    'fid_input_iscd=0000',
    'fid_rank_sort_cls_code=' + sortCode,
    'fid_input_cnt_1=0',
    'fid_prc_cls_code=0',
    'fid_input_price_1=',
    'fid_input_price_2=',
    'fid_vol_cnt=',
    'fid_trgt_cls_code=',
    'fid_trgt_exls_cls_code=',
    'fid_div_cls_code=0',
    'fid_rsfl_rate1=',
    'fid_rsfl_rate2='
  ].join('&');
  var path = '/uapi/domestic-stock/v1/ranking/fluctuation?' + qs;
  var r = await httpsReq(KIS_HOST, KIS_PORT, path, {
    authorization: 'Bearer ' + tk,
    appkey: AK, appsecret: AS,
    tr_id: 'FHPST01700000', custtype: 'P'
  });
  return r.json && r.json.output ? r.json.output : [];
}

function calcAutoSignal(d, market) {
  var code = d.stck_shrn_iscd || d.mksc_shrn_iscd;
  var name = d.hts_kor_isnm;
  var price = +d.stck_prpr;
  var rate = +d.prdy_ctrt;
  var volume = +d.acml_vol;
  var amount_won = +(d.acml_tr_pbmn || 0);
  var amount_eok = Math.round(amount_won / 1e8);
  
  var supply = 15;
  var breakQuality = rate >= 15 ? 18 : rate >= 10 ? 15 : rate >= 5 ? 10 : 5;
  var momentum = amount_eok >= 1000 ? 18 : amount_eok >= 500 ? 14 : amount_eok >= 200 ? 11 : 8;
  var marketScore = amount_eok >= 1500 ? 13 : amount_eok >= 800 ? 11 : amount_eok >= 300 ? 10 : 8;
  var preCondensation = 13;
  
  var sections = [
    { name: '수급', score: supply, max: 25 },
    { name: '돌파품질', score: breakQuality, max: 25 },
    { name: '모멘텀·시장', score: momentum, max: 20 },
    { name: '시황·재료', score: marketScore, max: 15 },
    { name: '사전응축·이평', score: preCondensation, max: 15 }
  ];
  var total = supply + breakQuality + momentum + marketScore + preCondensation;
  var grade = total >= 90 ? 'S+' : total >= 85 ? 'S' : total >= 80 ? 'A+' : total >= 75 ? 'A' : total >= 70 ? 'B+' : total >= 65 ? 'B' : total >= 60 ? 'C+' : 'C';
  
  return {
    code: code, name: name, price: price, rate: rate, volume: volume,
    amount: amount_eok, market: market,
    sections: sections, total: total, grade: grade
  };
}

async function ghCommit(path, content, message) {
  var sha = null;
  var head = { 'User-Agent': 'neo-score-cron', authorization: 'token ' + GH_TOKEN };
  try {
    var r1 = await httpsReq(GH_API, 443, '/repos/' + GH_OWNER + '/' + GH_REPO + '/contents/' + path, head);
    if (r1.json && r1.json.sha) sha = r1.json.sha;
  } catch(e) {}
  
  var b64 = Buffer.from(JSON.stringify(content, null, 2)).toString('base64');
  var body = { message: message, content: b64, branch: 'main' };
  if (sha) body.sha = sha;
  
  var r2 = await httpsReq(GH_API, 443, '/repos/' + GH_OWNER + '/' + GH_REPO + '/contents/' + path,
    Object.assign({}, head, { 'Content-Type': 'application/json' }),
    body, 'PUT');
  return r2.status === 200 || r2.status === 201;
}

async function ghFetch(path) {
  var head = { 'User-Agent': 'neo-score-fetch', authorization: 'token ' + GH_TOKEN, accept: 'application/vnd.github.v3.raw' };
  var r = await httpsReq(GH_API, 443, '/repos/' + GH_OWNER + '/' + GH_REPO + '/contents/' + path, head);
  if (r.json && r.json.content) {
    try { return JSON.parse(Buffer.from(r.json.content, 'base64').toString('utf8')); } catch(e) { return null; }
  }
  if (r.raw) {
    try { return JSON.parse(r.raw); } catch(e) { return null; }
  }
  return null;
}

module.exports = async function(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-CRON-SECRET');
  res.setHeader('Cache-Control', 'no-cache, no-store');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  
  var action = (req.query && req.query.action) || 'fetch';
  
  if (action === 'fetch') {
    try {
      var data = await ghFetch('data/auto-signals.json');
      res.status(200).json(data || { date: '', signals: [], note: 'no data yet' });
    } catch(e) {
      res.status(500).json({ error: e.message });
    }
    return;
  }
  
  if (action === 'generate') {
    var provided = (req.headers['x-cron-secret'] || (req.query && req.query.secret) || '');
    var isVercelCron = (req.headers['user-agent'] || '').indexOf('vercel-cron') >= 0;
    if (provided !== CRON_SECRET && !isVercelCron) { res.status(401).json({ error: 'unauthorized' }); return; }
    
    try {
      var tk = await getToken();
      if (!tk) { res.status(500).json({ error: 'token failed' }); return; }
      
      var krx = await fetchFluctuation(tk, 'J', '0');
      var nxt = [];
      try { nxt = await fetchFluctuation(tk, 'NX', '0'); } catch(e) {}
      
      var allSignals = [];
      krx.forEach(function(d) { allSignals.push(calcAutoSignal(d, 'KRX')); });
      nxt.forEach(function(d) { allSignals.push(calcAutoSignal(d, 'NXT')); });
      
      var signals = allSignals
        .filter(function(s) { return s.amount >= 50; })
        .sort(function(a, b) { return b.rate - a.rate; })
        .slice(0, 100);
      
      var now = new Date();
      var kst = new Date(now.getTime() + 9*3600*1000);
      var dateStr = kst.toISOString().slice(0, 10);
      
      var payload = {
        date: dateStr,
        timestamp: Date.now(),
        kstTime: kst.toISOString().slice(0, 19) + '+09:00',
        signalsCount: signals.length,
        krxRaw: krx.length,
        nxtRaw: nxt.length,
        signals: signals
      };
      
      var ok = await ghCommit('data/auto-signals.json', payload, 'Auto-signals ' + dateStr + ' (' + signals.length + ' stocks)');
      
      res.status(200).json({
        ok: ok, date: dateStr,
        signalsCount: signals.length,
        krxRaw: krx.length, nxtRaw: nxt.length,
        sample: signals.slice(0, 3)
      });
    } catch(e) {
      res.status(500).json({ error: e.message, stack: e.stack });
    }
    return;
  }
  
  res.status(400).json({ error: 'invalid action', valid: ['fetch', 'generate'] });
};
