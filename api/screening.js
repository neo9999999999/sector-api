const https=require("https");
const AK=process.env.KIS_APP_KEY||"PSl3mhWiWrra8foZgmNLG0VgjgKGERoJtOWn";
const AS=process.env.KIS_APP_SECRET||"IoZNaCqHEJ2mRLwqVQg0nshJ+kiQuRfm4WWeK9umumXCiptxKY6jSEywAaYlGqHDEpX8zG7I12VG4pSZChBiOWm2dmKi34OTZvdy+5DZrgUNZINevoYh+S06WkuyZAw/phJ8cibnZnQ8XkD9fznIQWsEADLJEaXz60KHEZfiXYqNVySqqFI=";
const HOST="openapi.koreainvestment.com";const PORT=9443;
let _tk=null,_tkExp=0;
function req(m,p,h,b){return new Promise((y,n)=>{const o={hostname:HOST,port:PORT,path:p,method:m,headers:{...h,"Content-Type":"application/json"}};const r=https.request(o,s=>{let t="";s.on("data",c=>t+=c);s.on("end",()=>{try{y(JSON.parse(t))}catch{n(new Error(t.slice(0,300)))}})});r.on("error",n);if(b)r.write(JSON.stringify(b));r.end()})}
async function getToken(){if(_tk&&Date.now()<_tkExp)return _tk;const r=await req("POST","/oauth2/tokenP",{},{grant_type:"client_credentials",appkey:AK,appsecret:AS});if(!r.access_token)throw new Error("Token:"+JSON.stringify(r).slice(0,200));_tk=r.access_token;_tkExp=Date.now()+86300000;return _tk}
function w(ms){return new Promise(r=>setTimeout(r,ms))}

// 이미 작동하는 market-data 엔드포인트 호출
function fetchMarketData(){
  return new Promise((y,n)=>{
    const r=https.request({hostname:"sector-api-v8mg-ashy.vercel.app",port:443,path:"/api/market-data",method:"GET",headers:{"Accept":"application/json"}},s=>{
      let t="";s.on("data",c=>t+=c);s.on("end",()=>{try{y(JSON.parse(t))}catch{n(new Error(t.slice(0,300)))}})
    });r.on("error",n);r.end();
  });
}

async function getInvestor(tk,code,mkt){
  try{
    const qs=new URLSearchParams({FID_COND_MRKT_DIV_CODE:mkt==="KOSDAQ"?"Q":"J",FID_INPUT_ISCD:code}).toString();
    const r=await req("GET","/uapi/domestic-stock/v1/quotations/inquire-investor?"+qs,{authorization:"Bearer "+tk,appkey:AK,appsecret:AS,tr_id:"FHKST01010900",custtype:"P"});
    if(!r.output||!r.output[0])return{inst:0,frgn:0};
    const t=r.output[0];
    return{inst:+(t.orgn_ntby_qty||0),frgn:+(t.frgn_ntby_qty||0)}
  }catch{return{inst:0,frgn:0}}
}

function calcScore(s){
  let sc=0;
  const inv=s.inst>0&&s.frgn>0?"both":s.frgn>0?"frgn":s.inst>0?"inst":"none";
  if(inv==="both")sc+=3;else if(inv==="frgn")sc+=2;
  const wick=s.high>0&&s.price>0?(s.high-s.price)/s.price*100:0;
  if(wick<=0.5)sc+=2;else if(wick<=2)sc+=1;else if(wick>=7)sc-=1;
  if(s.amt>0&&s.amt<200)sc+=2;else if(s.amt<500)sc+=1;else if(s.amt>=1500)sc-=1;
  if(s.change>=25)sc+=2;else if(s.change>=20)sc+=1;
  if(s.market==="KOSDAQ")sc+=1;
  const isEtf=["KODEX","TIGER","RISE","ACE","SOL","KIWOOM","KOSEF","HANARO","ETN","1Q "].some(k=>(s.name||"").includes(k));
  if(isEtf)sc-=3;
  if(s.change>0&&s.change<=13)sc+=2;
  if(s.change>=15)sc-=1;
  sc=Math.max(sc,0);
  const grade=sc>=9?"S":sc>=7?"A":sc>=5?"B":"X";
  return{code:s.code,name:s.name,price:s.price,change:s.change,amount:s.amt,market:s.market,
    open:s.open,high:s.high,low:s.low,volume:s.vol,
    score:sc,grade,tp1:grade==="B"?12:15,tp2:50,sl:13,
    investor:inv==="both"?"기+외":inv==="frgn"?"외인":inv==="inst"?"기관":"없음",
    wick:Math.round(wick*10)/10,isEtf,inst:s.inst,frgn:s.frgn}
}

module.exports=async(req2,res)=>{
  res.setHeader("Access-Control-Allow-Origin","*");
  res.setHeader("Access-Control-Allow-Methods","GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers","*");
  if(req2.method==="OPTIONS")return res.status(200).end();
  try{
    // 1) 기존 market-data에서 전체 종목 가져오기 (코스피+코스닥 이미 포함)
    const md=await fetchMarketData();
    if(!md.ok)throw new Error("market-data failed: "+JSON.stringify(md).slice(0,200));
    
    // 2) 전체 종목에서 10%이상 29%미만 + 거래대금50억+ 필터
    const all=(md.all||[]).map(s=>({
      code:s.code,name:s.name,price:s.price||0,change:s.change||0,
      amt:s.amt||s.amount||0,vol:s.vol||s.volume||0,
      open:s.open||0,high:s.high||0,low:s.low||0,
      market:s.market||(s.isKosdaq?"KOSDAQ":"KOSPI"),
      isLimit:s.isLimit||false
    }));
    
    const kospi=all.filter(s=>s.market!=="KOSDAQ").length;
    const kosdaq=all.filter(s=>s.market==="KOSDAQ").length;
    
    const filtered=all.filter(s=>s.change>=10&&s.change<29&&s.amt>=50);
    
    // 3) 투자자 데이터 조회
    const tk=await getToken();
    const cands=filtered.slice(0,40);
    for(let i=0;i<cands.length;i++){
      await w(200);
      const inv=await getInvestor(tk,cands[i].code,cands[i].market);
      cands[i].inst=inv.inst;
      cands[i].frgn=inv.frgn;
    }
    
    // 4) NEO-SCORE 계산
    const scored=cands.map(calcScore).filter(s=>!s.isEtf);
    scored.sort((a,b)=>b.score-a.score);
    
    const now=new Date(),kst=new Date(now.getTime()+9*3600000);
    res.status(200).json({
      ok:true,
      date:kst.toISOString().slice(0,10),
      time:kst.toISOString().slice(11,16),
      summary:{
        total:scored.length,
        S:scored.filter(s=>s.grade==="S").length,
        A:scored.filter(s=>s.grade==="A").length,
        B:scored.filter(s=>s.grade==="B").length,
        X:scored.filter(s=>s.grade==="X").length
      },
      signals:{
        S:scored.filter(s=>s.grade==="S"),
        A:scored.filter(s=>s.grade==="A"),
        B:scored.filter(s=>s.grade==="B"),
        X:scored.filter(s=>s.grade==="X")
      },
      all:scored,
      debug:{
        marketDataTotal:all.length,
        kospi:kospi,
        kosdaq:kosdaq,
        filtered:filtered.length,
        scored:scored.length
      }
    });
  }catch(e){res.status(500).json({ok:false,error:e.message})}
};
