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
      res.on("end", () => { try { resolve({ status: res.statusCode, data: JSON.parse(b) }); } catch { resolve({ status: res.statusCode, raw: b.slice(0,500) }); } }); });
    req.on("error", e => reject(new Error(trId + ":" + e.message))); req.end();
  });
}
function delay(ms) { return new Promise(r => setTimeout(r, ms)); }
function fmt(n) { if (!n) return "0"; if (n >= 1e12) return (n/1e12).toFixed(1)+"조"; if (n >= 1e8) return Math.round(n/1e8)+"억"; return n.toLocaleString(); }
function parse(arr) { return (arr||[]).map(i => ({ name:i.hts_kor_isnm, code:i.mksc_shrn_iscd||i.stck_shrn_iscd, price:+(i.stck_prpr||0), change:+(i.prdy_ctrt||0), amt:+(i.acml_tr_pbmn||0), amtFmt:fmt(+(i.acml_tr_pbmn||0)), vol:+(i.acml_vol||0), isLimit:+(i.prdy_ctrt||0)>=29.0 })); }

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();
  try {
    var td = await kisPost("/oauth2/tokenP", { grant_type: "client_credentials", appkey: process.env.KIS_APP_KEY, appsecret: process.env.KIS_APP_SECRET });
    if (!td.access_token) return res.status(500).json({ ok: false, error: "token_fail", detail: td });
    var tk = td.access_token;
    var vp = { FID_COND_SCR_DIV_CODE:"20174",FID_INPUT_ISCD:"0000",FID_DIV_CLS_CODE:"0",FID_BLNG_CLS_CODE:"0",FID_TRGT_CLS_CODE:"111111111",FID_TRGT_EXLS_CLS_CODE:"000000",FID_INPUT_PRICE_1:"",FID_INPUT_PRICE_2:"",FID_VOL_CNT:"",FID_INPUT_DATE_1:"" };
    var fp = { FID_COND_SCR_DIV_CODE:"20170",FID_INPUT_ISCD:"0000",FID_RANK_SORT_CLS_CODE:"0",FID_INPUT_CNT_1:"0",FID_PRC_CLS_CODE:"0",FID_INPUT_PRICE_1:"",FID_INPUT_PRICE_2:"",FID_VOL_CNT:"",FID_TRGT_CLS_CODE:"0",FID_TRGT_EXLS_CLS_CODE:"0",FID_DIV_CLS_CODE:"0",FID_RSFL_RATE1:"",FID_RSFL_RATE2:"" };

    var volK = await kisGet("/uapi/domestic-stock/v1/quotations/volume-rank","FHPST01710000",Object.assign({FID_COND_MRKT_DIV_CODE:"J"},vp),tk);
    await delay(500);
    var volQ = await kisGet("/uapi/domestic-stock/v1/quotations/volume-rank","FHPST01710000",Object.assign({FID_COND_MRKT_DIV_CODE:"Q"},vp),tk);
    await delay(500);

    var paths = ["chgrate-rank","fluctuation","inquire-fluctuation","flu-rank"];
    var gainK = null, gainQ = null, workingPath = null;
    for (var p of paths) {
      var test = await kisGet("/uapi/domestic-stock/v1/quotations/"+p,"FHPST01700000",Object.assign({FID_COND_MRKT_DIV_CODE:"J"},fp),tk);
      if (test.status === 200 && test.data && test.data.output) { gainK = test; workingPath = p; break; }
      await delay(300);
    }
    if (workingPath) {
      await delay(500);
      gainQ = await kisGet("/uapi/domestic-stock/v1/quotations/"+workingPath,"FHPST01700000",Object.assign({FID_COND_MRKT_DIV_CODE:"Q"},fp),tk);
    }

    var allVol = parse(volK.data?.output).concat(parse(volQ.data?.output)).sort((a,b) => b.amt - a.amt).slice(0,30);
    var allGain = gainK ? parse(gainK.data?.output).concat(parse(gainQ?.data?.output||[])) : [];
    var limitUp = allGain.filter(s => s.change >= 29.0);
    var topRising = allGain.filter(s => s.change > 5 && s.change < 29.0).slice(0,30);
    var seen = new Set(); allVol.forEach(s => seen.add(s.code));
    topRising.forEach(s => { if (!seen.has(s.code)) { allVol.push(s); seen.add(s.code); } });
    limitUp.forEach(s => { if (!seen.has(s.code)) { allVol.push(s); seen.add(s.code); } });

    res.status(200).json({
      ok: true,
      date: new Date().toLocaleDateString("ko-KR",{timeZone:"Asia/Seoul"}),
      topVolume: allVol,
      limitUp: limitUp,
      topRising: topRising,
      total: allVol.length,
      _debug: { workingPath, gainKStatus: gainK?.status, triedPaths: paths },
    });
  } catch(e) { res.status(500).json({ ok:false, error:e.message }); }
};
