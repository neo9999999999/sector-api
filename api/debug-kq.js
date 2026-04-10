const https=require("https");
function post(p,b){return new Promise((y,n)=>{const d=JSON.stringify(b);const r=https.request({hostname:"openapi.koreainvestment.com",port:9443,path:p,method:"POST",headers:{"Content-Type":"application/json","Content-Length":Buffer.byteLength(d)}},s=>{let t="";s.on("data",c=>t+=c);s.on("end",()=>{try{y(JSON.parse(t))}catch{n(new Error(t.slice(0,200)))}})});r.on("error",n);r.write(d);r.end()})}
function get(p,id,q,tk){return new Promise((y,n)=>{const qs=new URLSearchParams(q).toString();const r=https.request({hostname:"openapi.koreainvestment.com",port:9443,path:p+"?"+qs,method:"GET",headers:{"Content-Type":"application/json; charset=utf-8",authorization:"Bearer "+tk,appkey:process.env.KIS_APP_KEY,appsecret:process.env.KIS_APP_SECRET,tr_id:id,custtype:"P"}},s=>{let t="";s.on("data",c=>t+=c);s.on("end",()=>{const sc=s.statusCode;if(!t)return n(new Error("H"+sc+":empty"));try{y(JSON.parse(t))}catch{n(new Error("H"+sc+":"+t.slice(0,200)))}})});r.on("error",e=>n(new Error(e.message)));r.end()})}

module.exports=async(req,res)=>{
  res.setHeader("Access-Control-Allow-Origin","*");
  try{
    const td=await post("/oauth2/tokenP",{grant_type:"client_credentials",appkey:process.env.KIS_APP_KEY,appsecret:process.env.KIS_APP_SECRET});
    const tk=td.access_token;
    const vBase={FID_COND_SCR_DIV_CODE:"20174",FID_INPUT_ISCD:"0000",FID_DIV_CLS_CODE:"0",
                 FID_TRGT_CLS_CODE:"111111111",FID_TRGT_EXLS_CLS_CODE:"000000",
                 FID_INPUT_PRICE_1:"",FID_INPUT_PRICE_2:"",FID_VOL_CNT:"",FID_INPUT_DATE_1:""};
    const kq=await get("/uapi/domestic-stock/v1/quotations/volume-rank","FHPST01710000",
      {...vBase,FID_COND_MRKT_DIV_CODE:"J",FID_BLNG_CLS_CODE:"1"},tk);
    // raw 첫 5개 그대로 반환
    const raw=(kq.output||[]).slice(0,5).map(i=>({
      name:i.hts_kor_isnm,
      mksc:i.mksc_shrn_iscd,
      stck:i.stck_shrn_iscd,
      all_keys:Object.keys(i)
    }));
    res.json({rt_cd:kq.rt_cd,msg:kq.msg1,len:(kq.output||[]).length,raw});
  }catch(e){res.json({error:e.message})}
};
