const https = require("https");

function kisPost(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request({
      hostname: "openapi.koreainvestment.com", port: 9443, path, method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) },
    }, (res) => {
      let buf = ""; res.on("data", c => buf += c);
      res.on("end", () => {
        try { resolve(JSON.parse(buf)); } catch { reject(new Error("Token parse: " + buf.slice(0,300))); }
      });
    });
    req.on("error", e => reject(new Error("Token net: " + e.message)));
    req.write(data); req.end();
  });
}

function kisGet(path, trId, params, token) {
  return new Promise((resolve, reject) => {
    const qs = new URLSearchParams(params).toString();
    const req = https.request({
      hostname: "openapi.koreainvestment.com", port: 9443, path: path + "?" + qs, method: "GET",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        authorization: "Bearer " + token,
        appkey: process.env.KIS_APP_KEY,
        appsecret: process.env.KIS_APP_SECRET,
        tr_id: trId, custtype: "P",
      },
    }, (res) => {
      let buf = ""; res.on("data", c => buf += c);
      res.on("end", () => {
        if (res.statusCode !== 200) return reject(new Error("KIS " + res.statusCode + ": " + buf.slice(0,300)));
        try { resolve(JSON.parse(buf)); } catch { reject(new Error("Parse " + trId + ": " + buf.slice(0,300))); }
      });
    });
    req.on("error", e => reject(new Error("Net " + trId + ": " + e.message)));
    req.end();
  });
}

function fmt(n) {
  if (!n) return "0";
  if (n >= 1e12) return (n / 1e12).toFixed(2) + "조";
  if (n >= 1e8) return Math.round(n / 1e8) + "억";
  return n.toLocaleString();
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    var tokenData = await kisPost("/oauth2/tokenP", {
      grant_type: "client_credentials",
      appkey: process.env.KIS_APP_KEY,
      appsecret: process.env.KIS_APP_SECRET,
    });
    if (!tokenData.access_token) return res.status(500).json({ ok: false, error: "토큰실패", detail: tokenData });
    var token = tokenData.access_token;

    var volData = await kisGet("/uapi/domestic-stock/v1/ranking/volume", "FHPST01710000", {
      FID_COND_MRKT_DIV_CODE: "J", FID_COND_SCR_DIV_CODE: "20174",
      FID_INPUT_ISCD: "0000", FID_DIV_CLS_CODE: "0", FID_BLNG_CLS_CODE: "0",
      FID_TRGT_CLS_CODE: "111111111", FID_TRGT_EXLS_CLS_CODE: "000000",
      FID_INPUT_PRICE_1: "", FID_INPUT_PRICE_2: "", FID_VOL_CNT: "", FID_INPUT_DATE_1: "",
    }, token);

    var volDataQ = await kisGet("/uapi/domestic-stock/v1/ranking/volume", "FHPST01710000", {
      FID_COND_MRKT_DIV_CODE: "Q", FID_COND_SCR_DIV_CODE: "20174",
      FID_INPUT_ISCD: "0000", FID_DIV_CLS_CODE: "0", FID_BLNG_CLS_CODE: "0",
      FID_TRGT_CLS_CODE: "111111111", FID_TRGT_EXLS_CLS_CODE: "000000",
      FID_INPUT_PRICE_1: "", FID_INPUT_PRICE_2: "", FID_VOL_CNT: "", FID_INPUT_DATE_1: "",
    }, token);

    var gainData = await kisGet("/uapi/domestic-stock/v1/ranking/fluctuation", "FHPST01700000", {
      FID_COND_MRKT_DIV_CODE: "J", FID_COND_SCR_DIV_CODE: "20170",
      FID_INPUT_ISCD: "0000", FID_RANK_SORT_CLS_CODE: "0", FID_INPUT_CNT_1: "0",
      FID_PRC_CLS_CODE: "0", FID_INPUT_PRICE_1: "", FID_INPUT_PRICE_2: "",
      FID_VOL_CNT: "", FID_TRGT_CLS_CODE: "0", FID_TRGT_EXLS_CLS_CODE: "0",
      FID_DIV_CLS_CODE: "0", FID_RSFL_RATE1: "", FID_RSFL_RATE2: "",
    }, token);

    var gainDataQ = await kisGet("/uapi/domestic-stock/v1/ranking/fluctuation", "FHPST01700000", {
      FID_COND_MRKT_DIV_CODE: "Q", FID_COND_SCR_DIV_CODE: "20170",
      FID_INPUT_ISCD: "0000", FID_RANK_SORT_CLS_CODE: "0", FID_INPUT_CNT_1: "0",
      FID_PRC_CLS_CODE: "0", FID_INPUT_PRICE_1: "", FID_INPUT_PRICE_2: "",
      FID_VOL_CNT: "", FID_TRGT_CLS_CODE: "0", FID_TRGT_EXLS_CLS_CODE: "0",
      FID_DIV_CLS_CODE: "0", FID_RSFL_RATE1: "", FID_RSFL_RATE2: "",
    }, token);

    var allVol = [...(volData.output || []), ...(volDataQ.output || [])]
      .map(i => ({ name: i.hts_kor_isnm, code: i.mksc_shrn_iscd, price: +i.stck_prpr, change: +i.prdy_ctrt, amt: +i.acml_tr_pbmn, amtFmt: fmt(+i.acml_tr_pbmn) }))
      .sort((a, b) => b.amt - a.amt).slice(0, 30);

    var allGain = [...(gainData.output || []), ...(gainDataQ.output || [])]
      .map(i => ({ name: i.hts_kor_isnm, code: i.mksc_shrn_iscd, price: +i.stck_prpr, change: +i.prdy_ctrt, amt: +i.acml_tr_pbmn, amtFmt: fmt(+i.acml_tr_pbmn) }));

    var limitUp = allGain.filter(s => s.change >= 29.0);
    var topRising = allGain.filter(s => s.change > 5 && s.change < 29.0).slice(0, 20);

    res.status(200).json({
      ok: true,
      date: new Date().toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" }),
      topVolume: allVol,
      limitUp: limitUp,
      topRising: topRising,
      _debug: { volK: (volData.output || []).length, volQ: (volDataQ.output || []).length, gainK: (gainData.output || []).length, gainQ: (gainDataQ.output || []).length }
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
};
