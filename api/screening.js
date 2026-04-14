const https=require("https");
const AK=process.env.KIS_APP_KEY||"PSl3mhWiWrra8foZgmNLG0VgjgKGERoJtOWn";
const AS=process.env.KIS_APP_SECRET||"IoZNaCqHEJ2mRLwqVQg0nshJ+kiQuRfm4WWeK9umumXCiptxKY6jSEywAaYlGqHDEpX8zG7I12VG4pSZChBiOWm2dmKi34OTZvdy+5DZrgUNZINevoYh+S06WkuyZAw/phJ8cibnZnQ8XkD9fznIQWsEADLJEaXz60KHEZfiXYqNVySqqFI=";
const HOST="openapi.koreainvestment.com";const PORT=9443;
let _tk=null,_tkExp=0;
function req(method,path,headers,body){return new Promise((y,n)=>{const opts={hostname:HOST,port:PORT,path,method,headers:{...headers,"Content-Type":"application/json"}};const r=https.request(opts,s=>{let t="";s.on("data",c=>t+=c);s.on("end",()=>{try{y(JSON.parse(t))}catch{n(new Error(t.slice(0,300)))}})});r.on("error",n);if(body)r.write(JSON.stringify(body));r.end()})}
async function getToken(){if(_tk&&Date.now()<_tkExp)return _tk;const r=await req("POST","/oauth2/tokenP",{},{grant_type:"client_credentials",appkey:AK,appsecret:AS});if(!r.access_token)throw new Error("Token:"+JSON.stringify(r).slice(0,200));_tk=r.access_token;_tkExp=Date.now()+86300000;return _tk}
function w(ms){return new Promise(r=>setTimeout(r,ms))}
function parseS(s,mkt){return{code:s.mksc_shrn_iscd||s.stck_shrn_iscd||"",name:s.hts_kor_isnm||"",price:+s.stck_prpr||0,change:+(s.prdy_ctrt||0),volume:+s.acml_vol||0,amount:Math.round((+s.acml_tr_pbmn||0)/1e8),open:+s.stck_oprc||0,high:+s.stck_hgpr||0,low:+s.stck_lwpr||0,mktcap:Math.round((+s.stck_prpr||0)*(+s.lstn_stcn||0)/1e8),market:mkt}}
async function fetchPages(tk,path,trId,params,mkt,pages){
  const all=[],errs=[];
  for(let p=0;p<pages;p++){
    try{
      const qs=new URLSearchParams(params).toString();
      const h={authorization:"Bearer "+tk,appkey:AK,appsecret:AS,tr_id:trId,custtype:"P"};
      if(p>0)h.tr_cont="N";
      const r=await req("GET",path+"?"+qs,h);
      if(r.rt_cd!=="0"){errs.push(trId+":"+mkt+":"+r.msg1);break}
      const items=(r.output||[]).map(s=>parseS(s,mkt));
      if(items.length===0)break;
      all.push(...items);await w(300);
    }catch(e){errs.push(trId+":"+mkt+":"+e.message);break}
  }
  return{items:all,errs};
}
async function getInvestor(tk,code,mkt){try{const mktC=mkt==="KOSDAQ"?"Q":"J";const r=await req("GET","/uapi/domestic-stock/v1/quotations/inquire-investor?"+new URLSearchParams({FID_COND_MRKT_DIV_CODE:mktC,FID_INPUT_ISCD:code}).toString(),{authorization:"Bearer "+tk,appkey:AK,appsecret:AS,tr_id:"FHKST01010900",custtype:"P"});if(!r.output||!r.output[0])return{inst:0,frgn:0};const t=r.output[0];return{inst:+(t.orgn_ntby_qty||0),frgn:+(t.frgn_ntby_qty||0)}}catch{return{inst:0,frgn:0}}}
function calcScore(s){let sc=0;const inv=s.inst>0&&s.frgn>0?"both":s.frgn>0?"frgn":s.inst>0?"inst":"none";if(inv==="both")sc+=3;else if(inv==="frgn")sc+=2;const wick=s.high>0&&s.price>0?(s.high-s.price)/s.price*100:0;if(wick<=0.5)sc+=2;else if(wick<=2)sc+=1;else if(wick>=7)sc-=1;if(s.amount>0&&s.amount<200)sc+=2;else if(s.amount<500)sc+=1;else if(s.amount>=1500)sc-=1;if(s.change>=25)sc+=2;else if(s.change>=20)sc+=1;if(s.market==="KOSDAQ")sc+=1;const isEtf=["KODEX","TIGER","RISE","ACE","SOL","KIWOOM","KOSEF","HANARO","ETN","1Q "].some(k=>s.name.includes(k));if(isEtf)sc-=3;if(s.change>0&&s.change<=13)sc+=2;if(s.change>=15)sc-=1;sc=Math.max(sc,0);const grade=sc>=9?"S":sc>=7?"A":sc>=5?"B":"X";const tp1=grade==="B"?12:15;const invLabel=inv==="both"?"기+외":inv==="frgn"?"외인":inv==="inst"?"기관":"없음";return{...s,score:sc,grade,tp1,tp2:50,sl:13,investor:invLabel,wick:Math.round(wick*10)/10,isEtf,body:s.open>0?Math.round((s.price-s.open)/s.open*1000)/10:0}}
module.exports=async(req,res)=>{
  res.setHeader("Access-Control-Allow-Origin","*");res.setHeader("Access-Control-Allow-Methods","GET,OPTIONS");res.setHeader("Access-Control-Allow-Headers","*");
  if(req.method==="OPTIONS")return res.status(200).end();
  try{
    const tk=await getToken();const allErrs=[];
    // 등락률순위 파라미터 (FID_INPUT_CNT_1 추가!)
    const gainP={FID_INPUT_ISCD:"0000",FID_RANK_SORT_CLS_CODE:"0",FID_COND_SCR_DIV_CODE:"20170",FID_DIV_CLS_CODE:"0",FID_BLNG_CLS_CODE:"0",FID_TRGT_CLS_CODE:"111111111",FID_TRGT_EXLS_CLS_CODE:"000000",FID_INPUT_PRICE_1:"",FID_INPUT_PRICE_2:"",FID_VOL_CNT:"",FID_INPUT_DATE_1:"",FID_INPUT_CNT_1:"0"};
    // 거래대금순위 파라미터
    const volP={FID_INPUT_ISCD:"0000",FID_RANK_SORT_CLS_CODE:"0",FID_COND_SCR_DIV_CODE:"20171",FID_DIV_CLS_CODE:"0",FID_BLNG_CLS_CODE:"0",FID_TRGT_CLS_CODE:"111111111",FID_TRGT_EXLS_CLS_CODE:"000000",FID_INPUT_PRICE_1:"",FID_INPUT_PRICE_2:"",FID_VOL_CNT:"",FID_INPUT_DATE_1:""};
    // 1) 코스피 거래대금 200
    const v1=await fetchPages(tk,"/uapi/domestic-stock/v1/quotations/volume-rank","FHPST01710000",{...volP,FID_COND_MRKT_DIV_CODE:"J"},"KOSPI",7);
    allErrs.push(...v1.errs);
    // 2) 등락률 전체시장(0) 200 — 코스피+코스닥 동시
    const g0=await fetchPages(tk,"/uapi/domestic-stock/v1/ranking/fluctuation","FHPST01700000",{...gainP,FID_COND_MRKT_DIV_CODE:"0"},"ALL",7);
    allErrs.push(...g0.errs);
    // 3) 등락률 코스피(1) 200
    const g1=await fetchPages(tk,"/uapi/domestic-stock/v1/ranking/fluctuation","FHPST01700000",{...gainP,FID_COND_MRKT_DIV_CODE:"1"},"KOSPI",7);
    allErrs.push(...g1.errs);
    // 4) 등락률 코스닥(2) 200
    const g2=await fetchPages(tk,"/uapi/domestic-stock/v1/ranking/fluctuation","FHPST01700000",{...gainP,FID_COND_MRKT_DIV_CODE:"2"},"KOSDAQ",7);
    allErrs.push(...g2.errs);
    // 마켓 판별: ALL인 경우 종목코드로 구분 (3,4로 시작=코스닥)
    g0.items.forEach(s=>{if(s.market==="ALL"){const c=s.code.charAt(0);s.market=(c==="3"||c==="4"||c==="9")?"KOSDAQ":"KOSPI"}});
    // 합치기+중복제거+필터
    const seen=new Set();const all=[];
    [...v1.items,...g0.items,...g1.items,...g2.items].forEach(s=>{if(!s.code||seen.has(s.code))return;seen.add(s.code);if(s.change>=10&&s.change<29&&s.amount>=50)all.push(s)});
    // 투자자 데이터
    const cands=all.slice(0,40);
    for(let i=0;i<cands.length;i++){await w(200);const inv=await getInvestor(tk,cands[i].code,cands[i].market);cands[i].inst=inv.inst;cands[i].frgn=inv.frgn}
    const scored=cands.map(calcScore).filter(s=>!s.isEtf);scored.sort((a,b)=>b.score-a.score);
    const sG=scored.filter(s=>s.grade==="S"),aG=scored.filter(s=>s.grade==="A"),bG=scored.filter(s=>s.grade==="B"),xG=scored.filter(s=>s.grade==="X");
    const now=new Date(),kst=new Date(now.getTime()+9*3600000);
    res.status(200).json({ok:true,date:kst.toISOString().slice(0,10),time:kst.toISOString().slice(11,16),summary:{total:scored.length,S:sG.length,A:aG.length,B:bG.length,X:xG.length},signals:{S:sG,A:aG,B:bG,X:xG},all:scored,debug:{volKP:v1.items.length,gainAll:g0.items.length,gainKP:g1.items.length,gainKQ:g2.items.length,filtered:all.length,scored:scored.length,errors:allErrs}});
  }catch(e){res.status(500).json({ok:false,error:e.message})}
};
