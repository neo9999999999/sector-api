const https=require("https");
function post(p,b){return new Promise((y,n)=>{const d=JSON.stringify(b);const r=https.request({hostname:"openapi.koreainvestment.com",port:9443,path:p,method:"POST",headers:{"Content-Type":"application/json","Content-Length":Buffer.byteLength(d)}},s=>{let t="";s.on("data",c=>t+=c);s.on("end",()=>{try{y(JSON.parse(t))}catch{n(new Error(t.slice(0,200)))}})});r.on("error",n);r.write(d);r.end()})}
function get(p,id,q,tk){return new Promise((y,n)=>{const qs=new URLSearchParams(q).toString();const r=https.request({hostname:"openapi.koreainvestment.com",port:9443,path:p+"?"+qs,method:"GET",headers:{"Content-Type":"application/json; charset=utf-8",authorization:"Bearer "+tk,appkey:process.env.KIS_APP_KEY,appsecret:process.env.KIS_APP_SECRET,tr_id:id,custtype:"P"}},s=>{let t="";s.on("data",c=>t+=c);s.on("end",()=>{const sc=s.statusCode;if(!t)return n(new Error(id+":H"+sc+":empty"));try{y(JSON.parse(t))}catch{n(new Error(id+":H"+sc+":"+t.slice(0,200)))}})});r.on("error",e=>n(new Error(id+":"+e.message)));r.end()})}
function w(ms){return new Promise(r=>setTimeout(r,ms))}
function fmt(n){if(!n)return"0";if(n>=1e12)return(n/1e12).toFixed(1)+"조";if(n>=1e8)return Math.round(n/1e8)+"억";return n.toLocaleString()}

// 토큰 캐싱
let _cache={token:"",exp:0};
async function getToken(){
  const now=Date.now();
  if(_cache.token&&_cache.exp>now+60000)return _cache.token;
  const td=await post("/oauth2/tokenP",{grant_type:"client_credentials",appkey:process.env.KIS_APP_KEY,appsecret:process.env.KIS_APP_SECRET});
  if(!td.access_token)throw new Error(JSON.stringify(td).slice(0,120));
  _cache={token:td.access_token,exp:now+(td.expires_in||86400)*1000};
  return td.access_token;
}

// 코스닥 종목 이름 세트
const KOSDAQ=new Set([
  '한미반도체','리노공업','원익IPS','피에스케이','HPSP','이오테크닉스','테스','주성엔지니어링',
  '에코프로','에코프로비엠','엘앤에프','천보','나노신소재','레이저쎌','에코프로HN',
  '현대로템','퍼스텍','빅텍','HLB','알테오젠','HLB생명과학','HLB제약','리가켐바이오',
  '한전기술','한전KPS','두산에너빌리티','비에이치아이','우리기술',
  '에스엠','JYP Ent.','키움증권','크래프톤','YG PLUS','와이지엔터테인먼트',
  'LIG넥스원','두산로보틱스','레인보우로보틱스','에스비비테크',
  '티로보틱스','뉴로메카','씨메스','HD현대로보틱스','로보스타','현대위아',
  '카카오게임즈','넷마블','엔씨소프트','펄어비스','컴투스','게임빌',
  '코스맥스','한국콜마','클리오','브이티','실리콘투','아이패밀리에스씨',
  '오스템임플란트','덴티움','인바디','뷰노','루닛','제이엘케이','딥노이드',
  '셀트리온헬스케어','유한양행','동아에스티','보령','광동제약','종근당','한미약품',
  'SK바이오팜','에이비엘바이오','유한양행','메디톡스','HLB바이오스텝'
]);

function parseS(arr,mkt=""){
  return(arr||[]).filter(i=>i&&i.hts_kor_isnm).map(i=>({
    name:i.hts_kor_isnm,code:i.mksc_shrn_iscd||i.stck_shrn_iscd,
    price:+i.stck_prpr,change:+i.prdy_ctrt,
    amt:+(i.acml_tr_pbmn||0),amtFmt:fmt(+(i.acml_tr_pbmn||0)),
    vol:+(i.acml_vol||0),isLimit:+i.prdy_ctrt>=29,
    market:KOSDAQ.has(i.hts_kor_isnm)?'Q':mkt
  }))
}

