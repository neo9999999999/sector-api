const https=require("https");
function post(p,b){return new Promise((y,n)=>{const d=JSON.stringify(b);const r=https.request({hostname:"openapi.koreainvestment.com",port:9443,path:p,method:"POST",headers:{"Content-Type":"application/json","Content-Length":Buffer.byteLength(d)}},s=>{let t="";s.on("data",c=>t+=c);s.on("end",()=>{try{y(JSON.parse(t))}catch{n(new Error(t.slice(0,200)))}})});r.on("error",n);r.write(d);r.end()})}
function get(p,id,q,tk){return new Promise((y,n)=>{const qs=new URLSearchParams(q).toString();const r=https.request({hostname:"openapi.koreainvestment.com",port:9443,path:p+"?"+qs,method:"GET",headers:{"Content-Type":"application/json; charset=utf-8",authorization:"Bearer "+tk,appkey:process.env.KIS_APP_KEY,appsecret:process.env.KIS_APP_SECRET,tr_id:id,custtype:"P"}},s=>{let t="";s.on("data",c=>t+=c);s.on("end",()=>{const sc=s.statusCode;if(!t)return n(new Error(id+":H"+sc+":empty"));try{y(JSON.parse(t))}catch{n(new Error(id+":H"+sc+":"+t.slice(0,200)))}})});r.on("error",e=>n(new Error(id+":"+e.message)));r.end()})}
function w(ms){return new Promise(r=>setTimeout(r,ms))}
function fmt(n){if(!n)return"";if(n>=1e12)return(n/1e12).toFixed(1)+"조";if(n>=1e8)return Math.round(n/1e8)+"억";if(n>=1e4)return Math.round(n/1e4)+"만";return n.toLocaleString()}

const {saveDaily,getKSTDate,getKSTHour}=require("./save-daily");
let _cache={token:"",exp:0};
async function getToken(){
  const now=Date.now();
  if(_cache.token&&_cache.exp>now+60000)return _cache.token;
  const td=await post("/oauth2/tokenP",{grant_type:"client_credentials",appkey:process.env.KIS_APP_KEY,appsecret:process.env.KIS_APP_SECRET});
  if(!td.access_token)throw new Error(JSON.stringify(td).slice(0,120));
  _cache={token:td.access_token,exp:now+(td.expires_in||86400)*1000};
  return td.access_token;
}

function parseRank(arr,mkt){
  return(arr||[]).filter(i=>i&&i.hts_kor_isnm).map(i=>({
    name:i.hts_kor_isnm,
    code:i.mksc_shrn_iscd||i.stck_shrn_iscd,
    price:+i.stck_prpr,
    change:+i.prdy_ctrt,
    amt:+(i.acml_tr_pbmn||0),
    amtFmt:fmt(+(i.acml_tr_pbmn||0)),
    vol:+(i.acml_vol||0),
    isLimit:+i.prdy_ctrt>=29,
    limitHour:i.hgpr_hour||"",
    market:mkt
  }))
}

