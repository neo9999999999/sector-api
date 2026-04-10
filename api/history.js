const https=require("https");
function post(p,b){return new Promise((y,n)=>{const d=JSON.stringify(b);const r=https.request({hostname:"openapi.koreainvestment.com",port:9443,path:p,method:"POST",headers:{"Content-Type":"application/json","Content-Length":Buffer.byteLength(d)}},s=>{let t="";s.on("data",c=>t+=c);s.on("end",()=>{try{y(JSON.parse(t))}catch{n(new Error(t.slice(0,200)))}})});r.on("error",n);r.write(d);r.end()})}
function get(p,id,q,tk){return new Promise((y,n)=>{const qs=new URLSearchParams(q).toString();const r=https.request({hostname:"openapi.koreainvestment.com",port:9443,path:p+"?"+qs,method:"GET",headers:{"Content-Type":"application/json; charset=utf-8",authorization:"Bearer "+tk,appkey:process.env.KIS_APP_KEY,appsecret:process.env.KIS_APP_SECRET,tr_id:id,custtype:"P"}},s=>{let t="";s.on("data",c=>t+=c);s.on("end",()=>{const sc=s.statusCode;if(!t)return n(new Error(id+":HTTP"+sc+":empty"));try{y(JSON.parse(t))}catch{n(new Error(id+":HTTP"+sc+":"+t.slice(0,200)))}})});r.on("error",e=>n(new Error(id+":"+e.message)));r.end()})}
function w(ms){return new Promise(r=>setTimeout(r,ms))}
function today(){const d=new Date(new Date().toLocaleString("en-US",{timeZone:"Asia/Seoul"}));return d.getFullYear().toString()+String(d.getMonth()+1).padStart(2,"0")+String(d.getDate()).padStart(2,"0")}
function chgRate(close,vrss){const prev=close-vrss;return prev?+(vrss/prev*100).toFixed(2):0}

// 실제 KIS API에서 확인된 종목 코드 기반 — 오늘 실제 거래된 상위 종목들
const STOCKS=[
  // ── 통신 테마 ──────────────────────────────────
  {code:"010170",name:"대한광통신",sector:"통신"},
  {code:"050890",name:"쏠리드",sector:"통신"},
  {code:"088800",name:"에이스테크",sector:"통신"},
  {code:"035460",name:"기산텔레콤",sector:"통신"},
  {code:"072950",name:"빛샘전자",sector:"통신"},
  {code:"069540",name:"빛과전자",sector:"통신"},
  {code:"046970",name:"우리로",sector:"통신"},
  // ── 반도체 ─────────────────────────────────────
  {code:"005930",name:"삼성전자",sector:"반도체"},
  {code:"000660",name:"SK하이닉스",sector:"반도체"},
  {code:"042700",name:"한미반도체",sector:"반도체장비"},
  {code:"011070",name:"LG이노텍",sector:"반도체장비"},
  {code:"005290",name:"동진쎄미켐",sector:"반도체소재"},
  {code:"011930",name:"신성이엔지",sector:"반도체"},
  {code:"429270",name:"시지트로닉스",sector:"반도체"},
  {code:"490470",name:"세미파이브",sector:"반도체"},
  // ── 해운·이란전쟁 ───────────────────────────────
  {code:"005880",name:"대한해운",sector:"해운"},
  {code:"003280",name:"흥아해운",sector:"해운"},
  {code:"044180",name:"KSS해운",sector:"해운"},
  // ── 방산 ────────────────────────────────────────
  {code:"079550",name:"LIG넥스원",sector:"방산"},
  {code:"010820",name:"퍼스텍",sector:"방산"},
  {code:"012450",name:"한화에어로스페이스",sector:"방산"},
  {code:"047050",name:"포스코인터내셔널",sector:"방산"},
  // ── 재건건설 ────────────────────────────────────
  {code:"047040",name:"대우건설",sector:"재건건설"},
  {code:"006360",name:"GS건설",sector:"재건건설"},
  {code:"038500",name:"삼표시멘트",sector:"재건건설"},
  // ── 원전 ────────────────────────────────────────
  {code:"034020",name:"두산에너빌리티",sector:"원전"},
  {code:"267260",name:"HD현대일렉트릭",sector:"전력기기"},
  // ── 2차전지 ─────────────────────────────────────
  {code:"006400",name:"삼성SDI",sector:"2차전지"},
  {code:"373220",name:"LG에너지솔루션",sector:"2차전지"},
  // ── 조선 ────────────────────────────────────────
  {code:"329180",name:"HD현대중공업",sector:"조선"},
  {code:"010140",name:"삼성중공업",sector:"조선"},
  // ── 자동차 ──────────────────────────────────────
  {code:"005380",name:"현대차",sector:"자동차"},
  {code:"000270",name:"기아",sector:"자동차"},
  // ── 바이오 ──────────────────────────────────────
  {code:"068270",name:"셀트리온",sector:"바이오"},
  {code:"028300",name:"HLB",sector:"바이오"},
  // ── 스테이블코인 ────────────────────────────────
  {code:"064260",name:"다날",sector:"스테이블코인"},
];

