const https=require("https");
function post(p,b){return new Promise((y,n)=>{const d=JSON.stringify(b);const r=https.request({hostname:"openapi.koreainvestment.com",port:9443,path:p,method:"POST",headers:{"Content-Type":"application/json","Content-Length":Buffer.byteLength(d)}},s=>{let t="";s.on("data",c=>t+=c);s.on("end",()=>{try{y(JSON.parse(t))}catch{n(new Error(t.slice(0,200)))}})});r.on("error",n);r.write(d);r.end()})}
function get(p,id,q,tk){return new Promise((y,n)=>{const qs=new URLSearchParams(q).toString();const r=https.request({hostname:"openapi.koreainvestment.com",port:9443,path:p+"?"+qs,method:"GET",headers:{"Content-Type":"application/json; charset=utf-8",authorization:"Bearer "+tk,appkey:process.env.KIS_APP_KEY,appsecret:process.env.KIS_APP_SECRET,tr_id:id,custtype:"P"}},s=>{let t="";s.on("data",c=>t+=c);s.on("end",()=>{try{y(JSON.parse(t))}catch{n(new Error(id+":"+t.slice(0,300)))}})});r.on("error",e=>n(new Error(id+":"+e.message)));r.end()})}
function w(ms){return new Promise(r=>setTimeout(r,ms))}
function today(){const d=new Date();return d.getFullYear().toString()+String(d.getMonth()+1).padStart(2,"0")+String(d.getDate()).padStart(2,"0")}
const STOCKS=[{code:"005930",name:"삼성전자",sector:"반도체"},{code:"000660",name:"SK하이닉스",sector:"반도체"},{code:"042700",name:"한미반도체",sector:"반도체장비"},{code:"373220",name:"LG에너지솔루션",sector:"2차전지"},{code:"006400",name:"삼성SDI",sector:"2차전지"},{code:"012450",name:"한화에어로스페이스",sector:"방산"},{code:"329180",name:"HD현대중공업",sector:"조선"},{code:"042660",name:"한화오션",sector:"조선"},{code:"034020",name:"두산에너빌리티",sector:"원전"},{code:"267260",name:"HD현대일렉트릭",sector:"전력기기"},{code:"005380",name:"현대차",sector:"자동차"},{code:"005490",name:"POSCO홀딩스",sector:"철강"},{code:"207940",name:"삼성바이오로직스",sector:"바이오"},{code:"068270",name:"셀트리온",sector:"바이오"},{code:"028260",name:"삼성물산",sector:"건설"}];
module.exports=async(req,res)=>{
  res.setHeader("Access-Control-Allow-Origin","*");res.setHeader("Cache-Control","no-store");
  if(req.method==="OPTIONS")return res.status(200).end();
  const from=req.query.from||"20260102";const to=req.query.to||today();
  // market-data에서 받은 토큰 재사용 가능, 없으면 새로 발급
  let tk=req.query.token||req.headers['x-token']||null;
  if(!tk){
    try{
      const td=await post("/oauth2/tokenP",{grant_type:"client_credentials",appkey:process.env.KIS_APP_KEY,appsecret:process.env.KIS_APP_SECRET});
      if(!td.access_token)return res.status(500).json({ok:false,error:"token_fail",detail:JSON.stringify(td).slice(0,300)});
      tk=td.access_token;
    }catch(e){return res.status(500).json({ok:false,error:"token_error:"+e.message});}
  }
  try{
    const results={};const sample1={};
    for(const s of STOCKS){
      try{
        await w(300);
        const r=await get("/uapi/domestic-stock/v1/quotations/inquire-daily-chartprice","FHKST03010100",{FID_COND_MRKT_DIV_CODE:"J",FID_INPUT_ISCD:s.code,FID_INPUT_DATE_1:from,FID_INPUT_DATE_2:to,FID_PERIOD_DIV_CODE:"D",FID_ORG_ADJ_PRC:"0"},tk);
        const rows=r.output2||r.output||[];
        if(Object.keys(sample1).length===0)Object.assign(sample1,{rt_cd:r.rt_cd,msg1:r.msg1,output2_len:(r.output2||[]).length,output_len:(r.output||[]).length,first_row:JSON.stringify(rows[0]).slice(0,200)});
        if(rows.length>0){results[s.code]={name:s.name,sector:s.sector,prices:rows.map(d=>({date:d.stck_bsop_date,close:+d.stck_clpr,change:+d.prdy_ctrt,vol:+d.acml_vol,amt:+d.acml_tr_pbmn}))};}
        else{results[s.code]={name:s.name,sector:s.sector,error:"empty"};}
      }catch(e){results[s.code]={name:s.name,sector:s.sector,error:e.message}}
    }
    const dateMap={};
    for(const[code,data]of Object.entries(results)){if(!data.prices)continue;for(const p of data.prices){if(!dateMap[p.date])dateMap[p.date]={};if(!dateMap[p.date][data.sector])dateMap[p.date][data.sector]=[];dateMap[p.date][data.sector].push({code,name:data.name,...p});}}
    const dates=Object.keys(dateMap).sort();
    const backtest=dates.map((date,i)=>{
      const ss=Object.entries(dateMap[date]).map(([sector,stocks])=>{const sorted=[...stocks].sort((a,b)=>b.change-a.change);return{sector,leader:sorted[0],avgChange:stocks.reduce((s,x)=>s+x.change,0)/stocks.length};}).filter(s=>s.avgChange>0).sort((a,b)=>b.avgChange-a.avgChange);
      const top=ss[0];let nextDayReturn=null;
      if(top&&i+1<dates.length){const nxt=dateMap[dates[i+1]]?.[top.sector];if(nxt){const nl=nxt.find(s=>s.code===top.leader?.code);if(nl)nextDayReturn=nl.change;}}
      return{date,topSector:top?.sector||null,leader:top?.leader?.name||null,leaderChange:top?.leader?.change||null,nextDayReturn,topSectors:ss.slice(0,5).map(s=>({sector:s.sector,avg:+s.avgChange.toFixed(2),leader:s.leader?.name,leaderChange:s.leader?.change}))};
    });
    const won=backtest.filter(d=>d.nextDayReturn>0).length;const tot=backtest.filter(d=>d.nextDayReturn!==null).length;
    res.status(200).json({ok:true,from,to,stockCount:Object.keys(results).filter(k=>results[k].prices).length,dates:dates.length,winRate:tot?Math.round(won/tot*100):0,backtest,sample1});
  }catch(e){res.status(500).json({ok:false,error:e.message})}
};
