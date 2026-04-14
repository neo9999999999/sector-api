const https=require("https");
const AK=process.env.KIS_APP_KEY||"PSl3mhWiWrra8foZgmNLG0VgjgKGERoJtOWn";
const AS=process.env.KIS_APP_SECRET||"IoZNaCqHEJ2mRLwqVQg0nshJ+kiQuRfm4WWeK9umumXCiptxKY6jSEywAaYlGqHDEpX8zG7I12VG4pSZChBiOWm2dmKi34OTZvdy+5DZrgUNZINevoYh+S06WkuyZAw/phJ8cibnZnQ8XkD9fznIQWsEADLJEaXz60KHEZfiXYqNVySqqFI=";
const HOST="openapi.koreainvestment.com";const PORT=9443;
let _tk=null,_tkExp=0;

function req(method,path,headers,body){return new Promise((y,n)=>{const opts={hostname:HOST,port:PORT,path,method,headers:{...headers,"Content-Type":"application/json"}};const r=https.request(opts,s=>{let t="";s.on("data",c=>t+=c);s.on("end",()=>{try{y(JSON.parse(t))}catch{n(new Error(t.slice(0,300)))}})});r.on("error",n);if(body)r.write(JSON.stringify(body));r.end()})}

async function getToken(){
  if(_tk&&Date.now()<_tkExp)return _tk;
  const r=await req("POST","/oauth2/tokenP",{},{grant_type:"client_credentials",appkey:AK,appsecret:AS});
  if(!r.access_token)throw new Error("Token fail: "+JSON.stringify(r).slice(0,200));
  _tk=r.access_token;_tkExp=Date.now()+86300000;
  return _tk;
}

function get(path,trId,params,tk){
  const qs=new URLSearchParams(params).toString();
  return req("GET",path+"?"+qs,{authorization:"Bearer "+tk,appkey:AK,appsecret:AS,tr_id:trId,"custtype":"P"});
}

function w(ms){return new Promise(r=>setTimeout(r,ms))}

// 거래대금 상위 (코스피+코스닥)
async function getTopVolume(tk){
  const base={FID_INPUT_ISCD:"0000",FID_RANK_SORT_CLS_CODE:"0",FID_COND_SCR_DIV_CODE:"20171",
    FID_DIV_CLS_CODE:"0",FID_BLNG_CLS_CODE:"0",FID_TRGT_CLS_CODE:"111111111",
    FID_TRGT_EXLS_CLS_CODE:"000000",FID_INPUT_PRICE_1:"",FID_INPUT_PRICE_2:"",
    FID_VOL_CNT:"",FID_INPUT_DATE_1:""};
  const kp=await get("/uapi/domestic-stock/v1/quotations/volume-rank","FHPST01710000",{...base,FID_COND_MRKT_DIV_CODE:"J"},tk);
  await w(350);
  // 코스닥은 volume-rank가 J만 지원하므로 등락률 상위로 대체
  return(kp.output||[]).map(s=>({
    code:s.mksc_shrn_iscd,name:s.hts_kor_isnm,
    price:+s.stck_prpr,change:+s.prdy_ctrt,
    volume:+s.acml_vol,amount:Math.round(+s.acml_tr_pbmn/100000000),
    open:+s.stck_oprc,high:+s.stck_hgpr,low:+s.stck_lwpr,
    mktcap:Math.round(+s.stck_prpr*(+s.lstn_stcn||0)/100000000),
    market:s.rprs_mrkt_kor_name||"KOSPI"
  }));
}

// 등락률 상위 (코스피)
async function getTopGain(tk,mkt,trCont){
  const base={FID_INPUT_ISCD:"0000",FID_RANK_SORT_CLS_CODE:"0",FID_COND_SCR_DIV_CODE:"20170",
    FID_DIV_CLS_CODE:"0",FID_BLNG_CLS_CODE:"0",FID_TRGT_CLS_CODE:"111111111",
    FID_TRGT_EXLS_CLS_CODE:"000000",FID_INPUT_PRICE_1:"",FID_INPUT_PRICE_2:"",
    FID_VOL_CNT:"",FID_INPUT_DATE_1:""};
  const h={authorization:"Bearer "+tk,appkey:AK,appsecret:AS,tr_id:"FHPST01700000",custtype:"P"};
  if(trCont)h.tr_cont="N";
  const qs=new URLSearchParams({...base,FID_COND_MRKT_DIV_CODE:mkt}).toString();
  return req("GET","/uapi/domestic-stock/v1/ranking/fluctuation?"+qs,h);
}

// 투자자별 매매동향 (기관/외인)
async function getInvestor(tk,code){
  try{
    const r=await get("/uapi/domestic-stock/v1/quotations/inquire-investor","FHKST01010900",
      {FID_COND_MRKT_DIV_CODE:"J",FID_INPUT_ISCD:code},tk);
    if(!r.output)return{inst:0,frgn:0};
    // output[0] = 오늘
    const today=r.output[0]||{};
    return{
      inst:+(today.orgn_ntby_qty||0),  // 기관 순매수량
      frgn:+(today.frgn_ntby_qty||0)   // 외인 순매수량
    };
  }catch{return{inst:0,frgn:0}}
}

