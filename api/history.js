const https=require("https");
function post(p,b){return new Promise((y,n)=>{const d=JSON.stringify(b);const r=https.request({hostname:"openapi.koreainvestment.com",port:9443,path:p,method:"POST",headers:{"Content-Type":"application/json","Content-Length":Buffer.byteLength(d)}},s=>{let t="";s.on("data",c=>t+=c);s.on("end",()=>{try{y(JSON.parse(t))}catch{n(new Error(t.slice(0,200)))}})});r.on("error",n);r.write(d);r.end()})}
function get(p,id,q,tk){return new Promise((y,n)=>{const qs=new URLSearchParams(q).toString();const r=https.request({hostname:"openapi.koreainvestment.com",port:9443,path:p+"?"+qs,method:"GET",headers:{"Content-Type":"application/json; charset=utf-8",authorization:"Bearer "+tk,appkey:process.env.KIS_APP_KEY,appsecret:process.env.KIS_APP_SECRET,tr_id:id,custtype:"P"}},s=>{let t="";s.on("data",c=>t+=c);s.on("end",()=>{try{y(JSON.parse(t))}catch{n(new Error(id+":"+t.slice(0,200)))}})});r.on("error",e=>n(new Error(id+":"+e.message)));r.end()})}
function w(ms){return new Promise(r=>setTimeout(r,ms))}
function today(){const d=new Date();return d.getFullYear().toString()+String(d.getMonth()+1).padStart(2,"0")+String(d.getDate()).padStart(2,"0")}
module.exports=async(req,res)=>{
  res.setHeader("Access-Control-Allow-Origin","*");res.setHeader("Cache-Control","no-store");
  if(req.method==="OPTIONS")return res.status(200).end();
  const from=req.query.from||"20260102";const to=req.query.to||today();
  try{
    const td=await post("/oauth2/tokenP",{grant_type:"client_credentials",appkey:process.env.KIS_APP_KEY,appsecret:process.env.KIS_APP_SECRET});
    if(!td.access_token)return res.status(500).json({ok:false,error:"token_fail",detail:td.msg1||JSON.stringify(td).slice(0,200)});
    const tk=td.access_token;
    // 삼성전자 하나만 테스트
    const r1=await get("/uapi/domestic-stock/v1/quotations/inquire-daily-chartprice","FHKST03010100",{FID_COND_MRKT_DIV_CODE:"J",FID_INPUT_ISCD:"005930",FID_INPUT_DATE_1:from,FID_INPUT_DATE_2:to,FID_PERIOD_DIV_CODE:"D",FID_ORG_ADJ_PRC:"0"},tk);
    await w(500);
    // 다른 TR_ID도 시도
    const r2=await get("/uapi/domestic-stock/v1/quotations/inquire-daily-chartprice","FHKST01010100",{FID_COND_MRKT_DIV_CODE:"J",FID_INPUT_ISCD:"005930",FID_INPUT_DATE_1:from,FID_INPUT_DATE_2:to,FID_PERIOD_DIV_CODE:"D",FID_ORG_ADJ_PRC:"0"},tk);
    res.status(200).json({ok:true,from,to,
      FHKST03010100:{rt_cd:r1.rt_cd,msg1:r1.msg1,output1keys:Object.keys(r1.output1||r1.output||{}),output2len:(r1.output2||r1.output||[]).length,sample:JSON.stringify(r1).slice(0,400)},
      FHKST01010100:{rt_cd:r2.rt_cd,msg1:r2.msg1,output1keys:Object.keys(r2.output1||r2.output||{}),output2len:(r2.output2||r2.output||[]).length,sample:JSON.stringify(r2).slice(0,400)}
    });
  }catch(e){res.status(500).json({ok:false,error:e.message})}
};
