// api/market-data.js â íí¬ OpenAPI ë±ë½ë¥ +ê±°ëëê¸ ìì (ì½ì¤í¼+ì½ì¤ë¥)
// ë°°í¬: Vercel Serverless Function
const https = require("https");

let cachedToken = null;
let tokenExpiry = 0;

function kisPost(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request({
      hostname: "openapi.koreainvestment.com", port: 9443, path, method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) },
    }, res => { let b = ""; res.on("data", c => b += c); res.on("end", () => { try { resolve(JSON.parse(b)); } catch { reject(new Error("TokenParse:" + b.slice(0,300))); } }); });
    req.on("error", e => reject(new Error("TokenNet:" + e.message))); req.write(data); req.end();
  });
}

function kisGet(path, trId, params, token) {
  return new Promise((resolve, reject) => {
    const qs = new URLSearchParams(params).toString();
    const req = https.request({
      hostname: "openapi.koreainvestment.com", port: 9443,
      path: path + "?" + qs, method: "GET",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        authorization: "Bearer " + token,
        appkey: process.env.KIS_APP_KEY,
        appsecret: process.env.KIS_APP_SECRET,
        tr_id: trId, custtype: "P"
      },
    }, res => {
      let b = ""; res.on("data", c => b += c);
      res.on("end", () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(b) }); }
        catch { resolve({ status: res.statusCode, raw: b.slice(0,500) }); }
      });
    });
    req.on("error", e => reject(new Error(trId + ":" + e.message))); req.end();
  });
}

async function getToken() {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;
  const r = await kisPost("/oauth2/tokenP", {
    grant_type: "client_credentials",
    appkey: process.env.KIS_APP_KEY,
    appsecret: process.env.KIS_APP_SECRET,
  });
  if (!r.access_token) throw new Error("tokenFail: " + JSON.stringify(r).slice(0,200));
  cachedToken = r.access_token;
  tokenExpiry = Date.now() + 23 * 3600 * 1000;
  return cachedToken;
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }
function fmt(n) { if (!n) return "0"; n = Number(n); if (n >= 1e12) return (n/1e12).toFixed(1)+"\uc870"; if (n >= 1e8) return Math.round(n/1e8)+"\uc5b5"; return n.toLocaleString(); }

