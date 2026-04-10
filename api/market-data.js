const https=require("https");
function post(p,b){return new Promise((y,n)=>{const d=JSON.stringify(b);const r=https.request({hostname:"openapi.koreainvestment.com",port:9443,path:p,method:"POST",headers:{"Content-Type":"application/json","Content-Length":Buffer.byteLength(d)}},s=>{let t="";s.on("data",c=>t+=c);s.on("end",()=>{try{y(JSON.parse(t))}catch{n(new Error(t.slice(0,200)))}})});r.on("error",n);r.write(d);r.end()})}
function get(p,id,q,tk){return new Promise((y,n)=>{const qs=new URLSearchParams(q).toString();const r=https.request({hostname:"openapi.koreainvestment.com",port:9443,path:p+"?"+qs,method:"GET",headers:{"Content-Type":"application/json; charset=utf-8",authorization:"Bearer "+tk,appkey:process.env.KIS_APP_KEY,appsecret:process.env.KIS_APP_SECRET,tr_id:id,custtype:"P"}},s=>{let t="";s.on("data",c=>t+=c);s.on("end",()=>{const sc=s.statusCode;if(!t)return n(new Error(id+":H"+sc+":empty"));try{y(JSON.parse(t))}catch{n(new Error(id+":H"+sc+":"+t.slice(0,200)))}})});r.on("error",e=>n(new Error(id+":"+e.message)));r.end()})}
function w(ms){return new Promise(r=>setTimeout(r,ms))}
function fmt(n){if(!n)return"0";if(n>=1e12)return(n/1e12).toFixed(1)+"조";if(n>=1e8)return Math.round(n/1e8)+"억";return n.toLocaleString()}

let _cache={token:"",exp:0};
async function getToken(){
  const now=Date.now();
  if(_cache.token&&_cache.exp>now+60000)return _cache.token;
  const td=await post("/oauth2/tokenP",{grant_type:"client_credentials",appkey:process.env.KIS_APP_KEY,appsecret:process.env.KIS_APP_SECRET});
  if(!td.access_token)throw new Error(JSON.stringify(td).slice(0,120));
  _cache={token:td.access_token,exp:now+(td.expires_in||86400)*1000};
  return td.access_token;
}

// 코스닥 종목 이름 기반 마켓 태깅
const KOSDAQ=new Set([
  '한미반도체','리노공업','원익IPS','피에스케이','HPSP','이오테크닉스','테스','주성엔지니어링',
  '에코프로','에코프로비엠','엘앤에프','천보','나노신소재','현대로템','퍼스텍','빅텍',
  'HLB','알테오젠','한전기술','한전KPS','두산에너빌리티','에스엠','JYP Ent.',
  '키움증권','크래프틴','한화에어로스페이스','LIG넥스원'
]);

function parseS(arr,mkt=""){
  return(arr||[]).filter(i=>i&&i.hts_kor_isnm).map(i=>({
    name:i.hts_kor_isnm,
    code:i.mksc_shrn_iscd||i.stck_shrn_iscd,
    price:+i.stck_prpr,
    change:+i.prdy_ctrt,
    amt:+(i.acml_tr_pbmn||0),
    amtFmt:fmt(+(i.acml_tr_pbmn||0)),
    vol:+(i.acml_vol||0),
    isLimit:+i.prdy_ctrt>=29,
    market:KOSDAQ.has(i.hts_kor_isnm)?'Q':mkt
  }))
}

// 등락률 순위 API 시도 (FHPST01700000)
async function tryGainRank(tk){
  const p={
    FID_COND_SCR_DIV_CODE:"20171",
    FID_INPUT_ISCD:"0000",
    FID_COND_MRKT_DIV_CODE:"J",
    FID_RANK_SORT_CLS_CODE:"0",
    FID_INPUT_CNT_1:"0",
    FID_PRC_CLS_CODE:"0",
    FID_INPUT_PRICE_1:"",
    FID_INPUT_PRICE_2:"",
    FID_VOL_CNT:"",
    FID_TRGT_CLS_CODE:"0",
    FID_TRGT_EXLS_CLS_CODE:"0",
    FID_DIV_CLS_CODE:"0",
    FID_RSFL_RATE1:"",
    FID_RSFL_RATE2:""
  };
  try{
    const r=await get("/uapi/domestic-stock/v1/quotations/chgrate-rank","FHPST01700000",p,tk);
    if(r.output&&r.output.length>0)return parseS(r.output,"J");
  }catch(e){}
  return null;
}

