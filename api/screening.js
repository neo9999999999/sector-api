// Screening — Naver Finance 상승률 상위 전체 스캔 + KIS 투자자별 데이터 enrich
const https = require("https");
const AK = process.env.KIS_APP_KEY;
const AS = process.env.KIS_APP_SECRET;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const KIS_HOST = "openapi.koreainvestment.com";
const KIS_PORT = 9443;
const GH_OWNER = "neo9999999999", GH_REPO = "sector-api", SIGNALS_PATH = "data/signals.json";
let _tk = null, _te = 0;

// ─────────────────────────────────────────────────────────
// Common helpers
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
function decodeEucKr(buf) {
  try { return new TextDecoder('euc-kr').decode(buf); }
  catch (e) { return buf.toString('latin1'); }
}
function w(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─────────────────────────────────────────────────────────
// KIS token
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

// ─────────────────────────────────────────────────────────
// Naver Finance — 상승률 상위 페이지 스크랩
async function fetchNaverPage(sosok, page) {
  const r = await rqHttps({
    hostname: 'finance.naver.com', port: 443,
    path: `/sise/sise_rise.naver?sosok=${sosok}&page=${page}`,
    method: 'GET',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0',
      'Accept': 'text/html',
      'Accept-Language': 'ko-KR,ko;q=0.9'
    }
  });
  return decodeEucKr(r.body);
}
function parseNaverRise(html, marketName) {
  // Each row: <a code="XXXXXX">name</a> ... close ... change_won ... change% ... volume
  // Match approximately
  const rows = [];
  const re = /<a href="\/item\/main\.naver\?code=(\d{6})"[^>]*class="tltle"[^>]*>([^<]+)<\/a>[\s\S]*?<td class="number">\s*([\d,]+)\s*<\/td>[\s\S]*?<td class="number">[\s\S]*?<\/td>\s*<td class="number">[\s\S]*?<span class="tah[^"]*"[^>]*>\s*([+\-]?[\d.]+)%\s*<\/span>[\s\S]*?<td class="number">\s*([\d,]+)\s*<\/td>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const code = m[1];
    const name = m[2].trim();
    const close = +m[3].replace(/,/g, '');
    const change = +m[4];
    const volume = +m[5].replace(/,/g, '');
    if (code && close > 0 && volume > 0) {
      rows.push({ code, name, price: close, change, vol: volume, market: marketName });
    }
  }
  return rows;
}
async function fetchMarketAllPages(sosok, marketName, maxPages) {
  const seen = new Set();
  const all = [];
  for (let p = 1; p <= maxPages; p++) {
    try {
      const html = await fetchNaverPage(sosok, p);
      const rows = parseNaverRise(html, marketName);
      if (rows.length === 0) break;
      let added = 0;
      for (const r of rows) {
        if (!seen.has(r.code)) { seen.add(r.code); all.push(r); added++; }
      }
      if (added === 0) break;  // no new stocks → end
    } catch (e) { break; }
  }
  return all;
}

// ─────────────────────────────────────────────────────────
// KIS — investor info enrichment
//   1) inquire-price: 시가/고가/저가/거래대금
//   2) inquire-investor: 기관(orgn) / 외국인(frgn) 순매수 수량 (당일)
async function enrichInvestor(tk, stock) {
  let priceData = {};
  let invData = { inst: 0, frgn: 0 };
  let progData = { prog: 0 };
  // 1) Price/amount + 프로그램 순매수 (당일)
  try {
    const rp = await rqKis("GET",
      "/uapi/domestic-stock/v1/quotations/inquire-price?" +
      new URLSearchParams({ FID_COND_MRKT_DIV_CODE: "J", FID_INPUT_ISCD: stock.code }).toString(),
      { authorization: "Bearer " + tk, appkey: AK, appsecret: AS, tr_id: "FHKST01010100", custtype: "P" }
    );
    if (rp.output) {
      const o = rp.output;
      priceData = {
        open: +o.stck_oprc || 0,
        high: +o.stck_hgpr || 0,
        low: +o.stck_lwpr || 0,
        amt: Math.round((+o.acml_tr_pbmn || stock.price * stock.vol) / 1e8)
      };
      // 프로그램매매 순매수 (오늘 누적)
      progData.prog = +o.pgtr_ntby_qty || 0;
    }
  } catch (e) { /* skip */ }
  await w(80);
  // 2) Investor data — orgn(기관) / frgn(외국인)
  try {
    const ri = await rqKis("GET",
      "/uapi/domestic-stock/v1/quotations/inquire-investor?" +
      new URLSearchParams({ FID_COND_MRKT_DIV_CODE: "J", FID_INPUT_ISCD: stock.code }).toString(),
      { authorization: "Bearer " + tk, appkey: AK, appsecret: AS, tr_id: "FHKST01010900", custtype: "P" }
    );
    if (ri.output && ri.output.length > 0) {
      const o = ri.output[0];
      invData = {
        inst: +o.orgn_ntby_qty || 0,
        frgn: +o.frgn_ntby_qty || 0,
      };
    }
  } catch (e) { /* skip */ }
  return {
    ...stock,
    open: priceData.open || 0,
    high: priceData.high || 0,
    low: priceData.low || 0,
    amt: priceData.amt || Math.round((stock.price * stock.vol) / 1e8),
    inst: invData.inst,
    frgn: invData.frgn,
    prog: progData.prog   // 프로그램 순매수 (오늘 누적)
  };
}

