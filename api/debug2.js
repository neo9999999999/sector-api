const https=require("https");
function post(p,b){return new Promise((y,n)=>{const d=JSON.stringify(b);const r=https.request({hostname:"openapi.koreainvestment.com",port:9443,path:p,method:"POST",headers:{"Content-Type":"application/json","Content-Length":Buffer.byteLength(d)}},s=>{let t="";s.on("data",c=>t+=c);s.on("end",()=>{try{y(JSON.parse(t))}catch{n(new Error(t.slice(0,200)))}})});r.on("error",n);r.write(d);r.end()})}
function get(p,id,q,tk,trCont=""){return new Promise((y,n)=>{const qs=new URLSearchParams(q).toString();const r=https.request({hostname:"openapi.koreainvestment.com",port:9443,path:p+"?"+qs,method:"GET",headers:{"Content-Type":"application/json; charset=utf-8",authorization:"Bearer "+tk,appkey:process.env.KIS_APP_KEY,appsecret:process.env.KIS_APP_SECRET,tr_id:id,tr_cont:trCont,custtype:"P"}},s=>{let t="";s.on("data",c=>t+=c);s.on("end",()=>{try{const parsed=JSON.parse(t);parsed._trCont=s.headers['tr_cont']||'';y(parsed);}catch{n(new Error(t.slice(0,200)))}})});r.on("error",e=>n(new Error(e.message)));r.end()})}
function w(ms){return new Promise(r=>setTimeout(r,ms))}

module.exports=async(req,res)=>{
  res.setHeader("Access-Control-Allow-Origin","*");
  res.setHeader("Cache-Control","no-store");
  try{
    const td=await post("/oauth2/tokenP",{grant_type:"client_credentials",appkey:process.env.KIS_APP_KEY,appsecret:process.env.KIS_APP_SECRET});
    if(!td.access_token)return res.json({ok:false,error:"token"});
    const tk=td.access_token;

    const gp={FID_COND_SCR_DIV_CODE:"20170",FID_INPUT_ISCD:"0000",FID_COND_MRKT_DIV_CODE:"J",
              FID_RANK_SORT_CLS_CODE:"0",FID_INPUT_CNT_1:"0",FID_PRC_CLS_CODE:"0",
              FID_INPUT_PRICE_1:"0",FID_INPUT_PRICE_2:"1000000",FID_VOL_CNT:"100000",
              FID_TRGT_CLS_CODE:"0",FID_TRGT_EXLS_CLS_CODE:"0",FID_DIV_CLS_CODE:"0",
              FID_RSFL_RATE1:"0",FID_RSFL_RATE2:""};

    // 1차: 최초 조회 (tr_cont="")
    const r1=await get("/uapi/domestic-stock/v1/ranking/fluctuation","FHPST01700000",gp,tk,"");
    const page1=r1.output||[];
    const cont1=r1._trCont;

    await w(500);

    // 2차: 연속 조회 (tr_cont="N")
    let page2=[], cont2="";
    try{
      const r2=await get("/uapi/domestic-stock/v1/ranking/fluctuation","FHPST01700000",gp,tk,"N");
      page2=r2.output||[];
      cont2=r2._trCont;
    }catch(e){page2=[];cont2="err:"+e.message;}

    await w(500);

    // 3차
    let page3=[];
    try{
      if(cont2==="N"||cont2==="n"){
        const r3=await get("/uapi/domestic-stock/v1/ranking/fluctuation","FHPST01700000",gp,tk,"N");
        page3=r3.output||[];
      }
    }catch(e){}

    const all=[...page1,...page2,...page3];
    const unique=[...new Map(all.map(s=>[s.mksc_shrn_iscd||s.stck_shrn_iscd,s])).values()];

    res.json({
      ok:true,
      page1:{len:page1.length,cont:cont1,first:page1[0]?.hts_kor_isnm,last:page1[page1.length-1]?.hts_kor_isnm},
      page2:{len:page2.length,cont:cont2,first:page2[0]?.hts_kor_isnm},
      page3:{len:page3.length,first:page3[0]?.hts_kor_isnm},
      total:unique.length
    });
  }catch(e){res.json({ok:false,error:e.message})}
};
