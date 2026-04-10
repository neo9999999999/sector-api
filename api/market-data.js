const https=require("https");
function post(p,b){return new Promise((y,n)=>{const d=JSON.stringify(b);const r=https.request({hostname:"openapi.koreainvestment.com",port:9443,path:p,method:"POST",headers:{"Content-Type":"application/json","Content-Length":Buffer.byteLength(d)}},s=>{let t="";s.on("data",c=>t+=c);s.on("end",()=>{try{y(JSON.parse(t))}catch{n(new Error(t.slice(0,200)))}})});r.on("error",n);r.write(d);r.end()})}
function get(p,id,q,tk){return new Promise((y,n)=>{const qs=new URLSearchParams(q).toString();const r=https.request({hostname:"openapi.koreainvestment.com",port:9443,path:p+"?"+qs,method:"GET",headers:{"Content-Type":"application/json; charset=utf-8",authorization:"Bearer "+tk,appkey:process.env.KIS_APP_KEY,appsecret:process.env.KIS_APP_SECRET,tr_id:id,custtype:"P"}},s=>{let t="";s.on("data",c=>t+=c);s.on("end",()=>{const sc=s.statusCode;if(!t)return n(new Error(id+":H"+sc+":empty"));try{y(JSON.parse(t))}catch{n(new Error(id+":H"+sc+":"+t.slice(0,200)))}})});r.on("error",e=>n(new Error(id+":"+e.message)));r.end()})}
function w(ms){return new Promise(r=>setTimeout(r,ms))}
function fmt(n){if(!n)return"0";if(n>=1e12)return(n/1e12).toFixed(1)+"조";if(n>=1e8)return Math.round(n/1e8)+"억";return n.toLocaleString()}
let _tokenCache={token:'',exp:0};
async function getToken(){
  const now=Date.now();
  if(_tokenCache.token&&_tokenCache.exp>now+60000)return _tokenCache.token;
  const td=await post("/oauth2/tokenP",{grant_type:"client_credentials",appkey:process.env.KIS_APP_KEY,appsecret:process.env.KIS_APP_SECRET});
  if(!td.access_token)throw new Error("token:"+JSON.stringify(td).slice(0,100));
  _tokenCache={token:td.access_token,exp:now+(td.expires_in||86400)*1000};
  return td.access_token;
}
function parseS(arr,mkt=""){return(arr||[]).filter(i=>i&&i.hts_kor_isnm).map(i=>({name:i.hts_kor_isnm,code:i.mksc_shrn_iscd||i.stck_shrn_iscd,price:+i.stck_prpr,change:+i.prdy_ctrt,amt:+(i.acml_tr_pbmn||0),amtFmt:fmt(+(i.acml_tr_pbmn||0)),vol:+(i.acml_vol||0),isLimit:+i.prdy_ctrt>=29,market:mkt}))}

