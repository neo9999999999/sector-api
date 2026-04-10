const https=require("https");
function post(p,b){return new Promise((y,n)=>{const d=JSON.stringify(b);const r=https.request({hostname:"openapi.koreainvestment.com",port:9443,path:p,method:"POST",headers:{"Content-Type":"application/json","Content-Length":Buffer.byteLength(d)}},s=>{let t="";s.on("data",c=>t+=c);s.on("end",()=>{try{y(JSON.parse(t))}catch{n(new Error(t.slice(0,200)))}})});r.on("error",n);r.write(d);r.end()})}
function get(p,id,q,tk){return new Promise((y,n)=>{const qs=new URLSearchParams(q).toString();const r=https.request({hostname:"openapi.koreainvestment.com",port:9443,path:p+"?"+qs,method:"GET",headers:{"Content-Type":"application/json; charset=utf-8",authorization:"Bearer "+tk,appkey:process.env.KIS_APP_KEY,appsecret:process.env.KIS_APP_SECRET,tr_id:id,custtype:"P"}},s=>{let t="";s.on("data",c=>t+=c);s.on("end",()=>{const sc=s.statusCode;try{y(JSON.parse(t))}catch{n(new Error(t.slice(0,200)))}})});r.on("error",e=>n(new Error(e.message)));r.end()})}

module.exports=async(req,res)=>{
  res.setHeader("Access-Control-Allow-Origin","*");
  res.setHeader("Cache-Control","no-store");
  try{
    const td=await post("/oauth2/tokenP",{grant_type:"client_credentials",appkey:process.env.KIS_APP_KEY,appsecret:process.env.KIS_APP_SECRET});
    if(!td.access_token)return res.json({ok:false,error:"token"});
    const tk=td.access_token;
    // 삼성전자(코스피)와 에코프로비엠(코스닥) output 전체 필드 확인
    const r1=await get("/uapi/domestic-stock/v1/quotations/search-stock-info","CTPF1002R",{PRDT_TYPE_CD:"300",PDNO:"005930"},tk);
    const r2=await get("/uapi/domestic-stock/v1/quotations/search-stock-info","CTPF1002R",{PRDT_TYPE_CD:"300",PDNO:"247540"},tk);
    res.json({ok:true,samsung_output:r1.output,ecoprobiom_output:r2.output});
  }catch(e){res.json({ok:false,error:e.message})}
};
