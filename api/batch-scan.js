// api/batch-scan.js — 종목 청크 × 기간 백테스트 신호 생성
// KIS inquire-daily-itemchartprice: call당 최대 100거래일
const https = require('https');

const KIS_HOST = 'openapi.koreainvestment.com';
const AK = process.env.KIS_APP_KEY;
const SK = process.env.KIS_APP_SECRET;

let _token = null;
let _tokenExp = 0;

function httpReq(opts, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(opts, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({status: res.statusCode, body: Buffer.concat(chunks).toString('utf8')}));
    });
    req.on('error', reject);
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
  _token = d.access_token;
  _tokenExp = Date.now() + 23 * 3600 * 1000;
  return _token;
}

async function fetchDaily(code, startYmd, endYmd) {
  // KOSPI는 J, KOSDAQ도 J (domestic-stock 공통)
  const token = await getToken();
  const path = '/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice' +
    '?FID_COND_MRKT_DIV_CODE=J' +
    '&FID_INPUT_ISCD=' + code +
    '&FID_INPUT_DATE_1=' + startYmd +
    '&FID_INPUT_DATE_2=' + endYmd +
    '&FID_PERIOD_DIV_CODE=D' +
    '&FID_ORG_ADJ_PRC=1';
  const r = await httpReq({
    hostname: KIS_HOST, port: 443, path, method: 'GET',
    headers: {
      'Content-Type':'application/json; charset=utf-8',
      'authorization': 'Bearer ' + token,
      'appkey': AK,
      'appsecret': SK,
      'tr_id': 'FHKST03010100',
      'custtype': 'P'
    }
  });
  if (r.status !== 200) return {error: 'status ' + r.status, body: r.body.slice(0,200)};
  try {
    const d = JSON.parse(r.body);
    // output2: 일별 데이터 배열 (역순: 최신이 첫번째)
    return {rows: d.output2 || [], output1: d.output1};
  } catch(e) {
    return {error: 'parse', body: r.body.slice(0, 200)};
  }
}

// 날짜 산술 (YYYYMMDD 문자열)
function addDays(ymd, n) {
  const d = new Date(+ymd.slice(0,4), +ymd.slice(4,6)-1, +ymd.slice(6,8));
  d.setDate(d.getDate() + n);
  return d.getFullYear() + String(d.getMonth()+1).padStart(2,'0') + String(d.getDate()).padStart(2,'0');
}

function ymdCompare(a, b) { return a < b ? -1 : a > b ? 1 : 0; }

// 종목별 전체 기간 일봉 수집 (100일씩 나눠서)
async function fetchAllDaily(code, fromYmd, toYmd) {
  const all = new Map();  // date -> row
  let end = toYmd;
  while (end >= fromYmd) {
    const start = addDays(end, -140);  // 여유 버퍼 (휴일 포함 100 영업일)
    const startEff = start < fromYmd ? fromYmd : start;
    const r = await fetchDaily(code, startEff, end);
    if (r.error) return {error: r.error};
    if (!r.rows || r.rows.length === 0) break;
    for (const row of r.rows) {
      const d = row.stck_bsop_date;
      if (!all.has(d) && d >= fromYmd && d <= toYmd) all.set(d, row);
    }
    // 가장 오래된 날짜보다 하루 이전으로
    const oldest = r.rows[r.rows.length - 1].stck_bsop_date;
    if (oldest <= fromYmd) break;
    end = addDays(oldest, -1);
  }
  // 날짜 오름차순 배열
  const sorted = [...all.entries()].sort((a,b) => ymdCompare(a[0], b[0])).map(([,v]) => v);
  return {rows: sorted};
}

function pct(a, b) { return (a - b) / b * 100; }

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!AK || !SK) return res.status(500).json({ok:false, error:'KIS keys missing'});

  const start = parseInt(req.query.start || '0');
  const size = Math.min(parseInt(req.query.size || '30'), 50);
  const fromYmd = req.query.from || '20230101';
  const toYmd = req.query.to || '20261231';

  try {
    // 1. 종목 리스트 fetch
    const listResp = await httpReq({
      hostname: 'raw.githubusercontent.com', port: 443,
      path: '/neo9999999999/neo-score/main/data/stocks.json', method: 'GET',
      headers: {'Accept':'application/json'}
    });
    if (listResp.status !== 200) return res.status(502).json({ok:false, error:'stocks.json fetch failed', status:listResp.status});
    const stocksDoc = JSON.parse(listResp.body);
    const stocks = stocksDoc.stocks.slice(start, start + size);

    const signals = [];
    const errors = [];
    const minAmount = 100e8; // 최소 거래대금 100억 (간소화 기준)

    for (const s of stocks) {
      const r = await fetchAllDaily(s.code, fromYmd, toYmd);
      if (r.error) { errors.push({code:s.code, name:s.name, error:r.error}); continue; }
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
        const amount = +cur.acml_tr_pbmn; // 거래대금 원
        if (!prevClose || !curClose) continue;
        const chg = pct(curClose, prevClose);
        if (chg < 10) continue;               // 전일비 +10% 이상만
        if (amount < minAmount) continue;     // 최소 거래대금

        // 신호일 이후 20거래일 peak/drawdown
        const futureRows = rows.slice(i+1, i+1+20);
        let peakPct = 0, troughPct = 0;
        let tp1Hit = null, tp2Hit = null, slHit = null; // 날짜 (또는 null)
        // 기본 TP/SL (S등급 기준: tp1=25, tp2=100, sl=10)
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
        // 결과 분류
        let result = 'TO'; // 기간만료 기본
        if (tp1Hit && tp2Hit) result = 'BOTH';
        else if (tp1Hit && !slHit) result = 'TP1';
        else if (slHit && !tp1Hit) result = 'SL';
        else if (tp1Hit && slHit) {
          // 어느 게 먼저인가: 날짜 비교
          result = tp1Hit <= slHit ? 'TP1' : 'SL';
        }

        signals.push({
          code: s.code,
          name: s.name,
          market: s.market,
          date: cur.stck_bsop_date,
          open: curOpen,
          high: curHigh,
          low: curLow,
          close: curClose,
          prev_close: prevClose,
          change_pct: +chg.toFixed(2),
          volume: vol,
          amount: amount,
          peak_pct: +peakPct.toFixed(2),
          trough_pct: +troughPct.toFixed(2),
          tp1_date: tp1Hit,
          tp2_date: tp2Hit,
          sl_date: slHit,
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
      errors: errors.slice(0, 10)
    });
  } catch(e) {
    return res.status(500).json({ok:false, error:e.message, stack:e.stack?.slice(0,500)});
  }
};