const SECTOR_RULES = [
  { name: "\ubc29\uc0b0", keywords: ["\ud55c\ud654\uc5d4\uc5b4","\ud55c\ud654\uc2dc\uc2a4\ud15c","LIG\ub425\uc2a4","\ud48d\uc0b0","\ud57c\uc2a4\ud14d","\uae08\uac15\ucca0\uac15","\uc0bc\ud654\ud398\uc778\ud2b8","\ubc29\uc0b0","\ud55c\uad6d\ud56d\uacf5\uc6b0\uc8fc","\ud604\ub300\ub85c\ud15c","SNT\ubaa8\ud2f0\ube0c","SNT\ub2e4\uc074\ub0b4\ubbf9\uc2a4","\ub514\uc544\uc074\uc528","\ucf04\ucf54\uc544\uc5d4\uc5b4\ub85c","\ud55c\uc77c\ub2e8\uc870"] },
  { name: "\ubc18\ub3c4\uccb4", keywords: ["\uc0bc\uc131\uc804\uc790","SK\ud558\uc774\ub2c9\uc2a4","\ud55c\ubbf8\ubc18\ub3c4\uccb4","DB\ud558\uc774\ud14d","\uc6d0\uc775IPS","\ub9ac\ub178\uacf5\uc5c5","ISC","\uc8fc\uc131\uc5d4\uc9c0\ub2c8\uc5b4","\ud14c\ud06c\uc719","\ucf54\ubbf8\ucf54","\ud53c\uc5d0\uc2a4\ucf00\uc774","\ub425\uc2a4\ud2f4","\uc5d0\uc2a4\uc5d0\ud504\uc5d0\uc774","HPSP","\uc774\uc624\ud14c\ud06c\ub2c9\uc2a4","\uc194\ube0c\ub808\uc778"] },
  { name: "\ubc18\ub3c4\uccb4\uc7a5\ube44", keywords: ["\ub808\uc774\uc800\uc38c","\ud558\uc774\ub525","\uc131\ud638\uc004\uc790","\ud55c\ubbf8\ubc18\ub3c4\uccb4","\uc8fc\uc131\uc5d4\uc9c0\ub2c8\uc5b4\ub9c1","\uc6d0\uc775IPS","\ud53c\uc5d0\uc2a4\ucf00\uc774","\ud14c\uc2a4","\uc5d0\uc774\ud53c\ud2f0\uc528","\uc138\uba54\uc2a4","HPSP"] },
  { name: "AI", keywords: ["\ube44\uc544\uc774\ub9e4\ud2b8\ub9ad\uc2a4","\ud50c\ub8e8\ud1a0\uc2a4","\uc778\ud150\ub9ac\uc548\ud14c\ud06c","\uc6f0\ud0a8\uc2a4\ud558\uc774\ud14d","\ucf54\ub09c\ud14c\ud06c","\uc140\ubc14\uc2a4AI","\ub9c8\uc778\uc988\ub7a9","\uc194\ud2b8\ub8e9\uc2a4","\uc54c\uccb4\ub77c","\uc624\ube0c\uc820","AI","\ud3f4\ub77c\ub9ac\uc2a4\uc624\ud53c\uc2a4","\uc544\uc774\ud018\uc2a4\ud2b8","\ub77c\uc628\ud53c\ud50c"] },
  { name: "2\ucc28\uc004\uc9c0", keywords: ["LG\uc5d0\ub108\uc9c0\uc194\ub8e8]\uc158","\uc0bc\uc131SDI","\uc5d0\ucf54\ud504\ub85c","\uc5d0\ucf54\ud504\ub85c\ube44\uc5e0","\ud3f4\uc2a4\ucf54\ud4e8\ucc98\uc5e0","\uc5d8\uc564\uc5d0\ud504","LG\ud654\ud559","SK\uc774\ub178\ubca0\uc774\uc158","SK\uc628","\ucf54\uc2a4\ubaa8\uc2e0\uc18c\uc7ac","\ub098\ub178\uc2e0\uc18c\uc7ac","\ucc9c\ubcf4","\uc0c8\ube57\ucf10"] },
  { name: "\ub85c\ubd87", keywords: ["\ub808\uc778\ubcf4\uc6b0\ub85c\ubcf4\ud2f1\uc2a4","\ub450\uc0b0\ub85c\ubcf4\ud2f1\uc2a4","\ub85c\ubcf4\uc2a4\ud0c0","\ub85c\ubcf4\ud2f0\uc988","\ub4b4\ub85c\uba54\uce74","\uc5d0\uc2a4\ud53c\uc2dc\uc2a4\ud15c\uc2a4","\uc0bc\uc775THK","\ud2f0\ub85c\ubcf4\ud2f1\uc2a4","\ud604\ub300\ub85c\ubcf4\ud2f1\uc2a4"] },
  { name: "\ubc14\uc774\uc624", keywords: ["\uc140\ud2b8\ub9ac\uc628","\uc0bc\uc131\ubc14\uc774\uc628","SK\ubc14\uc774\uc624\ud31c","\uc720\ud55c\uc591\ud589","\ud55c\ubbf8\uc57d\ud488","\uc54c\ud14c\uc624\uc220","\ub9ac\uac00\ucf10\ubc14\uc774\uc628","HLB","\uc5d0\uc774\ube44\uc5d8\ubc14\uc774\uc628","\uc62c\ub9ad\uc2a4","\uba54\ub514\ud1a1\uc2a4","\ud074\ub798\uc2dc\uc2a4"] },
  { name: "\uc6d0\uc804", keywords: ["\ub450\uc0b0\uc5d0\ub108\ube4c\ub96c\ud2f0","\ud55c\uc804\uae30\uc220","\ud55c\uc804\uc0b0\uc5c5","\ud55c\uad6d\uc804\ub825","\ube44\uc5d0\uc774\uce58\uc544\uc774","\ubcf4\uc131\ud30c\uc6cc\ud14d","\uc6b0\ub9ac\uae30\uc220\ud22c\uc790","\uc77c\uc9c4\ud30c\uc6cc"] },
  { name: "\uc870\uc120", keywords: ["HD\ud604\ub300\uc911\uacf5\uc5c5","\ud55c\ud654\uc624\uc158","HD\ud55c\uad6d\uc870\uc120\ud574\uc591","HD\ud604\ub300\ubbf8\ud3ec","\uc0bc\uc131\uc911\uacf5\uc5c5","HD\ud604\ub300\ub9c8]\ub9b4\uc194\ub8e8\uc158"] },
  { name: "\uc5d0\ub108\uc9c0", keywords: ["\ud55c\uad6d\uac00\uc2a4\uacf5\uc0ac","\ud55c\uad6d\uc804\ub825","\ub450\uc0b0\ud4e8\uc5c0\uc140","SK\uac00\uc2a4","GS","S-Oil","SK\uc774\ub178\ubca0\uc774\uc158"] },
  { name: "\uc790\ub3d9\ucc28", keywords: ["\ud604\ub300\ucc28","\uae30\uc544","\ud604\ub300\ubaa8\ube44\uc2a4","\ub9cc\ub3c4","\ud55c\uc628\uc2dc\uc2a4\ud15c","HL\ub9cc\ub3c4","\uc5d0\uc2a4\uc5d8"] },
  { name: "\uac14\uc124", keywords: ["\uc0bc\uc131\ubb3c\uc0b0","\ud604\ub300\uac14\uc124","\ub300\uc6b0\uac14\uc124","GS\uac14\uc124","DL\uc774\uc564\uc528","HDC\ud604\ub300\uc0b0\uc5c5\uac1c\ubc1c","\ud0dc\uc601\uac14\uc124"] },
  { name: "\uae08\uc635", keywords: ["KB\uae08\uc635","\uc2e0\ud55c\uc9c0\uc8fc","\ud558\ub098\uae08\uc635","\uc6b0\ub9ac\uae08\uc635","\uba54\ub9ac\uce20\uae08\uc635","\uce74\uce74\uc624\ubc45\ud06c","\uc0bc\uc131\uc0dd\uba85","\ud55c\ud654\uc0dd\uba85"] },
  { name: "\ud654\uc7a5\ud488", keywords: ["\uc544\ubaa8\ub808\ud37c\uc2dc\ud53d","LG\uc0dd\ud65c\uac14\uac15","\ucf54\uc2a4\ub9e4\uc2a4","\ud55c\uad6d\ucf5c\ub9c8","\uc2e4\ub9ac\ucf58\ud22c","\uc787\uce20\ud55c\ubd88","\ud1a0\ub2c8\ubaa8\ub9ac","\ud074\ub9ac\uc624"] },
  { name: "\uac8c\uc784", keywords: ["\ud06c\ub798\ud504\ud1a4","\ub137\ub9c8\ube14","\uc5c8\uc528\uc18c\ud504\ud2b8","\uce74\uce74\uc624\uac8c\uc784\uc988","\ucef4\ud22c\uc2a4","\uc704\uba54\uc774\ub4dc","\ud384\uc5b4\ube44\uc2a4","\ub124\uc624\uc704\uc988"] },
  { name: "\ud1b5\uc2e0", keywords: ["SK\ud154\ub808\ucf64","KT","LG\uc720\ud50c\ub7ec\uc2a4"] },
  { name: "\uc6b0\uc8fc\ud56d\uacf5", keywords: ["\ud55c\uad6d\ud56d\uacf5\uc6b0\uc8fc","\ucf04\ucf54\uc544\uc5d0\uc5b4\ub85c","AP\uc704\uc131","\uc384\ud2b8\ub808\uc544\uc774","LIG\ub425\uc2a4\uc6d0","\ucee8\ud14d","\uc778\ud150\ub9ac\uc548"] },
];

