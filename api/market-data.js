const https=require("https");
function post(p,b){return new Promise((y,n)=>{const d=JSON.stringify(b);const r=https.request({hostname:"openapi.koreainvestment.com",port:9443,path:p,method:"POST",headers:{"Content-Type":"application/json","Content-Length":Buffer.byteLength(d)}},s=>{let t="";s.on("data",c=>t+=c);s.on("end",()=>{try{y(JSON.parse(t))}catch{n(new Error(t.slice(0,200)))}})});r.on("error",n);r.write(d);r.end()})}
function get(p,id,q,tk){return new Promise((y,n)=>{const qs=new URLSearchParams(q).toString();const r=https.request({hostname:"openapi.koreainvestment.com",port:9443,path:p+"?"+qs,method:"GET",headers:{"Content-Type":"application/json; charset=utf-8",authorization:"Bearer "+tk,appkey:process.env.KIS_APP_KEY,appsecret:process.env.KIS_APP_SECRET,tr_id:id,custtype:"P"}},s=>{let t="";s.on("data",c=>t+=c);s.on("end",()=>{const sc=s.statusCode;if(!t)return n(new Error(id+":H"+sc+":empty"));try{y(JSON.parse(t))}catch{n(new Error(id+":H"+sc+":"+t.slice(0,200)))}})});r.on("error",e=>n(new Error(id+":"+e.message)));r.end()})}
function w(ms){return new Promise(r=>setTimeout(r,ms))}
function fmt(n){if(!n)return"";if(n>=1e12)return(n/1e12).toFixed(1)+"조";if(n>=1e8)return Math.round(n/1e8)+"억";if(n>=1e4)return Math.round(n/1e4)+"만";return n.toLocaleString()}

// 토큰 캐시
let _tkCache={token:"",exp:0};
async function getToken(){
  const now=Date.now();
  if(_tkCache.token&&_tkCache.exp>now+60000)return _tkCache.token;
  const td=await post("/oauth2/tokenP",{grant_type:"client_credentials",appkey:process.env.KIS_APP_KEY,appsecret:process.env.KIS_APP_SECRET});
  if(!td.access_token)throw new Error(JSON.stringify(td).slice(0,120));
  _tkCache={token:td.access_token,exp:now+(td.expires_in||86400)*1000};
  return td.access_token;
}

// 종목 정보 캐시 (시장구분 + 업종코드) - Vercel 인스턴스 간 공유 안 되지만 같은 인스턴스 내 재사용
const _stockInfoCache=new Map(); // code -> {market, sector, sectorName}

// KIS 업종코드 → 한글 섹터명 매핑 (API에서 받은 코드 기반)
const SECTOR_CODE_MAP={
  "G10":"에너지","G15":"소재","G20":"산업재","G25":"경기소비재","G30":"필수소비재",
  "G35":"헬스케어","G40":"금융","G45":"IT","G50":"통신서비스","G55":"유틸리티",
  "G60":"부동산",
  // KIS 자체 업종코드
  "01":"식품","02":"섬유·의복","03":"종이·목재","04":"화학","05":"의약품",
  "06":"비금속광물","07":"철강·금속","08":"기계","09":"전기·전자","10":"의료·정밀기기",
  "11":"운수·장비","12":"유통업","13":"전기·가스","14":"건설업","15":"운수·창고",
  "16":"통신업","17":"금융업","18":"증권","19":"보험","20":"서비스업",
  "21":"제조업","WIG":"전체"
};

