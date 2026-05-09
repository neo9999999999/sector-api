// Intraday — 1분봉 수집 (네오 테마 / 트레일링 스탑 검증용 데이터 누적)
// GET /api/intraday?date=YYYYMMDD&codes=A,B,C
//   date 미지정시 오늘. codes 미지정시 signals.json의 해당일 모든 종목.
//   GitHub data/intraday/{date}.json에 누적 저장.
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

// 1분봉 30개씩 가져오기 — KIS API는 입력 시간부터 거꾸로 30개 반환
// 09:00~15:30 전체 (390분 ≒ 13 batches) — 30분 단위로 끊어서 13회 호출
async function fetchMinutes(tk, code) {
  const out = [];
  // 끝 시각부터 거꾸로 (15:30 → 15:00 → 14:30 → ...)
  // KIS는 FID_INPUT_HOUR_1 기준으로 그 이전 30분 (=30개)을 반환
  // 09:00시작 → 09:30, 10:00, ... 15:30 까지 14개 시점
  const hours = ["153000","150000","143000","140000","133000","130000","123000","120000","113000","110000","103000","100000","093000"];
  for (const h of hours) {
    try {
      const r = await rqKis("GET",
        "/uapi/domestic-stock/v1/quotations/inquire-time-itemchartprice?" +
        new URLSearchParams({
          FID_ETC_CLS_CODE: "", FID_COND_MRKT_DIV_CODE: "J",
          FID_INPUT_ISCD: code, FID_INPUT_HOUR_1: h,
          FID_PW_DATA_INCU_YN: "N"
        }).toString(),
        { authorization: "Bearer " + tk, appkey: AK, appsecret: AS, tr_id: "FHKST03010200", custtype: "P" }
      );
      if (r.output2 && r.output2.length) {
        for (const b of r.output2) {
          if (!b.stck_cntg_hour) continue;
          out.push({
            t: b.stck_cntg_hour,            // 체결시간 HHMMSS
            o: +b.stck_oprc || 0,
            h: +b.stck_hgpr || 0,
            l: +b.stck_lwpr || 0,
            c: +b.stck_prpr || 0,
            v: +b.cntg_vol || 0
          });
        }
      }
    } catch (e) { /* 한 batch 실패해도 다음 진행 */ }
    await w(60); // KIS rate limit
  }
  // 시간 오름차순 정렬, 중복 제거
  const seen = new Set();
  return out
    .filter(x => { if (seen.has(x.t)) return false; seen.add(x.t); return true; })
    .sort((a, b) => (a.t > b.t ? 1 : -1));
}

async function loadSignals() {
  const r = await rqGH("GET", `/repos/${GH_OWNER}/${GH_REPO}/contents/${SIGNALS_PATH}`);
  if (!r.content) return { signals: [], sha: null };
  return {
    signals: JSON.parse(Buffer.from(r.content, "base64").toString()),
    sha: r.sha
  };
}

async function saveIntraday(dateYYYYMMDD, dataObj) {
  const path = `data/intraday/${dateYYYYMMDD}.json`;
  // 기존 파일 가져오기 (있으면 merge)
  let existing = {}, sha = null;
  const r = await rqGH("GET", `/repos/${GH_OWNER}/${GH_REPO}/contents/${path}`);
  if (r.content) {
    try { existing = JSON.parse(Buffer.from(r.content, "base64").toString()); } catch (e) {}
    sha = r.sha;
  }
  const merged = Object.assign({}, existing, dataObj);
  const body = {
    message: `intraday ${dateYYYYMMDD} (${Object.keys(dataObj).length} stocks)`,
    content: Buffer.from(JSON.stringify(merged, null, 0)).toString("base64"),
    branch: "main"
  };
  if (sha) body.sha = sha;
  const wr = await rqGH("PUT", `/repos/${GH_OWNER}/${GH_REPO}/contents/${path}`, body);
  return { ok: !!wr.content, total: Object.keys(merged).length, added: Object.keys(dataObj).length };
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    // KST 오늘
    const kst = new Date(Date.now() + 9 * 3600000);
    const todayYMD = kst.toISOString().slice(0, 10).replace(/-/g, "");
    const dateYMD = url.searchParams.get("date") || todayYMD;
    const dateYY = dateYMD.slice(2, 4) + dateYMD.slice(4, 6) + dateYMD.slice(6, 8);
    let codes = (url.searchParams.get("codes") || "").split(",").map(x => x.trim()).filter(Boolean);

    if (!codes.length) {
      // signals.json에서 dateYY와 동일한 signal_date 종목들 추출
      const { signals } = await loadSignals();
      codes = Array.from(new Set(
        signals
          .filter(s => s.signal_date === dateYY)
          .map(s => s.code)
      ));
    }
    if (!codes.length) return res.status(200).json({ ok: false, msg: "no signals for date " + dateYMD, date: dateYMD });

    const tk = await tok();
    const result = {};
    const errors = [];
    for (const code of codes) {
      try {
        const bars = await fetchMinutes(tk, code);
        if (bars.length) result[code] = bars;
      } catch (e) { errors.push(code + ":" + e.message.slice(0, 60)); }
    }
    let saveResult = null;
    if (GITHUB_TOKEN && Object.keys(result).length) {
      saveResult = await saveIntraday(dateYMD, result);
    }
    return res.status(200).json({
      ok: true,
      date: dateYMD,
      requested: codes.length,
      collected: Object.keys(result).length,
      bars_per_stock: Object.fromEntries(
        Object.entries(result).map(([c, b]) => [c, b.length])
      ),
      errors: errors.length ? errors : undefined,
      github: saveResult
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
};