function classifySector(name) {
  for (const rule of SECTOR_RULES) {
    for (const kw of rule.keywords) {
      if (name.includes(kw) || kw.includes(name)) return rule.name;
    }
  }
  return "\uae30\ud0c0";
}

async function getFluctuationRank(token, market) {
  const fid_input_iscd = market === "1" ? "0001" : market === "2" ? "1001" : "0000";
  const r = await kisGet("/uapi/domestic-stock/v1/ranking/fluctuation", "FHPST01700000", {
    fid_cond_mrkt_div_code: "J", fid_cond_scr_div_code: "20170",
    fid_input_iscd, fid_rank_sort_cls_code: "0", fid_input_cnt_1: "0",
    fid_prc_cls_code: "0", fid_input_price_1: "", fid_input_price_2: "",
    fid_vol_cnt: "", fid_trgt_cls_code: "0", fid_trgt_exls_cls_code: "0",
    fid_div_cls_code: "0", fid_rsfl_rate1: "", fid_rsfl_rate2: "",
  }, token);
  return r;
}

async function getVolumeRank(token, market) {
  const r = await kisGet("/uapi/domestic-stock/v1/quotations/volume-rank", "FHPST01710000", {
    FID_COND_MRKT_DIV_CODE: "J", FID_COND_SCR_DIV_CODE: "20171",
    FID_INPUT_ISCD: market === "1" ? "0001" : market === "2" ? "1001" : "0000",
    FID_DIV_CLS_CODE: "0", FID_BLNG_CLS_CODE: "1",
    FID_TRGT_CLS_CODE: "111111111", FID_TRGT_EXLS_CLS_CODE: "0000000000",
    FID_INPUT_PRICE_1: "0", FID_INPUT_PRICE_2: "0",
    FID_VOL_CNT: "0", FID_INPUT_DATE_1: "",
  }, token);
  return r;
}

