// Extend OHLC — 기존 R_26 종목들의 OHLC trail을 4/17 이후 일봉으로 보강
// POST /api/extend-ohlc { rows: [{name,code,date,ohlc}, ...], extendTo: "20260510" }
//   각 row의 ohlc trail에 D+(현재_봉수+1) 부터 extendTo까지 일봉 추가
//   응답: 보강된 ohlc 문자열 배열
const https = require("https");
const AK = process.env.KIS_APP_KEY;
const AS = process.env.KIS_APP_SECRET;
const KIS_HOST = "openapi.koreainvestment.com";
const KIS_PORT = 9443;
let _tk = null, _te = 0;

function rqHttps(opts, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(opts, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}
function rqKis(method, path, headers, body) {
  return rqHttps({
    hostname: KIS_HOST, port: KIS_PORT, path, method,
    headers: Object.assign({}, headers, { "Content-Type": "application/json" })
  }, body).then(r => {
    try { return JSON.parse(r.body.toString('utf-8')); }
    catch (e) { throw new Error(r.body.toString().slice(0, 200)); }
  });
}
function w(ms) { return new Promise(r => setTimeout(r, ms)); }
async function tok() {
  if (_tk && Date.now() < _te) return _tk;
  const r = await rqKis("POST", "/oauth2/tokenP", {}, {
    grant_type: "client_credentials", appkey: AK, appsecret: AS
  });
  if (!r.access_token) throw new Error("Tok:" + JSON.stringify(r).slice(0, 200));
  _tk = r.access_token;
  _te = Date.now() + 86300000;
  return _tk;
}

async function fetchDaily(tk, code, fromYMD, toYMD) {
  try {
    const r = await rqKis("GET",
      "/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice?" +
      new URLSearchParams({
        FID_COND_MRKT_DIV_CODE: "J", FID_INPUT_ISCD: code,
        FID_INPUT_DATE_1: fromYMD, FID_INPUT_DATE_2: toYMD,
        FID_PERIOD_DIV_CODE: "D", FID_ORG_ADJ_PRC: "0"
      }).toString(),
      { authorization: "Bearer " + tk, appkey: AK, appsecret: AS, tr_id: "FHKST03010100", custtype: "P" }
    );
    if (!r.output2 || !r.output2.length) return [];
    return r.output2.map(d => ({
      date: d.stck_bsop_date,
      o: +d.stck_oprc || 0, h: +d.stck_hgpr || 0,
      l: +d.stck_lwpr || 0, c: +d.stck_clpr || 0
    })).filter(b => b.c > 0).sort((a, b) => a.date.localeCompare(b.date));
  } catch (e) { return []; }
}

async function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString())); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, err: "POST only" });
  try {
    const body = await readBody(req);
    const rows = body.rows || []; // [{name, code, date(YY-MM-DD), ohlc, entryClose}]
    const extendTo = body.extendTo || "20260510";
    if (!rows.length) return res.status(200).json({ ok: false, msg: "no rows" });

    const tk = await tok();
    const out = [];
    const errors = [];

    // 종목 코드별 그룹핑 (같은 코드 한 번만 KIS 호출)
    const codeBars = new Map();

    for (const row of rows) {
      try {
        const code = row.code;
        const sigYMD = '20' + (row.date || '').replace(/-/g, '');
        if (!code || !/^\d{6}$/.test(code)) { errors.push(row.name + ":invalid-code"); out.push({ name: row.name, ohlc: row.ohlc, err: 'invalid-code' }); continue; }

        // KIS 호출 (종목 코드별 캐싱)
        let bars;
        const cacheKey = code + '_' + sigYMD;
        if (codeBars.has(cacheKey)) bars = codeBars.get(cacheKey);
        else {
          // 발화일 ~ extendTo
          bars = await fetchDaily(tk, code, sigYMD, extendTo);
          codeBars.set(cacheKey, bars);
          await w(80);
        }
        if (!bars.length) { errors.push(code + ":no-bars"); out.push({ name: row.name, ohlc: row.ohlc, err: 'no-bars' }); continue; }

        // 발화일 종가 = entry
        const entryBar = bars.find(b => b.date === sigYMD);
        if (!entryBar) { errors.push(code + ":no-entry-day"); out.push({ name: row.name, ohlc: row.ohlc, err: 'no-entry' }); continue; }
        const entryClose = entryBar.c;

        // 발화일 다음날부터 ~ extendTo
        const after = bars.filter(b => b.date > sigYMD);
        const newOhlcParts = after.map(b => {
          const o = ((b.o / entryClose) - 1) * 100;
          const h = ((b.h / entryClose) - 1) * 100;
          const l = ((b.l / entryClose) - 1) * 100;
          const c = ((b.c / entryClose) - 1) * 100;
          return `${b.date}:${o.toFixed(2)},${h.toFixed(2)},${l.toFixed(2)},${c.toFixed(2)}`;
        });
        const newOhlc = newOhlcParts.join(';');

        out.push({ name: row.name, code, date: row.date, ohlc: newOhlc, bars_added: after.length });
      } catch (e) {
        errors.push(row.name + ":" + e.message.slice(0, 60));
        out.push({ name: row.name, ohlc: row.ohlc, err: e.message.slice(0, 80) });
      }
    }

    return res.status(200).json({
      ok: true,
      total: rows.length,
      processed: out.filter(x => !x.err).length,
      errors: errors.length ? errors.slice(0, 30) : undefined,
      results: out
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
};
