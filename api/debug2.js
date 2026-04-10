const https=require("https");
function post(p,b){return new Promise((y,n)=>{const d=JSON.stringify(b);const r=https.request({hostname:"openapi.koreainvestment.com",port:9443,path:p,method:"POST",headers:{"Content-Type":"application/json","Content-Length":Buffer.byteLength(d)}},s=>{let t="";s.on("data",c=>t+=c);s.on("end",()=>{try{y(JSON.parse(t))}catch{n(new Error(t.slice(0,200)))}})});r.on("error",n);r.write(d);r.end()})}
function get(p,id,q,tk){return new Promise((y,n)=>{const qs=new URLSearchParams(q).toString();const r=https.request({hostname:"openapi.koreainvestment.com",port:9443,path:p+"?"+qs,method:"GET",headers:{"Content-Type":"application/json; charset=utf-8",authorization:"Bearer "+tk,appkey:process.env.KIS_APP_KEY,appsecret:process.env.KIS_APP_SECRET,tr_id:id,custtype:"P"}},s=>{let t="";s.on("data",c=>t+=c);s.on("end",()=>{const sc=s.statusCode;if(!t)return n(new Error("H"+sc+":empty"));try{y({_sc:sc,...JSON.parse(t)})}catch{n(new Error("H"+sc+":"+t.slice(0,200)))}})});r.on("error",e=>n(new Error(e.message)));r.end()})}
function w(ms){return new Promise(r=>setTimeout(r,ms))}

module.exports=async(req,res)=>{
  res.setHeader("Access-Control-Allow-Origin","*");
  res.setHeader("Cache-Control","no-store");
  try{
    const td=await post("/oauth2/tokenP",{grant_type:"client_credentials",appkey:process.env.KIS_APP_KEY,appsecret:process.env.KIS_APP_SECRET});
    if(!td.access_token)return res.json({ok:false,error:"token"});
    const tk=td.access_token;
    const results=[];

    // ranking/fluctuation의 실제 raw top5
    try{
      const p={FID_COND_SCR_DIV_CODE:"20171",FID_INPUT_ISCD:"0000",FID_COND_MRKT_DIV_CODE:"J",
               FID_RANK_SORT_CLS_CODE:"0",FID_INPUT_CNT_1:"0",FID_PRC_CLS_CODE:"0",
               FID_INPUT_PRICE_1:"",FID_INPUT_PRICE_2:"",FID_VOL_CNT:"",
               FID_TRGT_CLS_CODE:"0",FID_TRGT_EXLS_CLS_CODE:"0",FID_DIV_CLS_CODE:"0",
               FID_RSFL_RATE1:"",FID_RSFL_RATE2:""};
      const r=await get("/uapi/domestic-stock/v1/ranking/fluctuation","FHPST01700000",p,tk);
      // top5 raw 필드 전체
      const top5=(r.output||[]).slice(0,5).map(i=>({
        name:i.hts_kor_isnm, rate:i.prdy_ctrt, price:i.stck_prpr,
        // 어떤 필드들이 있는지 전체 키 확인
        keys:Object.keys(i).join(',')
      }));
      results.push({api:"fluctuation",rt_cd:r.rt_cd,msg:r.msg1,top5});
    }catch(e){results.push({api:"fluctuation",err:e.message});}
    await w(500);

    // 다른 TR_ID 시도들
    const trIds=["FHKST03030100","FHKST01010400","FHPST01710000"];
    for(const tid of trIds){
      try{
        const p={FID_COND_SCR_DIV_CODE:"20171",FID_INPUT_ISCD:"0000",FID_COND_MRKT_DIV_CODE:"J",
                 FID_RANK_SORT_CLS_CODE:"0",FID_INPUT_CNT_1:"0",FID_PRC_CLS_CODE:"0",
                 FID_INPUT_PRICE_1:"",FID_INPUT_PRICE_2:"",FID_VOL_CNT:"",
                 FID_TRGT_CLS_CODE:"0",FID_TRGT_EXLS_CLS_CODE:"0",FID_DIV_CLS_CODE:"0",
                 FID_RSFL_RATE1:"",FID_RSFL_RATE2:""};
        const r=await get("/uapi/domestic-stock/v1/ranking/fluctuation",tid,p,tk);
        results.push({api:"fluctuation+"+tid,rt_cd:r.rt_cd,msg:r.msg1,outLen:(r.output||[]).length,first:r.output?.[0]?.hts_kor_isnm,firstRate:r.output?.[0]?.prdy_ctrt});
      }catch(e){results.push({api:"fluctuation+"+tid,err:e.message.slice(0,50)});}
      await w(300);
    }

    res.json({ok:true,results});
  }catch(e){res.json({ok:false,error:e.message})}
};