async function getIndex(token, code) {
  const r = await kisGet("/uapi/domestic-stock/v1/quotations/inquire-index-price", "FHPUP02100000", {
    FID_COND_MRKT_DIV_CODE: "U", FID_INPUT_ISCD: code,
  }, token);
  return r;
}

function parseStock(item, source) {
  const name = item.hts_kor_isnm || item.stck_shrn_iscd || "";
  const code = item.mksc_shrn_iscd || item.stck_shrn_iscd || "";
  const price = +(item.stck_prpr || 0);
  const change = +(item.prdy_ctrt || 0);
  const amt = +(item.acml_tr_pbmn || 0);
  const vol = +(item.acml_vol || 0);
  return {
    name, code, price, change, amt, amtFmt: fmt(amt), vol,
    isLimit: change >= 29.0,
    market: item.bstp_cls_code === "2" ? "\ucf54\uc2a4\ub2e5" : item.bstp_cls_code === "1" ? "\ucf54\uc2a4\ud53c" : "\ucf54\uc2a4\ud53c",
    sector: classifySector(name), source,
  };
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  try {
    const token = await getToken();
    const errors = [];
    const allStocks = new Map();
    try { const r1 = await getFluctuationRank(token, "1"); (r1?.data?.output||[]).forEach(i=>{const s=parseStock(i,"f1");s.market="\ucf54\uc2a4\ud53c";if(s.name&&s.change>0)allStocks.set(s.code||s.name,s)}); } catch(e){errors.push("f1:"+e.message)}
    await delay(200);
    try { const r2 = await getFluctuationRank(token, "2"); (r2?.data?.output||[]).forEach(i=>{const s=parseStock(i,"f2");s.market="\ucf54\uc2a4\ub2e5";if(s.name&&s.change>0)allStocks.set(s.code||s.name,s)}); } catch(e){errors.push("f2:"+e.message)}
    await delay(200);
    try { const r3 = await getVolumeRank(token, "1"); (r3?.data?.output||[]).forEach(i=>{const s=parseStock(i,"v1");s.market="\ucf54\uc2a4\ud53c";if(s.name&&!allStocks.has(s.code||s.name))allStocks.set(s.code||s.name,s)}); } catch(e){errors.push("v1:"+e.message)}
    await delay(200);
    try { const r4 = await getVolumeRank(token, "2"); (r4?.data?.output||[]).forEach(i=>{const s=parseStock(i,"v2");s.market="\ucf54\uc2a4\ub2e5";if(s.name&&!allStocks.has(s.code||s.name))allStocks.set(s.code||s.name,s)}); } catch(e){errors.push("v2:"+e.message)}
    let kospi={},kosdaq={};
    try{const k=await getIndex(token,"0001");const o=k?.data?.output||{};kospi={value:o.bstp_nmix_prpr,change:o.bstp_nmix_prdy_ctrt,volume:fmt(+(o.acml_tr_pbmn||0))}}catch(e){errors.push("i1"+e.message)}
    await delay(200);
    try{const k2=await getIndex(token,"1001");const o2=k2?.data?.output||{};kosdaq={value:o2.bstp_nmix_prpr,change:o2.bstp_nmix_prdy_ctrt,volume:fmt(+(o2.acml_tr_pbmn||0))}}catch(e){errors.push("i2"+e.message)}
    const stocks=Array.from(allStocks.values());
    const byChange=[...stocks].sort((a,b)=>b.change-a.change);
    const byVolume=[...stocks].sort((a,b)=>b.amt-a.amt);
    const sectorMap={};
    byChange.forEach(s=>{if(s.change<=0)return;const sc=s.sector;if(!sectorMap[sc])sectorMap[sc]={name:sc,stocks:[],totalChange:0,limitCount:0,totalAmt:0};sectorMap[sc].stocks.push(s);sectorMap[sc].totalChange+=s.change;sectorMap[sc].totalAmt+=s.amt;if(s.isLimit)sectorMap[sc].limitCount++});
    const sectors=Object.values(sectorMap).filter(s=>s.name!=="\uae30\ud0c0"&&s.stocks.length>=1).map(sec=>{const avg=sec.totalChange/sec.stocks.length;const score=Math.min(Math.round(avg*3+sec.limitCount*15+Math.min(sec.stocks.length*5,25)),100);const label=score>=80?"\ub9e4\uc6b0\uac15\ud568":score>=60?"\uac15\ud568":score>=40?"\ubcf4\ud5b5":"\uc57d\ud568";sec.stocks.sort((a,b)=>b.change-a.change);if(sec.stocks.length>0)sec.stocks[0].isLeader=!0;return{name:sec.name,score,label,limitCount:sec.limitCount,stockCount:sec.stocks.length,totalAmt:sec.totalAmt,totalAmtFmt:fmt(sec.totalAmt),stocks:sec.stocks.slice(0,10).map((s,i)=>({rank:i+1,name:s.name,code:s.code,market:s.market,sector:s.sector,price:s.price.toLocaleString(),change:(s.change>=0?"+":"")+s.change.toFixed(2)+"%",changeNum:s.change,volume:s.amtFmt,volumeRaw:s.amt,isLimit:s.isLimit,isLeader:s.isLeader||!0}))}}).sort((a,b)=>b.score-a.score);
    const volumeRank=byVolume.slice(0,50).map((s,i)=>({rank:i+1,name:s.name,code:s.code,market:s.market,sector:s.sector,price:s.price.toLocaleString(),change:(s.change>=0?"+":"")+s.change.toFixed(2)+"%",changeNum:s.change,volume:s.amtFmt,volumeRaw:s.amt,isLimit:s.isLimit}));
    const now=new Date(new Date().toLocaleString("en-US",{timeZone:"Asia/Seoul"}));
    const dateStr=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
    return res.status(200).json({ok:!0,date:dateStr,timestamp:new Date().toISOString(),totalStocks:stocks.length,index:{kospi,kosdaq},sectors,volumeRank,calendarEntry:{date:dateStr,sectors:sectors.slice(0,5).map(s=>s.name)},errors:errors.length>0?errors:void 0});
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
};
