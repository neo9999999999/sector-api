const https=require("https");
function post(p,b){return new Promise((y,n)=>{const d=JSON.stringify(b);const r=https.request({hostname:"openapi.koreainvestment.com",port:9443,path:p,method:"POST",headers:{"Content-Type":"application/json","Content-Length":Buffer.byteLength(d)}},s=>{let t="";s.on("data",c=>t+=c);s.on("end",()=>{try{y(JSON.parse(t))}catch{n(new Error(t.slice(0,200)))}})});r.on("error",n);r.write(d);r.end()})}
function get(p,id,q,tk){return new Promise((y,n)=>{const qs=new URLSearchParams(q).toString();const r=https.request({hostname:"openapi.koreainvestment.com",port:9443,path:p+"?"+qs,method:"GET",headers:{"Content-Type":"application/json; charset=utf-8",authorization:"Bearer "+tk,appkey:process.env.KIS_APP_KEY,appsecret:process.env.KIS_APP_SECRET,tr_id:id,custtype:"P"}},s=>{let t="";s.on("data",c=>t+=c);s.on("end",()=>{try{y({st:s.statusCode,d:JSON.parse(t)})}catch{y({st:s.statusCode,raw:t.slice(0,300)})}})});r.on("error",e=>n(new Error(id+":"+e.message)));r.end()})}
function w(ms){return new Promise(r=>setTimeout(r,ms))}
function fmt(n){if(!n)return"0";if(n>=1e12)return(n/1e12).toFixed(1)+"조";if(n>=1e8)return Math.round(n/1e8)+"억";return n.toLocaleString()}
function pv(arr){return(arr||[]).map(i=>({name:i.hts_kor_isnm,code:i.mksc_shrn_iscd,price:+i.stck_prpr,change:+i.prdy_ctrt,amt:+i.acml_tr_pbmn,amtFmt:fmt(+i.acml_tr_pbmn),vol:+i.acml_vol,isLimit:+i.prdy_ctrt>=29}))}
module.exports=async(req,res)=>{
  res.setHeader("Access-Control-Allow-Origin","*");
  if(req.method==="OPTIONS")return res.status(200).end();
  try{
    const td=await post("/oauth2/tokenP",{grant_type:"client_credentials",appkey:process.env.KIS_APP_KEY,appsecret:process.env.KIS_APP_SECRET});
    if(!td.access_token)return res.status(500).json({ok:false,error:"token",d:td});
    const tk=td.access_token;
    const vp={FID_COND_SCR_DIV_CODE:"20174",FID_INPUT_ISCD:"0000",FID_DIV_CLS_CODE:"0",FID_BLNG_CLS_CODE:"0",FID_TRGT_CLS_CODE:"111111111",FID_TRGT_EXLS_CLS_CODE:"000000",FID_INPUT_PRICE_1:"",FID_INPUT_PRICE_2:"",FID_VOL_CNT:"",FID_INPUT_DATE_1:""};
    const vK=await get("/uapi/domestic-stock/v1/quotations/volume-rank","FHPST01710000",{...vp,FID_COND_MRKT_DIV_CODE:"J"},tk);
    await w(400);
    const vQ=await get("/uapi/domestic-stock/v1/quotations/volume-rank","FHPST01710000",{...vp,FID_COND_MRKT_DIV_CODE:"Q"},tk);
    await w(400);
    // 등락률 순위 시도
    const gp={FID_COND_SCR_DIV_CODE:"20170",FID_INPUT_ISCD:"0000",FID_RANK_SORT_CLS_CODE:"0",FID_INPUT_CNT_1:"0",FID_PRC_CLS_CODE:"0",FID_INPUT_PRICE_1:"",FID_INPUT_PRICE_2:"",FID_VOL_CNT:"100000",FID_TRGT_CLS_CODE:"0",FID_TRGT_EXLS_CLS_CODE:"0",FID_DIV_CLS_CODE:"0",FID_RSFL_RATE1:"",FID_RSFL_RATE2:""};
    let gK=null,gQ=null;
    const paths=["/uapi/domestic-stock/v1/quotations/chgrate-rank","/uapi/domestic-stock/v1/ranking/fluctuation"];
    for(const p of paths){
      try{
        const r=await get(p,"FHPST01700000",{...gp,FID_COND_MRKT_DIV_CODE:"J"},tk);
        if(r.st===200&&r.d?.output?.length>0){gK=r;await w(400);gQ=await get(p,"FHPST01700000",{...gp,FID_COND_MRKT_DIV_CODE:"Q"},tk);break;}
      }catch{}
      await w(300);
    }
    const volAll=pv(vK.d?.output).concat(pv(vQ.d?.output)).sort((a,b)=>b.amt-a.amt);
    const gainAll=gK?pv(gK.d?.output).concat(pv(gQ?.d?.output||[])).filter(s=>s.change>5):[];
    const seen=new Set(volAll.map(s=>s.code));
    gainAll.forEach(s=>{if(!seen.has(s.code)){volAll.push(s);seen.add(s.code)}});
    res.status(200).json({ok:true,date:new Date().toLocaleDateString("ko-KR",{timeZone:"Asia/Seoul"}),topVolume:volAll,limitUp:volAll.filter(s=>s.isLimit),topRising:gainAll,total:volAll.length});
  }catch(e){res.status(500).json({ok:false,error:e.message})}
};
