const https=require("https");
function kisPost(p,b){return new Promise((y,n)=>{const d=JSON.stringify(b);const r=https.request({hostname:"openapi.koreainvestment.com",port:9443,path:p,method:"POST",headers:{"Content-Type":"application/json","Content-Length":Buffer.byteLength(d)}},s=>{let b="";s.on("data",c=>b+=c);s.on("end",()=>{try{y(JSON.parse(b))}catch{n(new Error(b.slice(0,200)))}})});r.on("error",n);r.write(d);r.end()})}
function kisGet(p,t,q,tk){return new Promise((y,n)=>{const qs=new URLSearchParams(q).toString();const r=https.request({hostname:"openapi.koreainvestment.com",port:9443,path:p+"?"+qs,method:"GET",headers:{"Content-Type":"application/json; charset=utf-8",authorization:"Bearer "+tk,appkey:process.env.KIS_APP_KEY,appsecret:process.env.KIS_APP_SECRET,tr_id:t,custtype:"P"}},s=>{let b="";s.on("data",c=>b+=c);s.on("end",()=>{try{y(JSON.parse(b))}catch{n(new Error(b.slice(0,200)))}})});r.on("error",n);r.end()})}
function w(ms){return new Promise(r=>setTimeout(r,ms))}
function fmt(n){if(!n)return"0";if(n>=1e12)return(n/1e12).toFixed(1)+"조";if(n>=1e8)return Math.round(n/1e8)+"억";return n.toLocaleString()}

// 상한가 후보 종목코드 (방산/철강/건설/반도체장비/AI 소형주)
const WATCH=["010820","053260","017900","000880","004710","003230","009770","005070","025560","014580","101930","131370","900340","038070","024740","357780","950140","389020","222800","214150","025320","033100","083930","032680","094480"];

module.exports=async function(req,res){
  res.setHeader("Access-Control-Allow-Origin","*");
  if(req.method==="OPTIONS")return res.status(200).end();
  try{
    var td=await kisPost("/oauth2/tokenP",{grant_type:"client_credentials",appkey:process.env.KIS_APP_KEY,appsecret:process.env.KIS_APP_SECRET});
    if(!td.access_token)return res.status(500).json({ok:false,error:"token",detail:td});
    var tk=td.access_token;

    // 1) 거래대금 상위 30 (코스피+코스닥)
    var vp={FID_COND_SCR_DIV_CODE:"20174",FID_INPUT_ISCD:"0000",FID_DIV_CLS_CODE:"0",FID_BLNG_CLS_CODE:"0",FID_TRGT_CLS_CODE:"111111111",FID_TRGT_EXLS_CLS_CODE:"000000",FID_INPUT_PRICE_1:"",FID_INPUT_PRICE_2:"",FID_VOL_CNT:"",FID_INPUT_DATE_1:""};
    var vK=await kisGet("/uapi/domestic-stock/v1/quotations/volume-rank","FHPST01710000",Object.assign({FID_COND_MRKT_DIV_CODE:"J"},vp),tk);
    await w(300);
    var vQ=await kisGet("/uapi/domestic-stock/v1/quotations/volume-rank","FHPST01710000",Object.assign({FID_COND_MRKT_DIV_CODE:"Q"},vp),tk);

    var all=[...(vK.output||[]),...(vQ.output||[])].map(i=>({
      name:i.hts_kor_isnm,code:i.mksc_shrn_iscd,price:+i.stck_prpr,
      change:+i.prdy_ctrt,amt:+i.acml_tr_pbmn,amtFmt:fmt(+i.acml_tr_pbmn),
      vol:+i.acml_vol,isLimit:+i.prdy_ctrt>=29.0,src:"vol"
    }));
    var codes=new Set(all.map(s=>s.code));

    // 2) 개별 종목 시세 조회 (상한가 후보)
    var extras=[];
    for(var i=0;i<WATCH.length;i++){
      if(codes.has(WATCH[i]))continue;
      try{
        await w(200);
        var m=WATCH[i].startsWith("9")||+WATCH[i]>=100000?"Q":"J";
        var d=await kisGet("/uapi/domestic-stock/v1/quotations/inquire-price","FHKST01010100",{FID_COND_MRKT_DIV_CODE:m,FID_INPUT_ISCD:WATCH[i]},tk);
        var o=d.output;
        if(o&&+o.prdy_ctrt>5){
          extras.push({name:o.hts_kor_isnm,code:WATCH[i],price:+o.stck_prpr,
            change:+o.prdy_ctrt,amt:+o.acml_tr_pbmn,amtFmt:fmt(+o.acml_tr_pbmn),
            vol:+o.acml_vol,isLimit:+o.prdy_ctrt>=29.0,src:"watch"});
        }
      }catch(e){}
    }

    var merged=[...all,...extras].sort((a,b)=>b.amt-a.amt);

    res.status(200).json({
      ok:true,
      date:new Date().toLocaleDateString("ko-KR",{timeZone:"Asia/Seoul"}),
      topVolume:merged.filter(s=>s.change>=0).sort((a,b)=>{if(b.isLimit!==a.isLimit)return b.isLimit?1:-1;return b.change-a.change}),
      limitUp:merged.filter(s=>s.isLimit),
      topRising:merged.filter(s=>s.change>5&&!s.isLimit),
      total:merged.length,
      watchHits:extras.length,
    });
  }catch(e){res.status(500).json({ok:false,error:e.message})}
};