// NEO-SCORE 계산
function calcScore(s){
  let sc=0;
  const inv=s.inst>0&&s.frgn>0?"both":s.frgn>0?"frgn":s.inst>0?"inst":"none";
  // 수급
  if(inv==="both")sc+=3;
  else if(inv==="frgn")sc+=2;
  // 윗꼬리
  const wick=s.high>0?(s.high-s.price)/s.price*100:0;
  if(wick<=0.5)sc+=2;
  else if(wick<=2)sc+=1;
  else if(wick>=7)sc-=1;
  // 거래대금
  if(s.amount<200)sc+=2;
  else if(s.amount<500)sc+=1;
  else if(s.amount>=1500)sc-=1;
  // 등락률
  if(s.change>=25)sc+=2;
  else if(s.change>=20)sc+=1;
  // 코스닥
  if(s.market==="KOSDAQ")sc+=1;
  // ETF
  const isEtf=["KODEX","TIGER","RISE","ACE","SOL","KIWOOM","KOSEF","HANARO","ETN"].some(k=>s.name.includes(k));
  if(isEtf)sc-=3;
  // 돌파강도 (근사: 전일대비 상승률 자체를 사용)
  if(s.change>=0&&s.change<=13)sc+=2; // 소폭~중폭
  if(s.change>=15)sc-=1; // 초강력
  
  sc=Math.max(sc,0);
  const grade=sc>=9?"S":sc>=7?"A":sc>=5?"B":"X";
  const tp1=grade==="B"?12:15;
  const tp2=50;
  const sl=13;
  const invLabel=inv==="both"?"기+외":inv==="frgn"?"외인":inv==="inst"?"기관":"없음";
  
  return{...s,score:sc,grade,tp1,tp2,sl,investor:invLabel,
    wick:Math.round(wick*10)/10,isEtf,
    body:Math.round((s.price-s.open)/s.open*1000)/10};
}

module.exports=async(req,res)=>{
  res.setHeader("Access-Control-Allow-Origin","*");
  res.setHeader("Access-Control-Allow-Methods","GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers","*");
  if(req.method==="OPTIONS")return res.status(200).end();
  
  try{
    const tk=await getToken();
    
    // 1. 거래대금 상위 수집
    const volStocks=await getTopVolume(tk);
    await w(350);
    
    // 2. 등락률 상위 수집 (코스피)
    let gainStocks=[];
    try{
      const gK=await getTopGain(tk,"J");
      gainStocks=(gK.output||[]).map(s=>({
        code:s.mksc_shrn_iscd||s.stck_shrn_iscd,name:s.hts_kor_isnm,
        price:+s.stck_prpr,change:+s.prdy_ctrt,
        volume:+s.acml_vol,amount:Math.round(+s.acml_tr_pbmn/100000000),
        open:+s.stck_oprc,high:+s.stck_hgpr,low:+s.stck_lwpr,
        mktcap:0,market:"KOSPI"
      }));
    }catch(e){console.log("gain error:",e.message)}
    await w(350);
    
    // 3. 합치기 + 중복제거 + 10%이상 + 시총3000억+ + 거래대금50억+ 필터
    const seen=new Set();
    const all=[];
    [...volStocks,...gainStocks].forEach(s=>{
      if(!s.code||seen.has(s.code))return;
      seen.add(s.code);
      if(s.change>=10&&s.change<29&&s.amount>=50)all.push(s);
    });
    
    // 4. 각 종목 투자자 데이터 조회 (최대 20개, rate limit 고려)
    const candidates=all.slice(0,20);
    for(let i=0;i<candidates.length;i++){
      await w(300);
      const inv=await getInvestor(tk,candidates[i].code);
      candidates[i].inst=inv.inst;
      candidates[i].frgn=inv.frgn;
    }
    
    // 5. NEO-SCORE 계산
    const scored=candidates.map(calcScore).filter(s=>!s.isEtf);
    scored.sort((a,b)=>b.score-a.score);
    
    const sGrade=scored.filter(s=>s.grade==="S");
    const aGrade=scored.filter(s=>s.grade==="A");
    const bGrade=scored.filter(s=>s.grade==="B");
    const xGrade=scored.filter(s=>s.grade==="X");
    
    const now=new Date();
    const kst=new Date(now.getTime()+9*3600000);
    
    res.status(200).json({
      ok:true,
      date:kst.toISOString().slice(0,10),
      time:kst.toISOString().slice(11,16),
      summary:{
        total:scored.length,
        S:sGrade.length,A:aGrade.length,B:bGrade.length,X:xGrade.length
      },
      signals:{S:sGrade,A:aGrade,B:bGrade,X:xGrade},
      all:scored,
      strategy:{
        S:{tp1:15,tp2:50,sl:13,desc:"풀사이즈"},
        A:{tp1:15,tp2:50,sl:13,desc:"기본비중"},
        B:{tp1:12,tp2:50,sl:13,desc:"소량"},
        X:{tp1:0,tp2:0,sl:0,desc:"매수금지"}
      }
    });
  }catch(e){
    res.status(500).json({ok:false,error:e.message,stack:e.stack?.slice(0,300)});
  }
};
