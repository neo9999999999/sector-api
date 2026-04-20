// api/batch-scan.js v6 — 50/50 split TP logic, close-based SL, OHLC preserved
const https = require('https');
const KIS_HOST = 'openapi.koreainvestment.com';
const KIS_PORT = 9443;
const AK = process.env.KIS_APP_KEY;
const SK = process.env.KIS_APP_SECRET;

let _token = null, _tokenExp = 0;
let _stocksCache = null, _stocksCacheAt = 0;

const sleep = ms => new Promise(r => setTimeout(r, ms));

function httpReq(opts, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(opts, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({status: res.statusCode, body: Buffer.concat(chunks).toString('utf8')}));
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('req timeout')));
    req.setTimeout(30000);
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

async function fetchDailyWithRetry(code, startYmd, endYmd, maxRetry = 3) {
  const token = await getToken();
  const path = '/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice?FID_COND_MRKT_DIV_CODE=J&FID_INPUT_ISCD=' + code + '&FID_INPUT_DATE_1=' + startYmd + '&FID_INPUT_DATE_2=' + endYmd + '&FID_PERIOD_DIV_CODE=D&FID_ORG_ADJ_PRC=1';
  for (let attempt = 0; attempt <= maxRetry; attempt++) {
    try {
      const r = await httpReq({
        hostname: KIS_HOST, port: KIS_PORT, path, method: 'GET',
        headers: {'Content-Type':'application/json; charset=utf-8','authorization':'Bearer ' + token,'appkey': AK, 'appsecret': SK, 'tr_id': 'FHKST03010100', 'custtype': 'P'}
      });
      if (r.status !== 200) {
        if (r.body.includes('EGW00201') && attempt < maxRetry) { await sleep(400 * (attempt + 1)); continue; }
        return {error: 'status ' + r.status, body: r.body.slice(0,200)};
      }
      const d = JSON.parse(r.body);
      if (d.rt_cd !== '0') {
        if (d.msg_cd === 'EGW00201' && attempt < maxRetry) { await sleep(400 * (attempt + 1)); continue; }
        return {error: d.msg1 || d.msg_cd, body: r.body.slice(0,200)};
      }
      return {rows: d.output2 || []};
    } catch(e) {
      if (attempt < maxRetry) { await sleep(400 * (attempt + 1)); continue; }
      return {error: e.message};
    }
  }
  return {error: 'max retry exceeded'};
}

function addDays(ymd, n) {
  const d = new Date(+ymd.slice(0,4), +ymd.slice(4,6)-1, +ymd.slice(6,8));
  d.setDate(d.getDate() + n);
  return d.getFullYear() + String(d.getMonth()+1).padStart(2,'0') + String(d.getDate()).padStart(2,'0');
}

async function fetchAllDaily(code, fromYmd, toYmd, interMs = 150) {
  const all = new Map();
  let end = toYmd;
  let callCount = 0;
  while (end >= fromYmd) {
    if (callCount > 0) await sleep(interMs);
    const start = addDays(end, -140);
    const startEff = start < fromYmd ? fromYmd : start;
    const r = await fetchDailyWithRetry(code, startEff, end);
    callCount++;
    if (r.error) return {error: r.error, partial: all.size > 0};
    if (!r.rows.length) break;
    for (const row of r.rows) all.set(row.stck_bsop_date, row);
    const oldest = r.rows[r.rows.length-1].stck_bsop_date;
    if (oldest <= fromYmd) break;
    end = addDays(oldest, -1);
  }
  const sorted = [...all.values()].sort((a,b) => a.stck_bsop_date < b.stck_bsop_date ? -1 : 1);
  return {rows: sorted};
}

async function getStocks() {
  if (_stocksCache && Date.now() - _stocksCacheAt < 3600000) return _stocksCache;
  const r = await httpReq({
    hostname: 'raw.githubusercontent.com', port: 443,
    path: '/neo9999999999/neo-score/main/data/stocks.json', method: 'GET',
    headers: {'Accept':'application/json'}
  });
  if (r.status !== 200) throw new Error('stocks.json fetch status ' + r.status);
  _stocksCache = JSON.parse(r.body);
  _stocksCacheAt = Date.now();
  return _stocksCache;
}