module.exports=async(req,res)=>{
  res.setHeader("Access-Control-Allow-Origin","*");res.setHeader("Cache-Control","no-store");
  if(req.method==="OPTIONS")return res.status(200).end();
  const from=req.query.from||"20260102";const to=req.query.to||today();
  try{
    const td=await post("/oauth2/tokenP",{grant_type:"client_credentials",appkey:process.env.KIS_APP_KEY,appsecret:process.env.KIS_APP_SECRET});
    if(!td.access_token)return res.status(500).json({ok:false,error:"token_fail"});
    const tk=td.access_token;
    const results={};
    for(const s of STOCKS){
      try{
        await w(250);
        const r=await get("/uapi/domestic-stock/v1/quotations/inquire-daily-price","FHKST03010100",
          {FID_COND_MRKT_DIV_CODE:"J",FID_INPUT_ISCD:s.code,FID_INPUT_DATE_1:from,FID_INPUT_DATE_2:to,FID_PERIOD_DIV_CODE:"D",FID_ORG_ADJ_PRC:"0"},tk);
        const rows=r.output2||r.output||[];
        if(rows.length>0){
          results[s.code]={name:s.name,sector:s.sector,
            prices:rows.map(d=>({
              date:d.stck_bsop_date,
              close:+d.stck_clpr,
              change:chgRate(+d.stck_clpr,+d.prdy_vrss),
              vol:+d.acml_vol,
              amt:+d.acml_tr_pbmn||0
            }))
          };
        }
      }catch(e){}
    }
    // 날짜별 섹터 모멘텀 집계
    const dateMap={};
    for(const[code,data]of Object.entries(results)){
      if(!data.prices)continue;
      for(const p of data.prices){
        if(!dateMap[p.date])dateMap[p.date]={};
        if(!dateMap[p.date][data.sector])dateMap[p.date][data.sector]=[];
        dateMap[p.date][data.sector].push({code,name:data.name,...p});
      }
    }
    const dates=Object.keys(dateMap).sort();
    const backtest=dates.map((date,i)=>{
      const ss=Object.entries(dateMap[date])
        .map(([sector,stocks])=>{
          const sorted=[...stocks].sort((a,b)=>b.change-a.change);
          const avg=stocks.reduce((t,x)=>t+x.change,0)/stocks.length;
          return{sector,leader:sorted[0]?.name,leaderChange:sorted[0]?.change,avg:+avg.toFixed(2),stocks:sorted.slice(0,5)};
        })
        .filter(s=>s.avg>0)
        .sort((a,b)=>b.avg-a.avg);
      const top=ss[0];
      let nextDayReturn=null;
      if(top&&i+1<dates.length){
        const nxt=dateMap[dates[i+1]]?.[top.sector];
        if(nxt){const nl=nxt.find(s=>s.code===results[Object.keys(results).find(k=>results[k].name===top.leader)]?.prices?.[0]?.code)||nxt[0];if(nl)nextDayReturn=+nl.change.toFixed(2);}
      }
      const hasNext=i+1<dates.length;
      const won=hasNext&&typeof nextDayReturn==="number"&&nextDayReturn>0;
      return{date,topSector:top?.sector||"-",topSectors:ss,leaderChange:top?.avg||0,nextDayReturn:hasNext?nextDayReturn:null,won:hasNext?won:null};
    });
    const rated=backtest.filter(x=>x.nextDayReturn!==null);
    const wins=rated.filter(x=>x.won).length;
    const winRate=rated.length?Math.round(wins/rated.length*100):0;
    res.status(200).json({ok:true,from,to,stockCount:Object.keys(results).length,dates:dates.length,backtest,winRate,dataSource:"KIS-realtime"});
  }catch(e){res.status(500).json({ok:false,error:e.message})}
};