module.exports=async(req,res)=>{
  res.setHeader("Access-Control-Allow-Origin","*");
  res.setHeader("Cache-Control","no-store");
  if(req.method==="OPTIONS")return res.status(200).end();
  try{
    let tk;
    try{tk=await getToken();}catch(e){return res.status(500).json({ok:false,error:"token",d:e.message});}

    // ① 거래대금 순위 (KOSPI+KOSDAQ 합산 top 30)
    const vp={FID_COND_SCR_DIV_CODE:"20174",FID_INPUT_ISCD:"0000",FID_COND_MRKT_DIV_CODE:"J",
              FID_DIV_CLS_CODE:"0",FID_BLNG_CLS_CODE:"0",FID_TRGT_CLS_CODE:"111111111",
              FID_TRGT_EXLS_CLS_CODE:"000000",FID_INPUT_PRICE_1:"",FID_INPUT_PRICE_2:"",
              FID_VOL_CNT:"",FID_INPUT_DATE_1:""};
    const volJ=await get("/uapi/domestic-stock/v1/quotations/volume-rank","FHPST01710000",vp,tk);
    const volAll=parseS(volJ.output,"J");
    const seenVol=new Set(volAll.map(s=>s.code));

    await w(300);

    // ② 등락률 순위 top 100 시도 (chgrate-rank)
    let gainList=[],gainErr="";
    const gp={FID_COND_SCR_DIV_CODE:"20170",FID_COND_MRKT_DIV_CODE:"J",FID_INPUT_ISCD:"0000",
              FID_RANK_SORT_CLS_CODE:"0",FID_INPUT_CNT_1:"100",FID_PRC_CLS_CODE:"0",
              FID_INPUT_PRICE_1:"",FID_INPUT_PRICE_2:"",FID_VOL_CNT:"0",
              FID_TRGT_CLS_CODE:"0",FID_TRGT_EXLS_CLS_CODE:"0",FID_DIV_CLS_CODE:"0",
              FID_RSFL_RATE1:"",FID_RSFL_RATE2:""};
    // KOSPI 등락률 top100
    try{
      const r=await get("/uapi/domestic-stock/v1/quotations/chgrate-rank","FHPST01700000",gp,tk);
      if(r.output&&r.output.length>0){
        gainList=parseS(r.output,"J");
        gainList.forEach(s=>{if(!seenVol.has(s.code)){volAll.push(s);seenVol.add(s.code);}});
      } else gainErr+=`P:rt${r.rt_cd}:${r.msg1} `;
    }catch(e){gainErr+=`P:${e.message.slice(0,50)} `;}
    await w(200);
    // KOSDAQ 등락률 top100 (FHKST01700000 시도)
    try{
      const rq=await get("/uapi/domestic-stock/v1/quotations/chgrate-rank","FHKST01700000",
        {...gp,FID_COND_MRKT_DIV_CODE:"Q"},tk);
      if(rq.output&&rq.output.length>0){
        const kq=parseS(rq.output,"Q");
        kq.forEach(s=>{if(!seenVol.has(s.code)){volAll.push(s);seenVol.add(s.code);}});
        gainList=[...gainList,...kq];
      } else gainErr+=`K:rt${rq.rt_cd}:${rq.msg1}`;
    }catch(e){gainErr+=`K:${e.message.slice(0,50)}`;}

    await w(300);

    // ③ gainRanking: API 성공이면 gainList, 실패면 volAll 기반 fallback
    const gainRanking = gainList.length>0
      ? gainList.filter(s=>s.change>0).sort((a,b)=>b.isLimit-a.isLimit||b.change-a.change)
      : [...volAll].filter(s=>s.change>0).sort((a,b)=>b.isLimit-a.isLimit||b.change-a.change);

    const rising=[...volAll].filter(s=>s.change>0).sort((a,b)=>b.isLimit-a.isLimit||b.change-a.change);
    const kospis=volAll.filter(s=>s.market!=="Q").length;
    const kosdaqs=volAll.filter(s=>s.market==="Q").length;

    res.status(200).json({
      ok:true,_token:tk,
      date:new Date().toLocaleDateString("ko-KR",{timeZone:"Asia/Seoul"}),
      topVolume:[...volAll].sort((a,b)=>b.amt-a.amt).slice(0,60),
      topRising:rising,
      gainRanking,
      limitUp:volAll.filter(s=>s.isLimit),
      total:volAll.length,
      debug:{kospi:kospis,kosdaq:kosdaqs,gainApi:gainList.length,gainErr:gainErr||null,gainFallback:gainList.length===0}
    });
  }catch(e){res.status(500).json({ok:false,error:e.message})}
};