const pct = (a, b) => (a - b) / b * 100;

// 50/50 분할 + 종가 SL + 기간만료 종가 시뮬레이션
function simulate(fohlc, TP1, TP2, SL) {
  let tp1HitIdx = -1, tp2HitIdx = -1, slHitIdx = -1;
  for (let j = 0; j < fohlc.length; j++) {
    const fr = fohlc[j];
    if (tp1HitIdx < 0 && fr.h >= TP1) tp1HitIdx = j;
    if (tp2HitIdx < 0 && fr.h >= TP2) tp2HitIdx = j;
    // 종가 기준 SL
    if (slHitIdx < 0 && fr.c <= -SL) slHitIdx = j;
  }
  
  const last = fohlc[fohlc.length-1];
  const expPct = last ? last.c : 0;  // 기간만료일 종가
  const expDays = fohlc.length;
  
  let result, t, exitIdx, detail = {};
  
  // SL이 TP1보다 먼저 오면 → 전량 SL 손절 (종가)
  if (slHitIdx >= 0 && (tp1HitIdx < 0 || slHitIdx < tp1HitIdx)) {
    result = 'SL';
    t = fohlc[slHitIdx].c;  // 종가 기준 실제 손실
    exitIdx = slHitIdx;
    detail = {sl_idx: slHitIdx, sl_pct: +t.toFixed(2)};
  }
  // TP1 도달
  else if (tp1HitIdx >= 0) {
    const half1 = 0.5 * TP1;  // 고정
    
    if (tp2HitIdx >= 0) {
      // BOTH: 나머지 50% TP2 익절
      const half2 = 0.5 * TP2;
      t = half1 + half2;
      result = 'BOTH';
      exitIdx = tp2HitIdx;
      detail = {tp1_idx: tp1HitIdx, tp2_idx: tp2HitIdx, half1: +half1.toFixed(2), half2: +half2.toFixed(2)};
    } else {
      // TP1 도달 후 TP2 미도달. 나머지 50%는 TP1 이후부터 추적:
      // - 이후 종가 SL → SL로 나머지 50% 손절
      // - 그 외 → 기간만료 종가로 나머지 50% 매도
      let afterSLIdx = -1;
      for (let j = tp1HitIdx + 1; j < fohlc.length; j++) {
        if (fohlc[j].c <= -SL) { afterSLIdx = j; break; }
      }
      
      if (afterSLIdx >= 0) {
        // TP1 + 이후 SL
        const half2 = fohlc[afterSLIdx].c;  // 종가
        t = half1 + 0.5 * half2;
        result = 'TP1_SL';
        exitIdx = afterSLIdx;
        detail = {tp1_idx: tp1HitIdx, sl_after_idx: afterSLIdx, half1: +half1.toFixed(2), half2: +(0.5*half2).toFixed(2)};
      } else {
        // TP1 + 기간만료
        const half2 = expPct;
        t = half1 + 0.5 * half2;
        result = 'TP1';  // TP1만 도달, 나머지 기간만료
        exitIdx = fohlc.length - 1;
        detail = {tp1_idx: tp1HitIdx, half1: +half1.toFixed(2), half2: +(0.5*half2).toFixed(2)};
      }
    }
  }
  // SL도 TP1도 없으면 기간만료
  else {
    result = 'TO';
    t = expPct;
    exitIdx = fohlc.length - 1;
    detail = {exp_pct: +expPct.toFixed(2)};
  }
  
  return {
    result,
    t: +t.toFixed(2),
    tp1_idx: tp1HitIdx,
    tp2_idx: tp2HitIdx,
    sl_idx: slHitIdx,
    exit_idx: exitIdx,
    tp1_date: tp1HitIdx >= 0 ? fohlc[tp1HitIdx].d : null,
    tp2_date: tp2HitIdx >= 0 ? fohlc[tp2HitIdx].d : null,
    sl_date: slHitIdx >= 0 ? fohlc[slHitIdx].d : null,
    exit_date: exitIdx >= 0 ? fohlc[exitIdx].d : null,
    tp1_days: tp1HitIdx >= 0 ? tp1HitIdx + 1 : null,
    tp2_days: tp2HitIdx >= 0 ? tp2HitIdx + 1 : null,
    sl_days: slHitIdx >= 0 ? slHitIdx + 1 : null,
    exit_days: exitIdx >= 0 ? exitIdx + 1 : null,
    detail
  };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!AK || !SK) return res.status(500).json({ok:false, error:'KIS keys missing'});

  const start = parseInt(req.query.start || '0');
  const size = Math.min(parseInt(req.query.size || '15'), 50);
  const fromYmd = req.query.from || '20230101';
  const toYmd = req.query.to || '20261231';
  const minAmount = (parseFloat(req.query.minamt || '100') * 1e8);
  const minChg = parseFloat(req.query.minchg || '10');
  const maxChg = parseFloat(req.query.maxchg || '29.5');  // 상한가 제외
  const lookahead = parseInt(req.query.la || '20');

  try {
    const stocksDoc = await getStocks();
    const stocks = stocksDoc.stocks.slice(start, start + size);
    const signals = [];
    const errors = [];

    for (const s of stocks) {
      const r = await fetchAllDaily(s.code, fromYmd, toYmd, 150);
      if (r.error) {
        errors.push({code:s.code, name:s.name, error:r.error, partial:r.partial});
        await sleep(300);
        continue;
      }
      const rows = r.rows;
      for (let i = 1; i < rows.length; i++) {
        const prev = rows[i-1];
        const cur = rows[i];
        const prevClose = +prev.stck_clpr;
        const curClose = +cur.stck_clpr;
        if (!prevClose || !curClose) continue;
        const chg = pct(curClose, prevClose);
        if (chg < minChg) continue;
        if (chg >= maxChg) continue;  // 상한가 제외
        const amount = +cur.acml_tr_pbmn;
        if (amount < minAmount) continue;

        // future OHLC in % from curClose
        const futureRows = rows.slice(i+1, i+1+lookahead);
        const fohlc = futureRows.map(fr => ({
          d: fr.stck_bsop_date,
          o: +pct(+fr.stck_oprc, curClose).toFixed(2),
          h: +pct(+fr.stck_hgpr, curClose).toFixed(2),
          l: +pct(+fr.stck_lwpr, curClose).toFixed(2),
          c: +pct(+fr.stck_clpr, curClose).toFixed(2)
        }));
        
        // 기본 TP/SL 시뮬 (25/100/10)
        const sim = simulate(fohlc, 25, 100, 10);
        
        // peak/trough
        let peak = 0, trough = 0;
        for (const fr of fohlc) {
          if (fr.h > peak) peak = fr.h;
          if (fr.l < trough) trough = fr.l;
        }

        signals.push({
          code: s.code, name: s.name, market: s.market,
          date: cur.stck_bsop_date,
          open: +cur.stck_oprc, high: +cur.stck_hgpr, low: +cur.stck_lwpr,
          close: curClose, prev_close: prevClose,
          change_pct: +chg.toFixed(2),
          volume: +cur.acml_vol, amount,
          peak_pct: +peak.toFixed(2),
          trough_pct: +trough.toFixed(2),
          // 새 필드
          result: sim.result,
          t: sim.t,
          tp1_date: sim.tp1_date, tp2_date: sim.tp2_date,
          sl_date: sim.sl_date, exit_date: sim.exit_date,
          tp1_days: sim.tp1_days, tp2_days: sim.tp2_days,
          sl_days: sim.sl_days, exit_days: sim.exit_days,
          // future OHLC 배열 (앱에서 cTP 변경 시 재시뮬)
          future: fohlc
        });
      }
    }

    return res.status(200).json({
      ok: true, start, size,
      total_stocks: stocksDoc.stocks.length,
      signals, errors,
      count: signals.length
    });
  } catch(e) {
    return res.status(500).json({ok:false, error: e.message});
  }
};