module.exports=async(req,res)=>{
  res.setHeader("Access-Control-Allow-Origin","*");
  res.setHeader("Cache-Control","no-store");
  if(req.method==="OPTIONS")return res.status(200).end();
  try{
    let tk;
    try{tk=await getToken();}catch(e){return res.status(500).json({ok:false,error:"token",d:e.message});}

    // 거래대금 순위 — 30개 x 2페이지 (총 60개 커버)
    const vp={FID_COND_SCR_DIV_CODE:"20174",FID_INPUT_ISCD:"0000",FID_COND_MRKT_DIV_CODE:"J",
              FID_DIV_CLS_CODE:"0",FID_BLNG_CLS_CODE:"0",FID_TRGT_CLS_CODE:"111111111",
              FID_TRGT_EXLS_CLS_CODE:"000000",FID_INPUT_PRICE_1:"",FID_INPUT_PRICE_2:"",
              FID_VOL_CNT:"",FID_INPUT_DATE_1:""};
    const volJ=await get("/uapi/domestic-stock/v1/quotations/volume-rank","FHPST01710000",vp,tk);
    const volAll=parseS(volJ.output,"J");

    await w(350);

    // 상한가 포함 상승 상위 종목 추가 확보 (등락률 높은 순 vol rank)
    // FID_BLNG_CLS_CODE 1 = 상한가 포함 상승 우선
    let volRise=[];
    try{
      const r2=await get("/uapi/domestic-stock/v1/quotations/volume-rank","FHPST01710000",
        {...vp,FID_DIV_CLS_CODE:"1"},tk);  // DIV_CLS_CODE 1 = 상승 종목만
      volRise=parseS(r2.output,"J");
    }catch(e){}

    await w(350);

    // 등락률 순위 API 시도
    const gainApiResult=await tryGainRank(tk);

    // 전체 종목 pool (거래대금 + 상승종목) 합산
    const seen=new Set(volAll.map(s=>s.code));
    const allPool=[...volAll];
    volRise.forEach(s=>{if(!seen.has(s.code)){seen.add(s.code);allPool.push(s);}});

    // gainRanking: API 성공시 API 결과, 실패시 pool 기반
    let gainRanking=[];
    const gainFallback=!gainApiResult?.length;
    if(!gainFallback){
      gainRanking=gainApiResult.filter(s=>s.change>0).sort((a,b)=>b.isLimit-a.isLimit||b.change-a.change);
    }else{
      gainRanking=[...allPool].filter(s=>s.change>0).sort((a,b)=>b.isLimit-a.isLimit||b.change-a.change);
    }

    const rising=[...volAll].filter(s=>s.change>0).sort((a,b)=>b.isLimit-a.isLimit||b.change-a.change);

    res.status(200).json({
      ok:true,_token:tk,
      date:new Date().toLocaleDateString("ko-KR",{timeZone:"Asia/Seoul"}),
      topVolume:[...volAll].sort((a,b)=>b.amt-a.amt),
      topRising:rising,
      gainRanking,
      limitUp:allPool.filter(s=>s.isLimit),
      total:volAll.length,
      debug:{
        kospi:volAll.filter(s=>s.market!=="Q").length,
        kosdaq:volAll.filter(s=>s.market==="Q").length,
        gainApi:gainApiResult?.length||0,
        gainFallback,
        gainSrc:gainFallback?'fallback':'api',
        poolSize:allPool.length
      }
    });
  }catch(e){res.status(500).json({ok:false,error:e.message})}
};
