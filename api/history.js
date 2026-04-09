const https=require("https");
function post(p,b){return new Promise((y,n)=>{const d=JSON.stringify(b);const r=https.request({hostname:"openapi.koreainvestment.com",port:9443,path:p,method:"POST",headers:{"Content-Type":"application/json","Content-Length":Buffer.byteLength(d)}},s=>{let t="";s.on("data",c=>t+=c);s.on("end",()=>{try{y(JSON.parse(t))}catch{n(new Error(t.slice(0,200)))}})});r.on("error",n);r.write(d);r.end()})}
  function get(p,id,q,tk){return new Promise((y,n)=>{const qs=new URLSearchParams(q).toString();const r=https.request({hostname:"openapi.koreainvestment.com",port:9443,path:p+"?"+qs,method:"GET",headers:{"Content-Type":"application/json; charset=utf-8",authorization:"Bearer "+tk,appkey:process.env.KIS_APP_KEY,appsecret:process.env.KIS_APP_SECRET,tr_id:id,custtype:"P"}},s=>{let t="";s.on("data",c=>t+=c);s.on("end",()=>{try{y(JSON.parse(t))}catch{n(new Error(id+":"+t.slice(0,200)))}})});r.on("error",e=>n(new Error(id+":"+e.message)));r.end()})}
function w(ms){return new Promise(r=>setTimeout(r,ms))}

// 섹터별 대표 종목
const STOCKS=[
{code:"005930",name:"삼성전자",sector:"반도체"},
{code:"000660",name:"SK하이닉스",sector:"반도체"},
{code:"042700",name:"한미반도체",sector:"반도체장비"},
{code:"009150",name:"삼성전기",sector:"반도체장비"},
{code:"373220",name:"LG에너지솔루션",sector:"2차전지"},
{code:"006400",name:"삼성SDI",sector:"2차전지"},
{code:"012450",name:"한화에어로스페이스",sector:"방산"},
{code:"329180",name:"HD현대중공업",sector:"조선"},
{code:"042660",name:"한화오션",sector:"조선"},
{code:"009540",name:"HD한국조선해양",sector:"조선"},
{code:"034020",name:"두산에너빌리티",sector:"원전"},
{code:"267260",name:"HD현대일렉트릭",sector:"전력기기"},
{code:"005380",name:"현대차",sector:"자동차"},
{code:"005490",name:"POSCO홀딩스",sector:"철강"},
{code:"207940",name:"삼성바이오로직스",sector:"바이오"},
{code:"068270",name:"셀트리온",sector:"바이오"},
{code:"028260",name:"삼성물산",sector:"건설"},
{code:"035420",name:"NAVER",sector:"IT/AI"},
{code:"005935",name:"삼성전자우",sector:"반도체"},
{code:"298040",name:"효성중공업",sector:"전력기기"},
];

module.exports=async(req,res)=>{
  res.setHeader("Access-Control-Allow-Origin","*");
  res.setHeader("Cache-Control","no-store");
  if(req.method==="OPTIONS")return res.status(200).end();

  // 기간 파라미터 (기본: 2026-01-02 ~ 오늘)
  const from=req.query.from||"20260102";
  const to=req.query.to||new Date().toLocaleDateString("ko-KR",{timeZone:"Asia/Seoul"}).replace(/\. /g,"").replace(".","");

      try{
    const td=await post("/oauth2/tokenP",{grant_type:"client_credentials",appkey:process.env.KIS_APP_KEY,appsecret:process.env.KIS_APP_SECRET});
    if(!td.access_token)return res.status(500).json({ok:false,error:"token"});
    const tk=td.access_token;

    const results={};
    for(const s of STOCKS){
            try{
              await w(400);
              const r=await get("/uapi/domestic-stock/v1/quotations/inquire-daily-chartprice","FHKST03010100",{
                FID_COND_MRKT_DIV_CODE:"J",
                FID_INPUT_ISCD:s.code,
                FID_INPUT_DATE_1:from,
                FID_INPUT_DATE_2:to,
                FID_PERIOD_DIV_CODE:"D",
                FID_ORG_ADJ_PRC:"0"
      },tk);
        if(r.output2&&r.output2.length>0){
          results[s.code]={
                        name:s.name,
                        sector:s.sector,
                        prices:r.output2.map(d=>({
                          date:d.stck_bsop_date,
                          open:+d.stck_oprc,
                          high:+d.stck_hgpr,
                          low:+d.stck_lwpr,
                          close:+d.stck_clpr,
                          change:+d.prdy_ctrt,
                          vol:+d.acml_vol,
                          amt:+d.acml_tr_pbmn
            }))
            };
        }
  }catch(e){results[s.code]={name:s.name,sector:s.sector,error:e.message}}
}

    // 날짜별로 섹터 모멘텀 계산
    const dateMap={};
    for(const [code,data] of Object.entries(results)){
      if(!data.prices)continue;
      for(const p of data.prices){
        if(!dateMap[p.date])dateMap[p.date]={};
        if(!dateMap[p.date][data.sector])dateMap[p.date][data.sector]=[];
        dateMap[p.date][data.sector].push({code,name:data.name,...p});
}
}

    // 날짜별 주도섹터 + 다음날 수익률 계산
    const dates=Object.keys(dateMap).sort();
    const backtest=dates.map((date,i)=>{
      const sectors=dateMap[date];
      const sectorStats=Object.entries(sectors).map(([sector,stocks])=>{
        const rising=stocks.filter(s=>s.change>0);
        const leader=stocks.sort((a,b)=>b.change-a.change)[0];
        const avgChange=stocks.reduce((sum,s)=>sum+s.change,0)/stocks.length;
        return {sector,leader,avgChange,risingCount:rising.length,totalCount:stocks.length};
}).filter(s=>s.avgChange>0).sort((a,b)=>b.avgChange-a.avgChange);

      const topSector=sectorStats[0];
      let nextDayReturn=null;
      if(topSector&&i+1<dates.length){
        const nextDate=dates[i+1];
        const nextData=dateMap[nextDate]?.[topSector.sector];
        if(nextData){
          const nextLeader=nextData.find(s=>s.code===topSector.leader?.code);
          if(nextLeader)nextDayReturn=nextLeader.change;
        }
        }

      return {date,topSector:topSector?.sector||null,leader:topSector?.leader?.name||null,leaderChange:topSector?.leader?.change||null,nextDayReturn,sectorCount:sectorStats.length,allSectors:sectorStats.slice(0,3)};
});

    res.status(200).json({ok:true,from,to,stockCount:Object.keys(results).length,dates:dates.length,backtest,rawByDate:dateMap});
}catch(e){res.status(500).json({ok:false,error:e.message})}
};
