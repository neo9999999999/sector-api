const https=require("https");
function post(p,b){return new Promise((y,n)=>{const d=JSON.stringify(b);const r=https.request({hostname:"openapi.koreainvestment.com",port:9443,path:p,method:"POST",headers:{"Content-Type":"application/json","Content-Length":Buffer.byteLength(d)}},s=>{let t="";s.on("data",c=>t+=c);s.on("end",()=>{try{y(JSON.parse(t))}catch{n(new Error(t.slice(0,200)))}})});r.on("error",n);r.write(d);r.end()})}
function get(p,id,q,tk){return new Promise((y,n)=>{const qs=new URLSearchParams(q).toString();const r=https.request({hostname:"openapi.koreainvestment.com",port:9443,path:p+"?"+qs,method:"GET",headers:{"Content-Type":"application/json; charset=utf-8",authorization:"Bearer "+tk,appkey:process.env.KIS_APP_KEY,appsecret:process.env.KIS_APP_SECRET,tr_id:id,custtype:"P"}},s=>{let t="";s.on("data",c=>t+=c);s.on("end",()=>{const sc=s.statusCode;if(!t)return n(new Error(id+":H"+sc+":empty"));try{y(JSON.parse(t))}catch{n(new Error(id+":H"+sc+":"+t.slice(0,200)))}})});r.on("error",e=>n(new Error(id+":"+e.message)));r.end()})}
function w(ms){return new Promise(r=>setTimeout(r,ms))}
function fmt(n){if(!n)return"";if(n>=1e12)return(n/1e12).toFixed(1)+"조";if(n>=1e8)return Math.round(n/1e8)+"억";if(n>=1e4)return Math.round(n/1e4)+"만";return n.toLocaleString()}

// 토큰 캐시 (1분당 1회 제한)
let _cache={token:"",exp:0};
async function getToken(){
  const now=Date.now();
  if(_cache.token&&_cache.exp>now+60000)return _cache.token;
  const td=await post("/oauth2/tokenP",{grant_type:"client_credentials",appkey:process.env.KIS_APP_KEY,appsecret:process.env.KIS_APP_SECRET});
  if(!td.access_token)throw new Error(JSON.stringify(td).slice(0,120));
  _cache={token:td.access_token,exp:now+(td.expires_in||86400)*1000};
  return td.access_token;
}

// ETF 패턴 (API 응답에서 ETF 제거)
const ETF=/^(KODEX|TIGER|KBSTAR|ARIRANG|KOSEF|HANARO|PLUS|RISE|ACE|SOL|WON|TIMEFOLIO|SMART|SAMSUNG|MIRAE|KB스타|NH아문디)/;

function parseRank(arr, mkt="J"){
  return (arr||[])
    .filter(i=>i&&i.hts_kor_isnm&&!ETF.test(i.hts_kor_isnm))
    .map(i=>({
      name: i.hts_kor_isnm,
      code: i.mksc_shrn_iscd||i.stck_shrn_iscd,
      price: +i.stck_prpr,
      change: +i.prdy_ctrt,
      amt: +(i.acml_tr_pbmn||0),
      amtFmt: fmt(+(i.acml_tr_pbmn||0)),
      vol: +(i.acml_vol||0),
      isLimit: +i.prdy_ctrt>=29,
      market: mkt
    }));
}

module.exports=async(req,res)=>{
  res.setHeader("Access-Control-Allow-Origin","*");
  res.setHeader("Cache-Control","no-store");
  if(req.method==="OPTIONS")return res.status(200).end();
  try{
    let tk;
    try{tk=await getToken();}catch(e){return res.status(500).json({ok:false,error:"token",d:e.message});}

    // ① 거래대금 순위 (KIS FHPST01710000 — KOSPI+KOSDAQ 통합 top30)
    const volParams={
      FID_COND_SCR_DIV_CODE:"20174",FID_INPUT_ISCD:"0000",
      FID_COND_MRKT_DIV_CODE:"J",FID_DIV_CLS_CODE:"0",
      FID_BLNG_CLS_CODE:"0",FID_TRGT_CLS_CODE:"111111111",
      FID_TRGT_EXLS_CLS_CODE:"000000",FID_INPUT_PRICE_1:"",
      FID_INPUT_PRICE_2:"",FID_VOL_CNT:"",FID_INPUT_DATE_1:""
    };
    const volRes=await get("/uapi/domestic-stock/v1/quotations/volume-rank","FHPST01710000",volParams,tk);
    const volAll=parseRank(volRes.output,"J");

    await w(700); // rate limit 방지

    // ② 등락률 순위 (ranking/fluctuation — 실제 시장 등락률)
    let gainRanking=[], gainApiOk=false, gainErr="";
    try{
      const gainParams={
        FID_COND_SCR_DIV_CODE:"20171",FID_INPUT_ISCD:"0000",
        FID_COND_MRKT_DIV_CODE:"J",FID_RANK_SORT_CLS_CODE:"0",
        FID_INPUT_CNT_1:"0",FID_PRC_CLS_CODE:"0",
        FID_INPUT_PRICE_1:"",FID_INPUT_PRICE_2:"",FID_VOL_CNT:"",
        FID_TRGT_CLS_CODE:"0",FID_TRGT_EXLS_CLS_CODE:"0",
        FID_DIV_CLS_CODE:"0",FID_RSFL_RATE1:"",FID_RSFL_RATE2:""
      };
      const gainRes=await get("/uapi/domestic-stock/v1/ranking/fluctuation","FHPST01700000",gainParams,tk);
      if(gainRes.output?.length>0){
        gainRanking=parseRank(gainRes.output,"J")
          .filter(s=>s.change>0)
          .sort((a,b)=>b.isLimit-a.isLimit||b.change-a.change);
        gainApiOk=true;
      } else {
        gainErr=`rt:${gainRes.rt_cd} msg:${gainRes.msg1}`;
      }
    }catch(e){ gainErr=e.message.slice(0,80); }

    // fallback: 등락률 API 실패시 거래대금 종목을 등락률순 정렬
    if(!gainApiOk){
      gainRanking=[...volAll]
        .filter(s=>s.change>0)
        .sort((a,b)=>b.isLimit-a.isLimit||b.change-a.change);
    }

    const rising=[...volAll]
      .filter(s=>s.change>0)
      .sort((a,b)=>b.isLimit-a.isLimit||b.change-a.change);

    res.status(200).json({
      ok: true,
      _token: tk,
      date: new Date().toLocaleDateString("ko-KR",{timeZone:"Asia/Seoul"}),
      topVolume: [...volAll].sort((a,b)=>b.amt-a.amt),
      topRising: rising,
      gainRanking,
      limitUp: volAll.filter(s=>s.isLimit),
      total: volAll.length,
      debug:{
        kospi: volAll.length,
        kosdaq: 0,
        gainApiOk,
        gainLen: gainRanking.length,
        gainErr: gainErr||null
      }
    });
  }catch(e){
    res.status(500).json({ok:false,error:e.message});
  }
};
