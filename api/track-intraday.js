// Track Intraday — 추적 중인 종목들의 분봉을 매일 누적 저장
// signals.json의 발화 후 D+1 ~ D+20 영업일 동안 매일 분봉 수집
// 저장: data/tracking/{code}_{signal_date}.json
//
// GET /api/track-intraday[?date=YYYYMMDD]  ← 매일 cron 호출
//   date 미지정시 오늘. 추적 중인 모든 종목의 그날 분봉 수집.

const https = require("https");
const AK = process.env.KIS_APP_KEY;
const AS = process.env.KIS_APP_SECRET;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const KIS_HOST = "openapi.koreainvestment.com";
const KIS_PORT = 9443;
const GH_OWNER = "neo9999999999", GH_REPO = "sector-api";
const SIGNALS_PATH = "data/signals.json";
const MAX_TRACK_DAYS = 20; // D+1 ~ D+20 영업일 추적
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

// 1분봉 30개씩 — 09:00~15:30 전체 (13 batches)
async function fetchMinuteBars(tk, code) {
  const out = [];
  const hours = ["153000", "150000", "143000", "140000", "133000", "130000", "123000", "120000", "113000", "110000", "103000", "100000", "093000"];
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
            t: b.stck_cntg_hour,
            o: +b.stck_oprc || 0,
            h: +b.stck_hgpr || 0,
            l: +b.stck_lwpr || 0,
            c: +b.stck_prpr || 0,
            v: +b.cntg_vol || 0
          });
        }
      }
    } catch (e) { /* skip */ }
    await w(60);
  }
  // 시간 오름차순 + 중복 제거
  const seen = new Set();
  return out.filter(x => { if (seen.has(x.t)) return false; seen.add(x.t); return true; })
    .sort((a, b) => (a.t > b.t ? 1 : -1));
}

async function loadSignals() {
  const r = await rqGH("GET", `/repos/${GH_OWNER}/${GH_REPO}/contents/${SIGNALS_PATH}`);
  if (!r.content) return [];
  return JSON.parse(Buffer.from(r.content, "base64").toString());
}

// YMD 영업일 차이 (간이 — 토일만 제외, 공휴일 무시)
function bdaysDiff(fromYMD, toYMD) {
  const f = new Date(fromYMD.slice(0, 4), +fromYMD.slice(4, 6) - 1, +fromYMD.slice(6, 8));
  const t = new Date(toYMD.slice(0, 4), +toYMD.slice(4, 6) - 1, +toYMD.slice(6, 8));
  let n = 0;
  const cur = new Date(f);
  while (cur < t) {
    cur.setDate(cur.getDate() + 1);
    const day = cur.getDay();
    if (day !== 0 && day !== 6) n++;
  }
  return n;
}

// 종목별 추적 파일 read/write
async function loadTrack(code, signalDate) {
  const path = `data/tracking/${code}_${signalDate}.json`;
  const r = await rqGH("GET", `/repos/${GH_OWNER}/${GH_REPO}/contents/${path}`);
  if (r.content) {
    return {
      data: JSON.parse(Buffer.from(r.content, "base64").toString()),
      sha: r.sha
    };
  }
  return { data: null, sha: null };
}

async function saveTrack(code, signalDate, data, sha) {
  const path = `data/tracking/${code}_${signalDate}.json`;
  const body = {
    message: `track ${code} ${signalDate} (${Object.keys(data.bars || {}).length} days)`,
    content: Buffer.from(JSON.stringify(data, null, 0)).toString("base64"),
    branch: "main"
  };
  if (sha) body.sha = sha;
  return await rqGH("PUT", `/repos/${GH_OWNER}/${GH_REPO}/contents/${path}`, body);
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const kst = new Date(Date.now() + 9 * 3600000);
    const todayYMD = url.searchParams.get("date") ||
      (kst.getFullYear() + String(kst.getMonth() + 1).padStart(2, "0") + String(kst.getDate()).padStart(2, "0"));

    // 1) signals.json 로드 → 최근 (today - 30일) ~ today 발화 종목만 추적 대상
    const signals = await loadSignals();
    const cutoff = (() => {
      const d = new Date(kst);
      d.setDate(d.getDate() - 30);
      return d.getFullYear() + String(d.getMonth() + 1).padStart(2, "0") + String(d.getDate()).padStart(2, "0");
    })();

    const tracking = signals.filter(s => {
      if (!s.signal_date) return false;
      if (s.signal_date < cutoff) return false;
      if (s.signal_date >= todayYMD) return false; // 오늘 발화는 다음날부터 추적
      // D+N 계산 — N <= MAX_TRACK_DAYS인 경우만
      const dN = bdaysDiff(s.signal_date, todayYMD);
      return dN >= 1 && dN <= MAX_TRACK_DAYS;
    });

    if (!tracking.length) return res.status(200).json({ ok: true, msg: "no tracking targets", date: todayYMD, cutoff });

    const tk = await tok();
    let updated = 0;
    const errors = [];
    const codeSet = new Map();  // code -> bars (한 번만 fetch)

    for (const s of tracking) {
      try {
        let bars;
        if (codeSet.has(s.code)) bars = codeSet.get(s.code);
        else {
          bars = await fetchMinuteBars(tk, s.code);
          codeSet.set(s.code, bars);
          await w(50);
        }
        if (!bars.length) { errors.push(s.code + "_" + s.signal_date + ":no-bars"); continue; }

        // 추적 파일 로드 또는 생성
        const { data, sha } = await loadTrack(s.code, s.signal_date);
        const trackData = data || {
          code: s.code, name: s.name, signal_date: s.signal_date,
          entry_price: s.entry_price, market: s.market,
          rate: s.rate, vol: s.vol, supply: s.supply,
          bars: {}, status: 'tracking'
        };

        // 그날 분봉 저장 (이미 있으면 덮어씀)
        trackData.bars[todayYMD] = bars;
        trackData.last_update = new Date(Date.now() + 9 * 3600000).toISOString().replace("T", " ").slice(0, 16);

        // 만기 체크
        const dN = bdaysDiff(s.signal_date, todayYMD);
        if (dN >= MAX_TRACK_DAYS) trackData.status = 'closed';

        await saveTrack(s.code, s.signal_date, trackData, sha);
        await w(100);
        updated++;
      } catch (e) {
        errors.push(s.code + ":" + e.message.slice(0, 60));
      }
    }

    return res.status(200).json({
      ok: true,
      date: todayYMD,
      cutoff,
      tracking_count: tracking.length,
      unique_codes: codeSet.size,
      updated,
      errors: errors.length ? errors.slice(0, 20) : undefined
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
};
