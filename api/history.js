const https=require("https");
function post(p,b){return new Promise((y,n)=>{const d=JSON.stringify(b);const r=https.request({hostname:"openapi.koreainvestment.com",port:9443,path:p,method:"POST",headers:{"Content-Type":"application/json","Content-Length":Buffer.byteLength(d)}},s=>{let t="";s.on("data",c=>t+=c);s.on("end",()=>{try{y(JSON.parse(t))}catch{n(new Error(t.slice(0,200)))}})});r.on("error",n);r.write(d);r.end()})}
function get(p,id,q,tk){return new Promise((y,n)=>{const qs=new URLSearchParams(q).toString();const r=https.request({hostname:"openapi.koreainvestment.com",port:9443,path:p+"?"+qs,method:"GET",headers:{"Content-Type":"application/json; charset=utf-8",authorization:"Bearer "+tk,appkey:process.env.KIS_APP_KEY,appsecret:process.env.KIS_APP_SECRET,tr_id:id,custtype:"P"}},s=>{let t="";s.on("data",c=>t+=c);s.on("end",()=>{const sc=s.statusCode;if(!t)return n(new Error(id+":HTTP"+sc+":empty"));try{y(JSON.parse(t))}catch{n(new Error(id+":HTTP"+sc+":"+t.slice(0,200)))}})});r.on("error",e=>n(new Error(id+":"+e.message)));r.end()})}
function w(ms){return new Promise(r=>setTimeout(r,ms))}
function today(){const d=new Date();return d.getFullYear().toString()+String(d.getMonth()+1).padStart(2,"0")+String(d.getDate()).padStart(2,"0")}

module.exports=async(req,res)=>{
  res.setHeader("Access-Control-Allow-Origin","*");res.setHeader("Cache-Control","no-store");
  if(req.method==="OPTIONS")return res.status(200).end();
  const from=req.query.from||"20260102";const to=req.query.to||today();
  let tk=req.query.token||null;
  if(!tk){
    try{const td=await post("/oauth2/tokenP",{grant_type:"client_credentials",appkey:process.env.KIS_APP_KEY,appsecret:process.env.KIS_APP_SECRET});if(!td.access_token)return res.status(500).json({ok:false,error:"token_fail",d:JSON.stringify(td).slice(0,300)});tk=td.access_token;}
    catch(e){return res.status(500).json({ok:false,error:"token_err:"+e.message});}
  }

  // TR_ID / path 조합 찾기 (삼성전자 한 종목으로 테스트)
  const combos=[
    {path:"/uapi/domestic-stock/v1/quotations/inquire-daily-chartprice",trid:"FHKST03010100"},
    {path:"/uapi/domestic-stock/v1/quotations/inquire-daily-price",trid:"FHKST03010100"},
    {path:"/uapi/domestic-stock/v1/quotations/inquire-daily-chartprice",trid:"FHKST01010400"},
    {path:"/uapi/domestic-stock/v1/quotations/inquire-daily-price",trid:"FHKST01010400"},
  ];
  const params={FID_COND_MRKT_DIV_CODE:"J",FID_INPUT_ISCD:"005930",FID_INPUT_DATE_1:from,FID_INPUT_DATE_2:to,FID_PERIOD_DIV_CODE:"D",FID_ORG_ADJ_PRC:"0"};
  const debug={};
  for(const c of combos){
    try{
      await w(400);
      const r=await get(c.path,c.trid,params,tk);
      const rows=r.output2||r.output||[];
      debug[c.trid+"_"+c.path.split("/").pop()]={rt_cd:r.rt_cd,msg1:r.msg1,rows:rows.length,sample:rows[0]||null};
    }catch(e){debug[c.trid+"_"+c.path.split("/").pop()]={error:e.message};}
  }
  res.status(200).json({ok:true,from,to,debug});
};
