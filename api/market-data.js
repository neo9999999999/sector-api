const https = require("https");
function kisPost(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request({ hostname: "openapi.koreainvestment.com", port: 9443, path, method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) },
    }, res => { let b = ""; res.on("data", c => b += c); res.on("end", () => { try { resolve(JSON.parse(b)); } catch { reject(new Error("TP:" + b.slice(0,200))); } }); });
    req.on("error", e => reject(new Error("TN:" + e.message))); req.write(data); req.end();
  });
}
function kisGet(path, trId, params, token) {
  return new Promise((resolve, reject) => {
    const qs = new URLSearchParams(params).toString();
    const req = https.request({ hostname: "openapi.koreainvestment.com", port: 9443, path: path + "?" + qs, method: "GET",
      headers: { "Content-Type": "application/json; charset=utf-8", authorization: "Bearer " + token,
        appkey: process.env.KIS_APP_KEY, appsecret: process.env.KIS_APP_SECRET, tr_id: trId, custtype: "P" },
    }, res => { let b = ""; res.on("data", c => b += c);
      res.on("end", () => { if (res.statusCode !== 200) return reject(new Error(trId + " H" + res.statusCode + ":" + b.slice(0,200)));
        try { resolve(JSON.parse(b)); } catch { reject(new Error(trId + " P:" + b.slice(0,200))); } }); });
    req.on("error", e => reject(new Error(trId + " N:" + e.message))); req.end();
  });
}
function delay(ms) { return new Promise(r => setTimeout(r, ms)); }
function fmt(n) { if (!n) return "0"; if (n >= 1e12) return (n/1e12).toFixed(1)+"조"; if (n >= 1e8) return Math.round(n/1e8)+"억"; return n.toLocaleString(); }

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();
  try {
    var td = await kisPost("/oauth2/tokenP", { grant_type: "client_credentials", appkey: process.env.KIS_APP_KEY, appsecret: process.env.KIS_APP_SECRET });
    if (!td.access_token) return res.status(500).json({ ok: false, error: "token_fail", detail: td });
    var tk = td.access_token;
    var vp = { FID_COND_SCR_DIV_CODE:"20174",FID_INPUT_ISCD:"0000",FID_DIV_CLS_CODE:"0",FID_BLNG_CLS_CODE:"0",FID_TRGT_CLS_CODE:"111111111",FID_TRGT_EXLS_CLS_CODE:"000000",FID_INPUT_PRICE_1:"",FID_INPUT_PRICE_2:"",FID_VOL_CNT:"",FID_INPUT_DATE_1:"" };

    var volK = await kisGet("/uapi/domestic-stock/v1/quotations/volume-rank","FHPST01710000",Object.assign({FID_COND_MRKT_DIV_CODE:"J"},vp),tk);
    await delay(300);
    var volQ = await kisGet("/uapi/domestic-stock/v1/quotations/volume-rank","FHPST01710000",Object.assign({FID_COND_MRKT_DIV_CODE:"Q"},vp),tk);

    var all = [...(volK.output||[]),...(volQ.output||[])].map(i => ({
      name: i.hts_kor_isnm, code: i.mksc_shrn_iscd, price: +i.stck_prpr,
      change: +i.prdy_ctrt, amt: +i.acml_tr_pbmn, amtFmt: fmt(+i.acml_tr_pbmn),
      vol: +i.acml_vol, isLimit: +i.prdy_ctrt >= 29.0,
    })).sort((a,b) => b.amt - a.amt);

    res.status(200).json({
      ok: true,
      date: new Date().toLocaleDateString("ko-KR",{timeZone:"Asia/Seoul"}),
      topVolume: all,
      limitUp: all.filter(s => s.isLimit),
      topRising: all.filter(s => s.change > 5 && !s.isLimit),
      total: all.length,
      kospiCount: (volK.output||[]).length,
      kosdaqCount: (volQ.output||[]).length,
    });
  } catch(e) { res.status(500).json({ ok:false, error:e.message }); }
};
