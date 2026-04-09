const https=require("https");
function post(p,b){return new Promise((y,n)=>{const d=JSON.stringify(b);const r=https.request({hostname:"openapi.koreainvestment.com",port:9443,path:p,method:"POST",headers:{"Content-Type":"application/json","Content-Length":Buffer.byteLength(d)}},s=>{let t="";s.on("data",c=>t+=c);s.on("end",()=>{try{y(JSON.parse(t))}catch{n(new Error(t.slice(0,200)))}})});r.on("error",n);r.write(d);r.end()})}
function get(p,id,q,tk){return new Promise((y,n)=>{const qs=new URLSearchParams(q).toString();const r=https.request({hostname:"openapi.koreainvestment.com",port:9443,path:p+"?"+qs,method:"GET",headers:{"Content-Type":"application/json; charset=utf-8",authorization:"Bearer "+tk,appkey:process.env.KIS_APP_KEY,appsecret:process.env.KIS_APP_SECRET,tr_id:id,custtype:"P"}},s=>{let t="";s.on("data",c=>t+=c);s.on("end",()=>{try{y(JSON.parse(t))}catch{n(new Error(id+":"+t.slice(0,200)))}})});r.on("error",e=>n(new Error(id+":"+e.message)));r.end()})}
function w(ms){return new Promise(r=>setTimeout(r,ms))}
function fmt(n){if(!n)return"0";if(n>=1e12)return(n/1e12).toFixed(1)+"조";if(n>=1e8)return Math.round(n/1e8)+"억";return n.toLocaleString()}
function parse(arr){return(arr||[]).map(i=>({name:i.hts_kor_isnm,code:i.mksc_shrn_iscd||i.stck_shrn_iscd,price:+i.stck_prpr,change:+i.prdy_ctrt,amt:+(i.acml_tr_pbmn||0),amtFmt:fmt(+(i.acml_tr_pbmn||0)),vol:+(i.acml_vol||0),isLimit:+i.prdy_ctrt>=29}))}
module.exports=async(req,res)=>{
      res.setHeader("Access-Control-Allow-Origin","*");
      res.setHeader("Cache-Control","no-store");
      if(req.method==="OPTIONS")return res.status(200).end();
      try{
              const td=await post("/oauth2/tokenP",{grant_type:"client_credentials",appkey:process.env.KIS_APP_KEY,appsecret:process.env.KIS_APP_SECRET});
              if(!td.access_token)return res.status(500).json({ok:false,error:"token",d:td});
              const tk=td.access_token;
              const base={FID_COND_SCR_DIV_CODE:"20174",FID_INPUT_ISCD:"0000",FID_DIV_CLS_CODE:"0",FID_BLNG_CLS_CODE:"0",FID_TRGT_CLS_CODE:"111111111",FID_TRGT_EXLS_CLS_CODE:"000000",FID_INPUT_PRICE_1:"",FID_INPUT_PRICE_2:"",FID_VOL_CNT:"",FID_INPUT_DATE_1:""};
              let kospiStocks=[],kosdaqStocks=[],kosdaqErr="",kosdaqCode="";
              try{const r=await get("/uapi/domestic-stock/v1/quotations/volume-rank","FHPST01710000",{...base,FID_COND_MRKT_DIV_CODE:"J"},tk);kospiStocks=parse(r.output);}catch(e){}
              await w(800);
              // 코스닥 여러 코드 시도
        for(const code of["Q","K","NQ","KQ","2"]){
                  try{
                              await w(400);
                              const r=await get("/uapi/domestic-stock/v1/quotations/volume-rank","FHPST01710000",{...base,FID_COND_MRKT_DIV_CODE:code},tk);
                              if(r.output&&r.output.length>0){kosdaqStocks=parse(r.output);kosdaqCode=code;break;}
                              if(r.rt_cd&&r.rt_cd!=="0"){kosdaqErr+=code+":"+r.msg1+"|";}
                  }catch(e){kosdaqErr+=code+":"+e.message+"|";}
        }
              const codes=new Set(kospiStocks.map(s=>s.code));
              const all=[...kospiStocks,...kosdaqStocks.filter(s=>!codes.has(s.code))];
              res.status(200).json({ok:true,date:new Date().toLocaleDateString("ko-KR",{timeZone:"Asia/Seoul"}),topVolume:[...all].sort((a,b)=>b.amt-a.amt),topRising:[...all].filter(s=>s.change>0).sort((a,b)=>{if(b.isLimit!==a.isLimit)return b.isLimit?1:-1;return b.change-a.change}),limitUp:all.filter(s=>s.isLimit),total:all.length,debug:{kospi:kospiStocks.length,kosdaq:kosdaqStocks.length,kosdaqCode,kosdaqErr}});
      }catch(e){res.status(500).json({ok:false,error:e.message})}
};