async function getStockInfo(code,tk){
  if(_stockInfoCache.has(code))return _stockInfoCache.get(code);
  try{
    const r=await get("/uapi/domestic-stock/v1/quotations/search-stock-info","CTPF1002R",{PRDT_TYPE_CD:"300",PDNO:code},tk);
    if(r.rt_cd==="0"&&r.output){
      const o=r.output;
      const mktId=o.mket_id_cd||"";
      // STK=코스피, KSQ=코스닥, ELW/ETF 등
      const market=mktId==="KSQ"?"Q":mktId==="STK"?"J":mktId;
      const sectorCode=o.idx_bztp_mcls_cd||o.idx_bztp_lcls_cd||"";
      const sectorName=SECTOR_CODE_MAP[sectorCode]||sectorCode||"기타";
      const info={market,sectorCode,sectorName,isETF:o.etf_dvsn_cd&&o.etf_dvsn_cd!=="0"};
      _stockInfoCache.set(code,info);
      return info;
    }
  }catch(e){}
  return null;
}

function parseVolRank(arr){
  return(arr||[]).filter(i=>i&&i.hts_kor_isnm).map(i=>({
    name:i.hts_kor_isnm,
    code:i.mksc_shrn_iscd||i.stck_shrn_iscd,
    price:+i.stck_prpr,
    change:+i.prdy_ctrt,
    amt:+(i.acml_tr_pbmn||0),
    amtFmt:fmt(+(i.acml_tr_pbmn||0)),
    vol:+(i.acml_vol||0),
    isLimit:+i.prdy_ctrt>=29,
    market:"J" // 나중에 enrichStocks에서 실제 시장으로 업데이트
  }))
}

function parseGainRank(arr){
  return(arr||[]).filter(i=>i&&i.hts_kor_isnm).map(i=>({
    name:i.hts_kor_isnm,
    code:i.mksc_shrn_iscd||i.stck_shrn_iscd,
    price:+i.stck_prpr,
    change:+i.prdy_ctrt,
    amt:+(i.acml_tr_pbmn||0),
    amtFmt:fmt(+(i.acml_tr_pbmn||0)),
    vol:+(i.acml_vol||0),
    isLimit:+i.prdy_ctrt>=29,
    market:"J"
  }))
}

// 종목 리스트에 실제 시장구분 + 업종 정보 enrichment
// 너무 많으면 느려지므로 최대 20개만 조회 (나머지는 코드 패턴으로 추정)
async function enrichStocks(stocks,tk){
  // 코드 기반 1차 추정: 6자리 숫자 코드에서 첫 번째 자리로는 구분 불가
  // 대신 stock-info API 병렬 호출 (최대 15개, 딜레이 포함)
  const targets=stocks.slice(0,15);
  for(let i=0;i<targets.length;i++){
    if(i>0)await w(120); // rate limit 방지
    const info=await getStockInfo(targets[i].code,tk);
    if(info){
      targets[i].market=info.market;
      if(info.sectorName&&info.sectorName!=="기타"){
        targets[i].sectorFromApi=info.sectorName;
        targets[i].sectorCode=info.sectorCode;
      }
      if(info.isETF)targets[i]._isETF=true;
    }
  }
  // 나머지는 J 유지
  return stocks.filter(s=>!s._isETF); // ETF 제거
}

