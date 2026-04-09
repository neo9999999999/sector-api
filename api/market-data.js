const https = require("https");

function kisRequest(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request({
      hostname: "openapi.koreainvestment.com",
      port: 9443,
      path: path,
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) },
    }, (res) => {
      let buf = "";
      res.on("data", (c) => buf += c);
      res.on("end", () => resolve(JSON.parse(buf)));
    });
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

function kisGet(path, trId, params) {
  return new Promise((resolve, reject) => {
    const qs = new URLSearchParams(params).toString();
    const req = https.request({
      hostname: "openapi.koreainvestment.com",
      port: 9443,
      path: `${path}?${qs}`,
      method: "GET",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        authorization: `Bearer ${global._kisToken}`,
        appkey: process.env.KIS_APP_KEY,
        appsecret: process.env.KIS_APP_SECRET,
        tr_id: trId,
        custtype: "P",
      },
    }, (res) => {
      let buf = "";
      res.on("data", (c) => buf += c);
      res.on("end", () => { try { resolve(JSON.parse(buf)); } catch(e) { reject(new Error("Parse error: " + buf.slice(0,200))); } });
    });
    req.on("error", reject);
    req.end();
  });
}

async function getToken() {
  if (global._kisToken && global._kisExp > Date.now()) return global._kisToken;
  const d = await kisRequest("/oauth2/tokenP", {
    grant_type: "client_credentials",
    appkey: process.env.KIS_APP_KEY,
    appsecret: process.env.KIS_APP_SECRET,
  });
  if (!d.access_token) throw new Error("토큰 발급 실패: " + JSON.stringify(d));
  global._kisToken = d.access_token;
  global._kisExp = Date.now() + 23 * 3600000;
  return d.access_token;
}

// 거래대금 상위
async function getVolumeRank(market) {
  const d = await kisGet("/uapi/domestic-stock/v1/ranking/volume", "FHPST01710000", {
    FID_COND_MRKT_DIV_CODE: market,
    FID_COND_SCR_DIV_CODE: "20174",
    FID_INPUT_ISCD: "0000", FID_DIV_CLS_CODE: "0", FID_BLNG_CLS_CODE: "0",
    FID_TRGT_CLS_CODE: "111111111", FID_TRGT_EXLS_CLS_CODE: "000000",
    FID_INPUT_PRICE_1: "", FID_INPUT_PRICE_2: "", FID_VOL_CNT: "", FID_INPUT_DATE_1: "",
  });
  return (d.output || []).map(i => ({
    name: i.hts_kor_isnm, code: i.mksc_shrn_iscd,
    price: +i.stck_prpr, change: +i.prdy_ctrt,
    tradeAmt: +i.acml_tr_pbmn, volume: +i.acml_vol,
  }));
}

// 상승률 상위 (상한가 포함)
async function getTopGainers(market) {
  const d = await kisGet("/uapi/domestic-stock/v1/ranking/fluctuation", "FHPST01700000", {
    FID_COND_MRKT_DIV_CODE: market,
    FID_COND_SCR_DIV_CODE: "20170",
    FID_INPUT_ISCD: "0000", FID_RANK_SORT_CLS_CODE: "0",
    FID_INPUT_CNT_1: "0", FID_PRC_CLS_CODE: "0",
    FID_INPUT_PRICE_1: "", FID_INPUT_PRICE_2: "", FID_VOL_CNT: "",
    FID_TRGT_CLS_CODE: "0", FID_TRGT_EXLS_CLS_CODE: "0", FID_DIV_CLS_CODE: "0",
    FID_RSFL_RATE1: "", FID_RSFL_RATE2: "",
  });
  return (d.output || []).map(i => ({
    name: i.hts_kor_isnm, code: i.mksc_shrn_iscd,
    price: +i.stck_prpr, change: +i.prdy_ctrt,
    tradeAmt: +i.acml_tr_pbmn,
    isLimit: +i.prdy_ctrt >= 29.0,
  }));
}

function fmt(n) {
  if (!n) return "0";
  if (n >= 1e12) return (n/1e12).toFixed(2)+"조";
  if (n >= 1e8) return Math.round(n/1e8)+"억";
  return Math.round(n/1e4)+"만";
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    await getToken();

    const [volK, volQ, gainK, gainQ] = await Promise.all([
      getVolumeRank("J"), getVolumeRank("Q"),
      getTopGainers("J"), getTopGainers("Q"),
    ]);

    const allVol = [...volK, ...volQ].sort((a,b) => b.tradeAmt - a.tradeAmt).slice(0,30);
    const limitUp = [...gainK, ...gainQ].filter(s => s.isLimit);
    const topRising = [...gainK, ...gainQ].filter(s => s.change > 5 && !s.isLimit).slice(0,20);

    res.status(200).json({
      ok: true,
      date: new Date().toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" }),
      topVolume: allVol.map(s => ({ ...s, tradeAmtFmt: fmt(s.tradeAmt) })),
      limitUp: limitUp.map(s => ({ ...s, tradeAmtFmt: fmt(s.tradeAmt) })),
      topRising: topRising.map(s => ({ ...s, tradeAmtFmt: fmt(s.tradeAmt) })),
    });
  } catch(e) {
    res.status(500).json({ ok: false, error: e.message });
  }
};
