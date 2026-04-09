const https=require("https");
function get(p,id,q,tk){return new Promise((y,n)=>{const qs=new URLSearchParams(q).toString();const r=https.request({hostname:"openapi.koreainvestment.com",port:9443,path:p+"?"+qs,method:"GET",headers:{"Content-Type":"application/json; charset=utf-8",authorization:"Bearer "+tk,appkey:process.env.KIS_APP_KEY,appsecret:process.env.KIS_APP_SECRET,tr_id:id,custtype:"P"}},s=>{let t="";s.on("data",c=>t+=c);s.on("end",()=>{try{y(JSON.parse(t))}catch{n(new Error(id+":"+t.slice(0,300)))}})});r.on("error",e=>n(new Error(id+":"+e.message)));r.end()})}
function post(p,b){return new Promise((y,n)=>{const d=JSON.stringify(b);const r=https.request({hostname:"openapi.koreainvestment.com",port:9443,path:p,method:"POST",headers:{"Content-Type":"application/json","Content-Length":Buffer.byteLength(d)}},s=>{let t="";s.on("data",c=>t+=c);s.on("end",()=>{try{y(JSON.parse(t))}catch{n(new Error(t.slice(0,200)))}})});r.on("error",n);r.write(d);r.end()})}
function w(ms){return new Promise(r=>setTimeout(r,ms))}
function today(){const d=new Date();return d.getFullYear().toString()+String(d.getMonth()+1).padStart(2,"0")+String(d.getDate()).padStart(2,"0")}
const STOCKS=[
  {code:"005930",name:"삼성전자",sector:"반도체"},
  {code:"373220",name:"LG에너지솔루션",sector:"2차전지"},
  {code:"012450",name:"한화에어로스페이스",sector:"방산"},
  {code:"329180",name:"HD현대중공업",sector:"조선"},
  {code:"034020",name:"두산에너빌리티",sector:"원전"},
];
module.exports=async(req,res)=>{
  res.setHeader("Access-Control-Allow-Origin","*");res.setHeader("Cache-Control","no-store");
  if(req.method==="OPTIONS")return res.status(200).end();
  const from=req.query.from||"20260102";const to=req.query.to||today();
  let tk=req.query.token||null;
  if(!tk){
    try{const td=await post("/oauth2/tokenP",{grant_type:"client_credentials",appkey:process.env.KIS_APP_KEY,appsecret:process.env.KIS_APP_SECRET});if(!td.access_token)return res.status(500).json({ok:false,error:"token_fail",detail:JSON.stringify(td).slice(0,300)});tk=td.access_token;}
    catch(e){return res.status(500).json({ok:false,error:"token_err:"+e.message});}
  }
  const results={};
  for(const s of STOCKS){
    try{
      await w(100);
      const r=await get("/uapi/domestic-stock/v1/quotations/inquire-daily-chartprice","FHKST03010100",{FID_COND_MRKT_DIV_CODE:"J",FID_INPUT_ISCD:s.code,FID_INPUT_DATE_1:from,FID_INPUT_DATE_2:to,FID_PERIOD_DIV_CODE:"D",FID_ORG_ADJ_PRC:"0"},tk);
      const rows=r.output2||[];
      if(rows.length>0){results[s.code]={name:s.name,sector:s.sector,count:rows.length,sample:rows[0]};}
      else{results[s.code]={name:s.name,sector:s.sector,status:"empty",rt_cd:r.rt_cd,msg1:r.msg1,keys:Object.keys(r)};}
    }catch(e){results[s.code]={name:s.name,sector:s.sector,status:"error",error:e.message};}
  }
  res.status(200).json({ok:true,from,to,results});
};
