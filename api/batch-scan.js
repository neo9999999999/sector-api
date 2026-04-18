// api/batch-scan.js v2 — rate-limit safe + retry
const https = require('https');

const KIS_HOST = 'openapi.koreainvestment.com';
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
    req.setTimeout(15000, () => { req.destroy(new Error('timeout')); });
    if (body) req.write(body);
    req.end();
  });
}

async function getToken() {
  if (_token && Date.now() < _tokenExp) return _token;
  const body = JSON.stringify({grant_type:'client_credentials', appkey:AK, appsecret:SK});
  const r = await httpReq({
    hostname: KIS_HOST, port: 443, path: '/oauth2/tokenP', method: 'POST',
    headers: {'Content-Type':'application/json', 'Content-Length': Buffer.byteLength(body)}
  }, body);
  const d = JSON.parse(r.body);
  if (!d.access_token) throw new Error('token fail: ' + r.body.slice(0,200));
  _token = d.access_token;
  _tokenExp = Date.now() + 23 * 3600 * 1000;
  return _token;
}

// KIS 호출에 rate limit 대응 (EGW00201 시 재시도)
async function fetchDailyWithRetry(code, startYmd, endYmd, maxRetry = 3) {
  const token = await getToken();
  const path = '/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice' +
    '?FID_COND_MRKT_DIV_CODE=J' +
    '&FID_INPUT_ISCD=' + code +
    '&FID_INPUT_DATE_1=' + startYmd +
    '&FID_INPUT_DATE_2=' + endYmd +
    '&FID_PERIOD_DIV_CODE=D' +
    '&FID_ORG_ADJ_PRC=1';

  for (let attempt = 0; attempt <= maxRetry; attempt++) {
    try {
      const r = await httpReq({
        hostname: KIS_HOST, port: 443, path, method: 'GET',
        headers: {
          'Content-Type':'application/json; charset=utf-8',
          'authorization': 'Bearer ' + token,
          'appkey': AK, 'appsecret': SK,
          'tr_id': 'FHKST03010100', 'custtype': 'P'
        }
      });
      if (r.status !== 200) {
        if (r.body.includes('EGW00201') && attempt < maxRetry) {
          await sleep(500 * (attempt + 1));
          continue;
        }
        return {error: 'status ' + r.status, body: r.body.slice(0,200)};
      }
      const d = JSON.parse(r.body);
      if (d.rt_cd === '1') {
        if (d.msg_cd === 'EGW00201' && attempt < maxRetry) {
          await sleep(500 * (attempt + 1));
          continue;
        }
        return {error: d.msg1 || d.msg_cd, body: r.body.slice(0,200)};
      }
      return {rows: d.output2 || []};
    } catch(e) {
      if (attempt < maxRetry) { await sleep(500 * (attempt + 1)); continue; }
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

async function fetchAllDaily(code, fromYmd, toYmd, interCallDelayMs = 120) {
  const all = new Map();
  let end = toYmd;
  let callCount = 0;
  while (end >= fromYmd) {
    if (callCount > 0) await sleep(interCallDelayMs);  // 같은 종목 내 연속 호출 간격
    const start = addDays(end, -140);
    const startEff = start < fromYmd ? fromYmd : start;
    const r = await fetchDailyWithRetry(code, startEff, end);
    callCount++;
    if (r.error) return {error: r.error, partial: all.size};
    if (!r.rows || r.rows.length === 0) break;
    for (const row of r.rows) {
      const d = row.stck_bsop_date;
      if (!all.has(d) && d >= fromYmd && d <= toYmd) all.set(d, row);
    }
    const oldest = r.rows[r.rows.length - 1].stck_bsop_date;
    if (oldest <= fromYmd) break;
    end = addDays(oldest, -1);
  }
  const sorted = [...all.entries()].sort((a,b) => a[0] < b[0] ? -1 : 1).map(([,v]) => v);
  return {rows: sorted};
}

const pct = (a, b) => (a - b) / b * 100;

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!AK || !SK) return res.status(500).json({ok:false, error:'KIS keys missing'});

  const start = parseInt(req.query.start || '0');
  const size = Math.min(parseInt(req.query.size || '20'), 50);
  const fromYmd = req.query.from || '20230101';
  const toYmd = req.query.to || '20261231';
  const minAmount = (parseFloat(req.query.minamt || '100') * 1e8);  // 억 단위
  const minChg = parseFloat(req.query.minchg || '10');

  try {
    const listResp = await httpReq({
      hostname: 'raw.githubusercontent.com', port: 443,
      path: '/neo9999999999/neo-score/main/data/stocks.json', method: 'GET',
      headers: {'Accept':'application/json'}
    });
    if (listResp.status !== 200) return res.status(502).json({ok:false, error:'stocks.json fetch', status:listResp.status});
    const stocksDoc = JSON.parse(listResp.body);
    const stocks = stocksDoc.stocks.slice(start, start + size);

    const signals = [];
    const errors = [];

    for (const s of stocks) {
      const r = await fetchAllDaily(s.code, fromYmd, toYmd, 120);
      if (r.error) {
        errors.push({code:s.code, name:s.name, error:r.error, partial:r.partial});
        await sleep(200);  // 에러 후 쿨다운
        continue;
      }
      const rows = r.rows;
      for (let i = 1; i < rows.length; i++) {
        const prev = rows[i-1];
        const cur = rows[i];
        const prevClose = +prev.stck_clpr;
        const curClose = +cur.stck_clpr;
        const curHigh = +cur.stck_hgpr;
        const curLow = +cur.stck_lwpr;
        const curOpen = +cur.stck_oprc;
        const vol = +cur.acml_vol;
        const amount = +cur.acml_tr_pbmn;
        if (!prevClose || !curClose) continue;
        const chg = pct(curClose, prevClose);
        if (chg < minChg) continue;
        if (amount < minAmount) continue;

        const futureRows = rows.slice(i+1, i+1+20);
        let peakPct = 0, troughPct = 0;
        let tp1Hit = null, tp2Hit = null, slHit = null;
        const TP1 = 25, TP2 = 100, SL = 10;
        for (let j = 0; j < futureRows.length; j++) {
          const fr = futureRows[j];
          const fh = +fr.stck_hgpr;
          const fl = +fr.stck_lwpr;
          const hPct = pct(fh, curClose);
          const lPct = pct(fl, curClose);
          if (hPct > peakPct) peakPct = hPct;
          if (lPct < troughPct) troughPct = lPct;
          if (!tp1Hit && hPct >= TP1) tp1Hit = fr.stck_bsop_date;
          if (!tp2Hit && hPct >= TP2) tp2Hit = fr.stck_bsop_date;
          if (!slHit && lPct <= -SL) slHit = fr.stck_bsop_date;
        }
        let result = 'TO';
        if (tp1Hit && tp2Hit) result = 'BOTH';
        else if (tp1Hit && !slHit) result = 'TP1';
        else if (slHit && !tp1Hit) result = 'SL';
        else if (tp1Hit && slHit) result = tp1Hit <= slHit ? 'TP1' : 'SL';

        signals.push({
          code: s.code, name: s.name, market: s.market,
          date: cur.stck_bsop_date,
          open: curOpen, high: curHigh, low: curLow, close: curClose, prev_close: prevClose,
          change_pct: +chg.toFixed(2),
          volume: vol, amount,
          peak_pct: +peakPct.toFixed(2),
          trough_pct: +troughPct.toFixed(2),
          tp1_date: tp1Hit, tp2_date: tp2Hit, sl_date: slHit,
          result
        });
      }
    }

    return res.status(200).json({
      ok: true,
      start, size,
      total_stocks: stocksDoc.stocks.length,
      processed: stocks.length,
      next_start: start + size < stocksDoc.stocks.length ? start + size : null,
      signals_count: signals.length,
      errors_count: errors.length,
      signals,
      errors
    });
  } catch(e) {
    return res.status(500).json({ok:false, error:e.message, stack:(e.stack||'').slice(0,400)});
  }
};