// ─────────────────────────────────────────────────────────
// Score / classify
function score(s) {
  let sc = 0;
  const inv = s.inst > 0 && s.frgn > 0 ? "both" : s.frgn > 0 ? "frgn" : s.inst > 0 ? "inst" : "none";
  if (inv === "both") sc += 3;
  else if (inv === "frgn") sc += 2;
  const wk = s.high > 0 && s.price > 0 ? (s.high - s.price) / s.price * 100 : 0;
  if (wk <= 0.5) sc += 2;
  else if (wk <= 2) sc += 1;
  else if (wk >= 7) sc -= 1;
  if (s.amt > 0 && s.amt < 200) sc += 2;
  else if (s.amt < 500) sc += 1;
  else if (s.amt >= 1500) sc -= 1;
  if (s.change >= 25) sc += 2;
  else if (s.change >= 20) sc += 1;
  if (s.market === "KOSDAQ") sc += 1;
  const etf = ["KODEX", "TIGER", "RISE", "ACE", "SOL", "KIWOOM", "KOSEF", "HANARO", "ETN"]
    .some(k => (s.name || "").indexOf(k) >= 0);
  if (etf) sc -= 3;
  if (s.change > 0 && s.change <= 13) sc += 2;
  if (s.change >= 15) sc -= 1;
  sc = Math.max(sc, 0);
  const g = sc >= 9 ? "S" : sc >= 7 ? "A" : sc >= 5 ? "B" : "X";
  const invL = inv === "both" ? "기+외" : inv === "frgn" ? "외인" : inv === "inst" ? "기관" : "없음";
  return {
    code: s.code, name: s.name, price: s.price, change: s.change,
    amount: s.amt, market: s.market,
    open: s.open, high: s.high, low: s.low, volume: s.vol,
    score: sc, grade: g,
    tp1: g === "B" ? 12 : 15, tp2: 50, sl: 13,
    investor: invL,
    wick: Math.round(wk * 10) / 10,
    etf, inst: s.inst, frgn: s.frgn,
    prog: s.prog || 0   // 프로그램 순매수 수량 (오늘 누적)
  };
}

// ─────────────────────────────────────────────────────────
// GitHub save
async function saveSignals(signals, today) {
  if (!GITHUB_TOKEN || !signals.length) return { saved: false, reason: "no token or no signals" };
  try {
    const existing = { signals: [], sha: null };
    const r = await rqGH("GET", "/repos/" + GH_OWNER + "/" + GH_REPO + "/contents/" + SIGNALS_PATH);
    if (r.content) {
      existing.signals = JSON.parse(Buffer.from(r.content, "base64").toString());
      existing.sha = r.sha;
    }
    const existingByKey = new Map(existing.signals.map(s => [s.code + "_" + s.signal_date, s]));
    let added = 0, updated = 0;
    signals.filter(s => s.grade !== "X").forEach(s => {
      const key = s.code + "_" + today;
      const ex = existingByKey.get(key);
      if (!ex) {
        existing.signals.unshift({
          id: Date.now() + "_" + s.code,
          code: s.code, name: s.name, signal_date: today,
          entry_price: s.price, rate: s.change, score: s.score, grade: s.grade,
          supply: s.investor, wick: s.wick, vol: s.amount, market: s.market,
          tp1: s.tp1, tp2: s.tp2, sl: s.sl, outcome: null,
          inst: s.inst || 0, frgn: s.frgn || 0, prog: s.prog || 0,
          saved_at: new Date(Date.now() + 9 * 3600000).toISOString().replace("T", " ").slice(0, 16)
        });
        existingByKey.set(key, true);
        added++;
      } else if (ex.prog === undefined || ex.inst === undefined || ex.frgn === undefined) {
        // 기존 항목에 inst/frgn/prog 없으면 채워넣기
        ex.inst = s.inst || 0;
        ex.frgn = s.frgn || 0;
        ex.prog = s.prog || 0;
        ex.supply = s.investor;  // 수급 라벨도 새로
        updated++;
      }
    });
    if (!added && !updated) return { saved: false, reason: "all duplicates, no updates needed" };
    const content = Buffer.from(JSON.stringify(existing.signals, null, 2)).toString("base64");
    await rqGH("PUT", "/repos/" + GH_OWNER + "/" + GH_REPO + "/contents/" + SIGNALS_PATH,
      { message: "signals " + today + " (added " + added + ", updated " + updated + ")", content, ...(existing.sha ? { sha: existing.sha } : {}) });
    return { saved: true, added, updated, total: existing.signals.length };
  } catch (e) { return { saved: false, reason: e.message }; }
}

