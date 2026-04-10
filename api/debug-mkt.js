const https=require("https");
function post(p,b){return new Promise((y,n)=>{const d=JSON.stringify(b);const r=https.request({hostname:"openapi.koreainvestment.com",port:9443,path:p,method:"POST",headers:{"Content-Type":"application/json","Content-Length":Buffer.byteLength(d)}},s=>{let t="";s.on("data",c=>t+=c);s.on("end",()=>{try{y(JSON.parse(t))}catch{n(new Error(t.slice(0,200)))}})});r.on("error",n);r.write(d);r.end()})}
function get(p,id,q,tk){return new Promise((y,n)=>{const qs=new URLSearchParams(q).toString();const r=https.request({hostname:"openapi.koreainvestment.com",port:9443,path:p+"?"+qs,method:"GET",headers:{"Content-Type":"application/json; charset=utf-8",authorization:"Bearer "+tk,appkey:process.env.KIS_APP_KEY,appsecret:process.env.KIS_APP_SECRET,tr_id:id,custtype:"P"}},s=>{let t="";s.on("data",c=>t+=c);s.on("end",()=>{const sc=s.statusCode;if(!t)return n(new Error("H"+sc+":empty"));try{y({_status:sc,...JSON.parse(t)})}catch{n(new Error("H"+sc+":"+t.slice(0,200)))}})});r.on("error",e=>n(new Error(e.message)));r.end()})}
function w(ms){return new Promise(r=>setTimeout(r,ms))}

module.exports=async(req,res)=>{
  res.setHeader("Access-Control-Allow-Origin","*");
  res.setHeader("Cache-Control","no-store");
  try{
    const td=await post("/oauth2/tokenP",{grant_type:"client_credentials",appkey:process.env.KIS_APP_KEY,appsecret:process.env.KIS_APP_SECRET});
    if(!td.access_token)return res.json({ok:false,error:"token"});
    const tk=td.access_token;
    
    // 종목 기본정보 조회 — 코스닥(247540 에코프로비엠), 코스피(005930 삼성전자) 비교
    const codes=["005930","247540","086520","035720"];
    const results=[];
    for(const code of codes){
      try{
        // search-stock-info
        const r=await get("/uapi/domestic-stock/v1/quotations/search-stock-info","CTPF1002R",{PRDT_TYPE_CD:"300",PDNO:code},tk);
        results.push({code,method:"search-stock-info",rt_cd:r.rt_cd,msg:r.msg1,
          mktDivCode:r.output?.mkt_id,mktName:r.output?.mket_name,
          stockName:r.output?.prdt_name});
      }catch(e){results.push({code,method:"search-stock-info",err:e.message.slice(0,60)});}
      await w(200);
    }
    res.json({ok:true,results});
  }catch(e){res.json({ok:false,error:e.message})}
};