module.exports=async(req,res)=>{
  res.setHeader("Access-Control-Allow-Origin","*");
  res.setHeader("Cache-Control","no-store");
  if(req.method==="OPTIONS")return res.status(200).end();
  try{
    let tk;
    try{tk=await getToken();}catch(e){return res.status(500).json({ok:false,error:"token",d:e.message});}

    // ① 거래대금 순위 (코스피+코스닥 통합)
    const vp={
      FID_COND_SCR_DIV_CODE:"20171",FID_INPUT_ISCD:"0000",
      FID_COND_MRKT_DIV_CODE:"J",FID_DIV_CLS_CODE:"0",
      FID_BLNG_CLS_CODE:"0",FID_TRGT_CLS_CODE:"111111111",
      FID_TRGT_EXLS_CLS_CODE:"0000000000",FID_INPUT_PRICE_1:"0",
      FID_INPUT_PRICE_2:"1000000",FID_VOL_CNT:"100000",FID_INPUT_DATE_1:""
    };
    const volRes=await get("/uapi/domestic-stock/v1/quotations/volume-rank","FHPST01710000",vp,tk);
    const volAll=parseRank(volRes.output,"J");
    await w(700);

    // ② 등락률 순위 — 코스피(J) + 코스닥(Q) 공식 파라미터 사용
    // 공식 예제: FID_COND_SCR_DIV_CODE="20170", FID_RANK_SORT_CLS_CODE="0000"
    const gp={
      FID_COND_SCR_DIV_CODE:"20170",    // 공식: 20170 (기존에 20171로 잘못 씀)
      FID_INPUT_ISCD:"0000",
      FID_RANK_SORT_CLS_CODE:"0",    // 공식: 0000 (기존에 "1" 사용)
      FID_INPUT_CNT_1:"0",
      FID_PRC_CLS_CODE:"0",
      FID_INPUT_PRICE_1:"0",            // 공식: "0"
      FID_INPUT_PRICE_2:"1000000",      // 공식: "1000000"
      FID_VOL_CNT:"100000",             // 공식: "100000"
      FID_TRGT_CLS_CODE:"0",
      FID_TRGT_EXLS_CLS_CODE:"0",
      FID_DIV_CLS_CODE:"0",
      FID_RSFL_RATE1:"0",
      FID_RSFL_RATE2:""
    };

    let gainJ=[],gainQ=[],gainErr="";

    // 코스피 등락률
    try{
      const r=await get("/uapi/domestic-stock/v1/ranking/fluctuation","FHPST01700000",
        {...gp,FID_COND_MRKT_DIV_CODE:"J"},tk);
      if(r.output?.length) gainJ=parseRank(r.output,"J");
      else gainErr+="J:rt"+r.rt_cd+":"+r.msg1;
    }catch(e){gainErr+="J:"+e.message.slice(0,60);}
    await w(700);

    // 코스닥 등락률 (공식 문서 확인: "Q" 지원)
    try{
      const r=await get("/uapi/domestic-stock/v1/ranking/fluctuation","FHPST01700000",
        {...gp,FID_COND_MRKT_DIV_CODE:"Q"},tk);
      if(r.output?.length) gainQ=parseRank(r.output,"Q");
      else gainErr+=" Q:rt"+r.rt_cd+":"+r.msg1;
    }catch(e){gainErr+=" Q:"+e.message.slice(0,60);}

    // 코스피+코스닥 합산 → 등락률 내림차순
    const seen=new Set();
    const gainAll=[...gainJ,...gainQ].filter(s=>{
      if(seen.has(s.code))return false;
      seen.add(s.code);return true;
    });
    const gainRanking=gainAll.filter(s=>s.change>0)
      .sort((a,b)=>b.isLimit-a.isLimit||b.change-a.change);
    const gainApiOk=gainJ.length>0||gainQ.length>0;

    // fallback
    if(!gainApiOk){
      gainRanking.push(...[...volAll].filter(s=>s.change>0)
        .sort((a,b)=>b.isLimit-a.isLimit||b.change-a.change));
    }

    // 장마감 후(15:30~16:30 KST) 자동 저장
    const kstHour=getKSTHour();
    if(kstHour>=1530&&kstHour<=1630&&process.env.GITHUB_TOKEN){
      const today=getKSTDate();
      const payload={
        date:today,
        topSectors:Object.entries(
          gainRanking.slice(0,30).reduce((acc,s)=>{
            const sec=s.sectorFromApi||"기타";
            if(!acc[sec])acc[sec]=[];
            acc[sec].push({name:s.name,code:s.code,change:s.change,amt:s.amt,isLimit:s.isLimit});
            return acc;
          },{})
        ).map(([sector,stocks])=>({
          sector,
          stocks:stocks.sort((a,b)=>b.change-a.change),
          avg:+(stocks.reduce((t,s)=>t+s.change,0)/stocks.length).toFixed(2),
          leader:stocks[0]?.name||""
        })).sort((a,b)=>b.avg-a.avg).slice(0,8),
        gainTop30:gainRanking.slice(0,30).map(s=>({name:s.name,code:s.code,change:s.change,market:s.market,isLimit:s.isLimit,amt:s.amt})),
        volTop30:([...volAll].sort((a,b)=>b.amt-a.amt)).slice(0,30).map(s=>({name:s.name,code:s.code,change:s.change,amt:s.amt}))
      };
      saveDaily(today,payload).catch(()=>{});
    }

    res.status(200).json({
      ok:true,_token:tk,
      date:new Date().toLocaleDateString("ko-KR",{timeZone:"Asia/Seoul"}),
      topVolume:[...volAll].sort((a,b)=>b.amt-a.amt),
      topRising:[...volAll].filter(s=>s.change>0).sort((a,b)=>b.isLimit-a.isLimit||b.change-a.change),
      gainRanking,
      limitUp:gainRanking.filter(s=>s.isLimit),
      total:volAll.length,
      debug:{kospi:volAll.length,gainJ:gainJ.length,gainQ:gainQ.length,gainApiOk,gainErr:gainErr||null}
    });
  }catch(e){res.status(500).json({ok:false,error:e.message})}
};
