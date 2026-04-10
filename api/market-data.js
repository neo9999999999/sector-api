const https=require("https");
function post(p,b){return new Promise((y,n)=>{const d=JSON.stringify(b);const r=https.request({hostname:"openapi.koreainvestment.com",port:9443,path:p,method:"POST",headers:{"Content-Type":"application/json","Content-Length":Buffer.byteLength(d)}},s=>{let t="";s.on("data",c=>t+=c);s.on("end",()=>{try{y(JSON.parse(t))}catch{n(new Error(t.slice(0,200)))}})});r.on("error",n);r.write(d);r.end()})}
function get(p,id,q,tk,cont=""){return new Promise((y,n)=>{const qs=new URLSearchParams(q).toString();const r=https.request({hostname:"openapi.koreainvestment.com",port:9443,path:p+"?"+qs,method:"GET",headers:{"Content-Type":"application/json; charset=utf-8",authorization:"Bearer "+tk,appkey:process.env.KIS_APP_KEY,appsecret:process.env.KIS_APP_SECRET,tr_id:id,tr_cont:cont,custtype:"P"}},s=>{let t="";s.on("data",c=>t+=c);s.on("end",()=>{const sc=s.statusCode;if(!t)return n(new Error(id+":H"+sc+":empty"));try{const parsed=JSON.parse(t);parsed._cont=s.headers['tr_cont']||'';y(parsed);}catch{n(new Error(id+":H"+sc+":"+t.slice(0,200)))}})});r.on("error",e=>n(new Error(id+":"+e.message)));r.end()})}
function w(ms){return new Promise(r=>setTimeout(r,ms))}
function fmt(n){if(!n)return"";if(n>=1e12)return(n/1e12).toFixed(1)+"조";if(n>=1e8)return Math.round(n/1e8)+"억";if(n>=1e4)return Math.round(n/1e4)+"만";return n.toLocaleString()}

let _cache={token:"",exp:0};
async function getToken(){
  const now=Date.now();
  if(_cache.token&&_cache.exp>now+60000)return _cache.token;
  const td=await post("/oauth2/tokenP",{grant_type:"client_credentials",appkey:process.env.KIS_APP_KEY,appsecret:process.env.KIS_APP_SECRET});
  if(!td.access_token)throw new Error(JSON.stringify(td).slice(0,120));
  _cache={token:td.access_token,exp:now+(td.expires_in||86400)*1000};
  return td.access_token;
}

const ETF=/^(KODEX|TIGER|KBSTAR|ARIRANG|KOSEF|HANARO|PLUS|RISE|ACE|SOL|WON|TIMEFOLIO|SMART)/;

function parseItems(arr,mkt){
  return(arr||[]).filter(i=>i&&i.hts_kor_isnm&&!ETF.test(i.hts_kor_isnm)).map(i=>({
    name:i.hts_kor_isnm,
    code:i.mksc_shrn_iscd||i.stck_shrn_iscd,
    price:+i.stck_prpr,
    change:+i.prdy_ctrt,
    amt:+(i.acml_tr_pbmn)||((+(i.acml_vol||0))*(+(i.stck_prpr||0))),
    amtFmt:fmt(+(i.acml_tr_pbmn)||((+(i.acml_vol||0))*(+(i.stck_prpr||0)))),
    vol:+(i.acml_vol||0),
    isLimit:+i.prdy_ctrt>=29,
    limitHour:i.hgpr_hour||"",
    market:mkt
  }))
}

// tr_cont 연속 조회로 최대 maxPage*30개 가져오기
async function getAll(path, trId, params, tk, maxPage=3){
  const all=[];
  const seen=new Set();
  let cont="";
  for(let i=0;i<maxPage;i++){
    try{
      const r=await get(path,trId,params,tk,cont);
      const items=r.output||[];
      items.forEach(s=>{
        const code=s.mksc_shrn_iscd||s.stck_shrn_iscd;
        if(!seen.has(code)){seen.add(code);all.push(s);}
      });
      cont=r._cont;
      if(cont!=="N"&&cont!=="n")break; // 더 이상 데이터 없음
      if(i<maxPage-1)await w(400);
    }catch(e){break;}
  }
  return all;
}