module.exports=async(req,res)=>{
  res.setHeader("Access-Control-Allow-Origin","*");
  res.setHeader("Cache-Control","no-store");
  if(req.method==="OPTIONS")return res.status(200).end();
  try{
    let tk;
    try{tk=await getToken();}catch(e){return res.status(500).json({ok:false,error:"token",d:e.message});}

    // 거래대금 순위 (코스피 J + 코스닥 Q)
    const vp={FID_COND_SCR_DIV_CODE:"20174",FID_INPUT_ISCD:"0000",FID_DIV_CLS_CODE:"0",FID_BLNG_CLS_CODE:"0",FID_TRGT_CLS_CODE:"111111111",FID_TRGT_EXLS_CLS_CODE:"000000",FID_INPUT_PRICE_1:"",FID_INPUT_PRICE_2:"",FID_VOL_CNT:"",FID_INPUT_DATE_1:""};
    const volJ=await get("/uapi/domestic-stock/v1/quotations/volume-rank","FHPST01710000",{...vp,FID_COND_MRKT_DIV_CODE:"J",FID_INPUT_ISCD:"0000"},tk);
    await w(600);
    let volKQarr=[],volKQErr="",volKQMeta="";
    try{
      // 코스닥: 마켓코드 "Q", ISCD "1000"
      const r=await get("/uapi/domestic-stock/v1/quotations/volume-rank","FHPST01710000",{...vp,FID_COND_MRKT_DIV_CODE:"J",FID_INPUT_ISCD:"0000",FID_BLNG_CLS_CODE:"1"},tk);
      volKQarr=r.output||[];volKQMeta=JSON.stringify({rt_cd:r.rt_cd,msg1:r.msg1,len:(r.output||[]).length});
    }catch(e){volKQErr=e.message.slice(0,80);}
    await w(300);

    const volAll=parseS(volJ.output,"J");
    const seenVol=new Set(volAll.map(s=>s.code));
    parseS(volKQarr,"Q").forEach(s=>{if(!seenVol.has(s.code)){volAll.push(s);seenVol.add(s.code);}});

    // 등락률 순위 (chgrate-rank, 거래대금 무관)
    const gp={FID_COND_SCR_DIV_CODE:"20170",FID_INPUT_ISCD:"0000",FID_RANK_SORT_CLS_CODE:"0",FID_INPUT_CNT_1:"0",FID_PRC_CLS_CODE:"0",FID_INPUT_PRICE_1:"",FID_INPUT_PRICE_2:"",FID_VOL_CNT:"",FID_TRGT_CLS_CODE:"0",FID_TRGT_EXLS_CLS_CODE:"0",FID_DIV_CLS_CODE:"0",FID_RSFL_RATE1:"",FID_RSFL_RATE2:""};
    let gainJ=[],gainQ=[],gainErr="";
    try{
      const r=await get("/uapi/domestic-stock/v1/quotations/chgrate-rank","FHPST01700000",{...gp,FID_COND_MRKT_DIV_CODE:"J",FID_INPUT_ISCD:"0000"},tk);
      gainJ=parseS(r.output,"J");
    }catch(e){gainErr+="J:"+e.message.slice(0,60)+" ";}
    await w(600);
    try{
      const r=await get("/uapi/domestic-stock/v1/quotations/chgrate-rank","FHPST01700000",{...gp,FID_COND_MRKT_DIV_CODE:"J",FID_INPUT_ISCD:"0000",FID_BLNG_CLS_CODE:"1"},tk);
      gainQ=parseS(r.output,"Q");
    }catch(e){gainErr+="Q:"+e.message.slice(0,60);}

    // gainRanking: chgrate API 성공시 사용, 실패시 volAll 기반 fallback
    let gainRanking=[];
    if(gainJ.length||gainQ.length){  // API 성공
      const gainAll=[...gainJ];
      const seenG=new Set(gainJ.map(s=>s.code));
      gainQ.forEach(s=>{if(!seenG.has(s.code)){gainAll.push(s);seenG.add(s.code);}});
      gainRanking=gainAll.filter(s=>s.change>0).sort((a,b)=>b.isLimit-a.isLimit||b.change-a.change);
    } else {
      // fallback: volAll 기반 등락률 정렬
      gainRanking=[...volAll].filter(s=>s.change>0).sort((a,b)=>b.isLimit-a.isLimit||b.change-a.change);
    }

    const rising=[...volAll].filter(s=>s.change>0).sort((a,b)=>b.isLimit-a.isLimit||b.change-a.change);

    res.status(200).json({
      ok:true,_token:tk,
      date:new Date().toLocaleDateString("ko-KR",{timeZone:"Asia/Seoul"}),
      topVolume:[...volAll].sort((a,b)=>b.amt-a.amt),
      topRising:rising,
      gainRanking,
      limitUp:volAll.filter(s=>s.isLimit),
      total:volAll.length,
      debug:{kospi:(volJ.output||[]).length,kosdaq:volKQarr.length,gainJ:gainJ.length,gainQ:gainQ.length,gainErr:gainErr||null,kqMeta:volKQMeta||null,kqErr:volKQErr||null}
    });
  }catch(e){res.status(500).json({ok:false,error:e.message})}
};