module.exports=async(req,res)=>{
  res.setHeader("Access-Control-Allow-Origin","*");
  res.setHeader("Cache-Control","no-store");
  if(req.method==="OPTIONS")return res.status(200).end();
  try{
    let tk;
    try{tk=await getToken();}catch(e){return res.status(500).json({ok:false,error:"token",d:e.message});}

    // 1. 거래대금 순위 (KOSPI+KOSDAQ 통합, KIS API 지원 방식)
    const vp={FID_COND_SCR_DIV_CODE:"20174",FID_INPUT_ISCD:"0000",FID_COND_MRKT_DIV_CODE:"J",
              FID_DIV_CLS_CODE:"0",FID_BLNG_CLS_CODE:"0",FID_TRGT_CLS_CODE:"111111111",
              FID_TRGT_EXLS_CLS_CODE:"000000",FID_INPUT_PRICE_1:"",FID_INPUT_PRICE_2:"",
              FID_VOL_CNT:"",FID_INPUT_DATE_1:""};
    const volJ=await get("/uapi/domestic-stock/v1/quotations/volume-rank","FHPST01710000",vp,tk);
    let volAll=parseVolRank(volJ.output);

    await w(400);

    // 2. 등락률 순위 (ranking/fluctuation — 검증된 경로)
    let gainRanking=[],gainApiOk=false,gainErr="";
    try{
      const gp={FID_COND_SCR_DIV_CODE:"20171",FID_INPUT_ISCD:"0000",FID_COND_MRKT_DIV_CODE:"J",
                FID_RANK_SORT_CLS_CODE:"0",FID_INPUT_CNT_1:"0",FID_PRC_CLS_CODE:"0",
                FID_INPUT_PRICE_1:"",FID_INPUT_PRICE_2:"",FID_VOL_CNT:"",
                FID_TRGT_CLS_CODE:"0",FID_TRGT_EXLS_CLS_CODE:"0",FID_DIV_CLS_CODE:"0",
                FID_RSFL_RATE1:"",FID_RSFL_RATE2:""};
      const r=await get("/uapi/domestic-stock/v1/ranking/fluctuation","FHPST01700000",gp,tk);
      if(r.output?.length){
        gainRanking=parseGainRank(r.output).filter(s=>s.change>0);
        gainApiOk=true;
      } else gainErr=`rt:${r.rt_cd} msg:${r.msg1}`;
    }catch(e){gainErr=e.message.slice(0,80);}

    if(!gainApiOk){
      gainRanking=[...volAll].filter(s=>s.change>0).sort((a,b)=>b.isLimit-a.isLimit||b.change-a.change);
    }

    // 3. 거래대금 + 등락률 상위 종목에 실제 시장구분 enrichment
    // 두 리스트 합쳐서 unique code set으로 enrichment
    const allForEnrich=[...volAll,...gainRanking.slice(0,10)];
    const seen=new Set();const uniqueForEnrich=allForEnrich.filter(s=>{if(seen.has(s.code))return false;seen.add(s.code);return true;});
    await enrichStocks(uniqueForEnrich,tk);

    // enrichment 결과를 volAll과 gainRanking에 반영
    const infoMap=new Map(uniqueForEnrich.map(s=>[s.code,{market:s.market,sectorFromApi:s.sectorFromApi,sectorCode:s.sectorCode}]));
    volAll=volAll.filter(s=>!uniqueForEnrich.find(u=>u.code===s.code&&u._isETF));
    volAll.forEach(s=>{const inf=infoMap.get(s.code);if(inf){s.market=inf.market;if(inf.sectorFromApi)s.sectorFromApi=inf.sectorFromApi;}});
    gainRanking=gainRanking.filter(s=>!uniqueForEnrich.find(u=>u.code===s.code&&u._isETF));
    gainRanking.forEach(s=>{const inf=infoMap.get(s.code);if(inf){s.market=inf.market;if(inf.sectorFromApi)s.sectorFromApi=inf.sectorFromApi;}});
    gainRanking.sort((a,b)=>b.isLimit-a.isLimit||b.change-a.change);

    const kospis=volAll.filter(s=>s.market==="J").length;
    const kosdaqs=volAll.filter(s=>s.market==="Q").length;

    res.status(200).json({
      ok:true,_token:tk,
      date:new Date().toLocaleDateString("ko-KR",{timeZone:"Asia/Seoul"}),
      topVolume:[...volAll].sort((a,b)=>b.amt-a.amt),
      topRising:[...volAll].filter(s=>s.change>0).sort((a,b)=>b.isLimit-a.isLimit||b.change-a.change),
      gainRanking,
      limitUp:volAll.filter(s=>s.isLimit),
      total:volAll.length,
      debug:{kospi:kospis,kosdaq:kosdaqs,gainApiOk,gainLen:gainRanking.length,gainErr:gainErr||null,enriched:uniqueForEnrich.length}
    });
  }catch(e){res.status(500).json({ok:false,error:e.message})}
};