module.exports=async(req,res)=>{
  res.setHeader("Access-Control-Allow-Origin","*");
  res.setHeader("Cache-Control","no-store");
  if(req.method==="OPTIONS")return res.status(200).end();
  try{
    let tk;
    try{tk=await getToken();}catch(e){return res.status(500).json({ok:false,error:"token",d:e.message});}

    // ① 거래대금 순위 — 연속조회 최대 60개
    const vp={FID_COND_SCR_DIV_CODE:"20171",FID_INPUT_ISCD:"0000",FID_COND_MRKT_DIV_CODE:"J",
              FID_DIV_CLS_CODE:"0",FID_BLNG_CLS_CODE:"0",FID_TRGT_CLS_CODE:"111111111",
              FID_TRGT_EXLS_CLS_CODE:"0000000000",FID_INPUT_PRICE_1:"0",
              FID_INPUT_PRICE_2:"1000000",FID_VOL_CNT:"100000",FID_INPUT_DATE_1:""};
    const volRaw=await getAll("/uapi/domestic-stock/v1/quotations/volume-rank","FHPST01710000",vp,tk,2);
    const volAll=parseItems(volRaw,"J");
    await w(600);

    // ② 등락률 순위 — 연속조회 최대 90개
    const gp={FID_COND_SCR_DIV_CODE:"20170",FID_INPUT_ISCD:"0000",FID_COND_MRKT_DIV_CODE:"J",
              FID_RANK_SORT_CLS_CODE:"0",FID_INPUT_CNT_1:"0",FID_PRC_CLS_CODE:"0",
              FID_INPUT_PRICE_1:"0",FID_INPUT_PRICE_2:"1000000",FID_VOL_CNT:"100000",
              FID_TRGT_CLS_CODE:"0",FID_TRGT_EXLS_CLS_CODE:"0",FID_DIV_CLS_CODE:"0",
              FID_RSFL_RATE1:"0",FID_RSFL_RATE2:""};
    let gainRaw=[],gainApiOk=false,gainErr="";
    try{
      gainRaw=await getAll("/uapi/domestic-stock/v1/ranking/fluctuation","FHPST01700000",gp,tk,3);
      gainApiOk=gainRaw.length>0;
    }catch(e){gainErr=e.message.slice(0,80);}

    // 거래대금 맵 (등락률 종목에 거래대금 보완)
    const volMap=new Map(volAll.map(s=>[s.code,{amt:s.amt,amtFmt:s.amtFmt}]));

    let gainRanking=gainRaw.length>0
      ? parseItems(gainRaw,"J").filter(s=>s.change>0).sort((a,b)=>b.isLimit-a.isLimit||b.change-a.change)
      : [...volAll].filter(s=>s.change>0).sort((a,b)=>b.isLimit-a.isLimit||b.change-a.change);

    // 거래대금 보완 (volMap에 있으면 정확한 값, 없으면 vol*price)
    gainRanking.forEach(s=>{
      const v=volMap.get(s.code);
      if(v&&v.amt>0){s.amt=v.amt;s.amtFmt=v.amtFmt;}
    });

    const rising=[...volAll].filter(s=>s.change>0).sort((a,b)=>b.isLimit-a.isLimit||b.change-a.change);

    res.status(200).json({
      ok:true,_token:tk,
      date:new Date().toLocaleDateString("ko-KR",{timeZone:"Asia/Seoul"}),
      topVolume:[...volAll].sort((a,b)=>b.amt-a.amt),
      topRising:rising,
      gainRanking,
      limitUp:gainRanking.filter(s=>s.isLimit),
      total:volAll.length,
      debug:{volTotal:volAll.length,gainTotal:gainRanking.length,gainApiOk,gainErr:gainErr||null}
    });
  }catch(e){res.status(500).json({ok:false,error:e.message})}
};
