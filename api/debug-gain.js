const https=require("https");
function post(p,b){return new Promise((y,n)=>{const d=JSON.stringify(b);const r=https.request({hostname:"openapi.koreainvestment.com",port:9443,path:p,method:"POST",headers:{"Content-Type":"application/json","Content-Length":Buffer.byteLength(d)}},s=>{let t="";s.on("data",c=>t+=c);s.on("end",()=>{try{y(JSON.parse(t))}catch{n(new Error(t.slice(0,200)))}})});r.on("error",n);r.write(d);r.end()})}
function get(p,id,q,tk){return new Promise((y,n)=>{const qs=new URLSearchParams(q).toString();const r=https.request({hostname:"openapi.koreainvestment.com",port:9443,path:p+"?"+qs,method:"GET",headers:{"Content-Type":"application/json; charset=utf-8",authorization:"Bearer "+tk,appkey:process.env.KIS_APP_KEY,appsecret:process.env.KIS_APP_SECRET,tr_id:id,custtype:"P"}},s=>{let t="";s.on("data",c=>t+=c);s.on("end",()=>{const sc=s.statusCode;if(!t)return n(new Error("H"+sc+":empty"));try{y({__status:sc,...JSON.parse(t)})}catch{n(new Error("H"+sc+":"+t.slice(0,200)))}})});r.on("error",e=>n(new Error(e.message)));r.end()})}
function w(ms){return new Promise(r=>setTimeout(r,ms))}

module.exports=async(req,res)=>{
  res.setHeader("Access-Control-Allow-Origin","*");
  res.setHeader("Cache-Control","no-store");
  try{
    const td=await post("/oauth2/tokenP",{grant_type:"client_credentials",appkey:process.env.KIS_APP_KEY,appsecret:process.env.KIS_APP_SECRET});
    if(!td.access_token)return res.json({ok:false,error:"token"});
    const tk=td.access_token;
    
    const results=[];
    const tests=[
      // 다양한 스크린 코드 & 경로 시도
      {path:"/uapi/domestic-stock/v1/quotations/chgrate-rank",id:"FHPST01700000",scr:"20171"},
      {path:"/uapi/domestic-stock/v1/quotations/chgrate-rank",id:"FHPST01700000",scr:"20170"},
      {path:"/uapi/domestic-stock/v1/quotations/chgrate-rank",id:"FHPST01700000",scr:"0171"},
      {path:"/uapi/domestic-stock/v1/quotations/chgrate-rank",id:"FHPST01700000",scr:"0170"},
      {path:"/uapi/domestic-stock/v1/ranking/fluctuation",id:"FHPST01700000",scr:"20171"},
    ];
    
    for(const t of tests){
      try{
        const p={FID_COND_SCR_DIV_CODE:t.scr,FID_INPUT_ISCD:"0000",FID_COND_MRKT_DIV_CODE:"J",
                 FID_RANK_SORT_CLS_CODE:"0",FID_INPUT_CNT_1:"0",FID_PRC_CLS_CODE:"0",
                 FID_INPUT_PRICE_1:"",FID_INPUT_PRICE_2:"",FID_VOL_CNT:"",
                 FID_TRGT_CLS_CODE:"0",FID_TRGT_EXLS_CLS_CODE:"0",FID_DIV_CLS_CODE:"0",
                 FID_RSFL_RATE1:"",FID_RSFL_RATE2:""};
        const r=await get(t.path,t.id,p,tk);
        results.push({path:t.path,scr:t.scr,status:r.__status,rt_cd:r.rt_cd,msg:r.msg1,outLen:(r.output||[]).length,first:r.output?.[0]?.hts_kor_isnm});
      }catch(e){results.push({path:t.path,scr:t.scr,err:e.message});}
      await w(300);
    }
    
    res.json({ok:true,results});
  }catch(e){res.json({ok:false,error:e.message})}
};
