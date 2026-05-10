// Backfill — signals.json의 from~to 범위 종목들의 D-1~D+20 일봉 OHLC 가져와서
// data.js R 형식으로 변환 (D당일 종가 기준 % 변동)
// GET /api/backfill?from=YYYYMMDD&to=YYYYMMDD&out=json|js
const https = require("https");
const AK = process.env.KIS_APP_KEY;
const AS = process.env.KIS_APP_SECRET;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const KIS_HOST = "openapi.koreainvestment.com";
const KIS_PORT = 9443;
const GH_OWNER = "neo9999999999", GH_REPO = "sector-api";
const SIGNALS_PATH = "data/signals.json";
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
function rqGH(method, path, body) {
  const data = body ? JSON.stringify(body) : null;
  return rqHttps({
    hostname: "api.github.com", path, method,
    headers: {
      "Authorization": "token " + GITHUB_TOKEN,
      "Content-Type": "application/json",
      "User-Agent": "neo-score",
      "Content-Length": data ? Buffer.byteLength(data) : 0
    }
  }, data).then(r => {
    try { return JSON.parse(r.body.toString('utf-8')); }
    catch (e) { return { _raw: r.body.toString().slice(0, 200) }; }
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

// KIS 일봉 (날짜 범위) — 130개씩 한 번에 가능
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
    // output2[0] = 가장 최근, 시간 오름차순으로 변환
    return r.output2.map(d => ({
      date: d.stck_bsop_date,  // YYYYMMDD
      o: +d.stck_oprc || 0,
      h: +d.stck_hgpr || 0,
      l: +d.stck_lwpr || 0,
      c: +d.stck_clpr || 0,
      v: +d.acml_vol || 0
    })).filter(b => b.c > 0).sort((a, b) => a.date.localeCompare(b.date));
  } catch (e) { return []; }
}

// signal_date(YYYYMMDD) 기준 D-1 종가를 entry로 잡고, D~D+20 일봉 OHLC를 % 변동률로 변환
// 출력: "20260418:o,h,l,c;20260421:o,h,l,c;..."
function buildOhlcStr(bars, signalYMD) {
  if (!bars.length) return '';
  // signalYMD 인덱스 찾기
  const idx = bars.findIndex(b => b.date >= signalYMD);
  if (idx <= 0) return '';
  const entryClose = bars[idx].c;  // D당일 종가 = 매수 기준
  if (!entryClose) return '';
  // D+1 ~ D+20 (최대 20봉)
  const after = bars.slice(idx + 1, idx + 21);
  const parts = after.map(b => {
    const o = ((b.o / entryClose) - 1) * 100;
    const h = ((b.h / entryClose) - 1) * 100;
    const l = ((b.l / entryClose) - 1) * 100;
    const c = ((b.c / entryClose) - 1) * 100;
    return `${b.date}:${o.toFixed(2)},${h.toFixed(2)},${l.toFixed(2)},${c.toFixed(2)}`;
  });
  return parts.join(';');
}

async function loadSignals() {
  const r = await rqGH("GET", `/repos/${GH_OWNER}/${GH_REPO}/contents/${SIGNALS_PATH}`);
  if (!r.content) return [];
  return JSON.parse(Buffer.from(r.content, "base64").toString());
}

// signal → R 형식 배열 (data.js R_26 인덱스 0~38 호환)
function signalToRRow(s, ohlcStr) {
  const dateYY = s.signal_date.slice(2, 4) + '-' + s.signal_date.slice(4, 6) + '-' + s.signal_date.slice(6, 8);
  const mkt = s.market === 'KOSPI' ? 'KS' : (s.market === 'KOSDAQ' ? 'KO' : s.market);
  const amtStr = s.vol >= 10000 ? (s.vol / 10000).toFixed(2).replace(/\.?0+$/, '') + '兆' : s.vol + '億';
  // R 형식: [name, date, mkt, change, amt, supply, score, grade, change_dup, wick, ...]
  // 인덱스 0~38 모두 채워야 하지만, 핵심만: 0,1,2,3,4,5,6,7,9,24,25,38
  const row = new Array(39).fill('');
  row[0] = s.name;
  row[1] = dateYY;
  row[2] = mkt;
  row[3] = +s.rate || 0;
  row[4] = (s.vol || 0) + '億';
  row[5] = s.supply || '';
  row[6] = +s.score || 0;
  row[7] = s.grade || 'X';
  row[8] = +s.rate || 0;  // change_dup
  row[9] = +s.wick || 0;
  row[10] = 0; // amount
  row[11] = 0; row[12] = 0;
  row[13] = +s.tp1 || 15; row[14] = +s.tp2 || 50; row[15] = +s.sl || 13;
  row[16] = 0; row[17] = 0;
  row[18] = 0; // 수익률 — backfill 시점에 계산 필요시 ohlc로
  row[19] = ''; row[20] = ''; row[21] = '';
  row[22] = 0; row[23] = 0;
  row[24] = +s.h60 || 0;
  row[25] = +s.h120 || 0;
  row[26] = 0; row[27] = 0;
  row[28] = ''; row[29] = ''; row[30] = ''; row[31] = '';
  row[32] = 0; row[33] = 0; row[34] = 0;
  row[35] = ''; row[36] = 0; row[37] = 0;
  row[38] = ohlcStr;
  return row;
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const fromYMD = url.searchParams.get("from") || "20260418";
    const toYMD = url.searchParams.get("to") || (() => {
      const t = new Date(Date.now() + 9 * 3600000);
      return t.getFullYear() + String(t.getMonth() + 1).padStart(2, "0") + String(t.getDate()).padStart(2, "0");
    })();
    const outFmt = url.searchParams.get("out") || "json";

    const signals = await loadSignals();
    const filt = signals.filter(s => s.signal_date >= fromYMD && s.signal_date <= toYMD);
    if (!filt.length) return res.status(200).json({ ok: false, msg: "no signals", from: fromYMD, to: toYMD });

    // 종목별 그룹 (같은 코드는 한 번만 KIS 호출)
    const byCode = {};
    for (const s of filt) {
      if (!byCode[s.code]) byCode[s.code] = [];
      byCode[s.code].push(s);
    }
    const codes = Object.keys(byCode);

    const tk = await tok();
    // OHLC 가져올 범위: from-3일 ~ to+25일 (D-1 entry 기준 D+20)
    const fromExtRange = String(+fromYMD - 5);  // 단순 -5일
    const toExtRange = (() => {
      const d = new Date(toYMD.slice(0, 4), +toYMD.slice(4, 6) - 1, +toYMD.slice(6, 8));
      d.setDate(d.getDate() + 30);
      return d.getFullYear() + String(d.getMonth() + 1).padStart(2, "0") + String(d.getDate()).padStart(2, "0");
    })();

    const rows = [];
    const errors = [];
    for (const code of codes) {
      try {
        const bars = await fetchDaily(tk, code, fromExtRange, toExtRange);
        if (!bars.length) { errors.push(code + ":no-bars"); await w(80); continue; }
        for (const s of byCode[code]) {
          const ohlcStr = buildOhlcStr(bars, s.signal_date);
          if (!ohlcStr) { errors.push(code + "/" + s.signal_date + ":no-ohlc"); continue; }
          rows.push(signalToRRow(s, ohlcStr));
        }
      } catch (e) { errors.push(code + ":" + e.message.slice(0, 60)); }
      await w(80);
    }

    // 정렬: 날짜 내림차순 (R_26은 최신 위로)
    rows.sort((a, b) => String(b[1]).localeCompare(String(a[1])));

    if (outFmt === "js") {
      // JS 배열 리터럴 형식 (data.js R_26 prepend용)
      const lines = rows.map(r => JSON.stringify(r));
      const out = lines.join(',\n');
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      return res.status(200).send(out);
    }

    return res.status(200).json({
      ok: true,
      from: fromYMD, to: toYMD,
      requested_codes: codes.length,
      total_signals: filt.length,
      rows_built: rows.length,
      errors: errors.length ? errors : undefined,
      rows
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
};