// ─────────────────────────────────────────────────────────
// Main handler
module.exports = async function (req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "*");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    // 1) Naver Finance — 전체 KOSPI/KOSDAQ 상승률 상위 (병렬)
    const [kospi, kosdaq] = await Promise.all([
      fetchMarketAllPages(0, 'KOSPI', 5),
      fetchMarketAllPages(1, 'KOSDAQ', 5)
    ]);
    const naverAll = [...kospi, ...kosdaq];

    // 2) 1차 필터 (등락 + 가격) — 거래대금은 후속 enrich 후 판단
    //    Naver volume × price로 빠른 1차 필터
    const candidates = naverAll
      .map(s => ({ ...s, amt: Math.round((s.price * s.vol) / 1e8) }))
      .filter(s => s.change >= 10 && s.change < 29 && s.price >= 1000)
      .sort((a, b) => b.change - a.change);  // 높은 등락 순

    // 3) ETF 제외 + 거래대금 ≥ 50억
    const ETF_KEYS = ["KODEX", "TIGER", "RISE", "ACE", "SOL", "KIWOOM", "KOSEF", "HANARO", "ETN"];
    const noEtf = candidates.filter(s => !ETF_KEYS.some(k => (s.name || "").indexOf(k) >= 0));
    const beforeAmtFilter = noEtf.length;
    const filtered = noEtf.filter(s => s.amt >= 50);

    // 4) KIS 투자자별 enrich (timeout 안전성: 최대 50개)
    const ENRICH_LIMIT = 50;
    const tk = await tok();
    const toEnrich = filtered.slice(0, ENRICH_LIMIT);
    const enriched = [];
    for (const s of toEnrich) {
      enriched.push(await enrichInvestor(tk, s));
      await w(120);  // KIS rate limit 안전
    }
    // Re-filter on enriched amt (since enriched amt is more accurate from KIS)
    const finalList = enriched.filter(s => (s.amt || 0) >= 50);

    // 5) Score
    const scored = finalList.map(score).filter(s => !s.etf);
    scored.sort((a, b) => b.score - a.score);

    // 6) Auto-save signals to GitHub
    const kst = new Date(Date.now() + 9 * 3600000);
    const today = kst.toISOString().slice(0, 10).replace(/-/g, "");
    let saveResult = null;
    if (GITHUB_TOKEN && scored.filter(s => s.grade !== "X").length > 0) {
      saveResult = await saveSignals(scored, today);
    }

    // 7) Response (same shape as before)
    res.status(200).json({
      ok: true,
      date: kst.toISOString().slice(0, 10),
      time: kst.toISOString().slice(11, 16),
      summary: {
        total: scored.length,
        S: scored.filter(s => s.grade === "S").length,
        A: scored.filter(s => s.grade === "A").length,
        B: scored.filter(s => s.grade === "B").length,
        X: scored.filter(s => s.grade === "X").length
      },
      signals: {
        S: scored.filter(s => s.grade === "S"),
        A: scored.filter(s => s.grade === "A"),
        B: scored.filter(s => s.grade === "B"),
        X: scored.filter(s => s.grade === "X")
      },
      all: scored,
      auto_saved: saveResult,
      debug: {
        source: "naver+kis",
        naver_kospi: kospi.length,
        naver_kosdaq: kosdaq.length,
        naver_total: naverAll.length,
        after_change_price_filter: candidates.length,
        after_etf_filter: noEtf.length,
        after_amt_filter: filtered.length,
        enriched: enriched.length,
        final: scored.length
      }
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message, stack: e.stack });
  }
};
