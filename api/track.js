// api/track.js — 실시간 신호 저장 + KIS outcome 추적
const https = require('https');
const AK = process.env.KIS_APP_KEY;
const AS = process.env.KIS_APP_SECRET;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const H = 'openapi.koreainvestment.com', P = 9443;
const GH_OWNER='neo9999999999', GH_REPO='sector-api', SIGNALS_PATH='data/signals.json';
let _tk=null, _te=0;

function rq(m,p,h,b){return new Promise((y,n)=>{const r=https.request({hostname:H,port:P,path:p,method:m,headers:Object.assign({},h,{'Content-Type':'application/json'})},s=>{let t='';s.on('data',c=>t+=c);s.on('end',()=>{try{y(JSON.parse(t))}catch(e){n(new Error(t.slice(0,200)))}})});r.on('error',n);if(b)r.write(JSON.stringify(b));r.end()});}

function rqGH(m,path,body){return new Promise((y,n)=>{const d=body?JSON.stringify(body):null;const r=https.request({hostname:'api.github.com',path,method:m,headers:{'Authorization':'token '+GITHUB_TOKEN,'Content-Type':'application/json','User-Agent':'neo-score-tracker','Content-Length':d?Buffer.byteLength(d):0}},s=>{let t='';s.on('data',c=>t+=c);s.on('end',()=>{try{y(JSON.parse(t))}catch(e){y({_raw:t.slice(0,200)})}})});r.on('error',n);if(d)r.write(d);r.end()});}

async function tok(){if(_tk&&Date.now()<_te)return _tk;const r=await rq('POST','/oauth2/tokenP',{},{grant_type:'client_credentials',appkey:AK,appsecret:AS});if(!r.access_token)throw new Error('Token fail');_tk=r.access_token;_te=Date.now()+86300000;return _tk;}
function w(ms){return new Promise(r=>setTimeout(r,ms));}

async function readSignals(){
  if(!GITHUB_TOKEN)return{signals:[],sha:null};
  try{const r=await rqGH('GET',`/repos/${GH_OWNER}/${GH_REPO}/contents/${SIGNALS_PATH}`);
    if(r.content)return{signals:JSON.parse(Buffer.from(r.content,'base64').toString()),sha:r.sha};
    return{signals:[],sha:null};
  }catch(e){return{signals:[],sha:null};}
}

async function writeSignals(signals,sha){
  if(!GITHUB_TOKEN)return false;
  const content=Buffer.from(JSON.stringify(signals,null,2)).toString('base64');
  const r=await rqGH('PUT',`/repos/${GH_OWNER}/${GH_REPO}/contents/${SIGNALS_PATH}`,
    {message:`signals ${new Date().toISOString().slice(0,10)}`,content,...(sha?{sha}:{})});
  return!!r.content;
}

async function getDailyPrices(tk,code,from,to){
  const r=await rq('GET','/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice?'+
    new URLSearchParams({FID_COND_MRKT_DIV_CODE:'J',FID_INPUT_ISCD:code,FID_INPUT_DATE_1:from,FID_INPUT_DATE_2:to,FID_PERIOD_DIV_CODE:'D',FID_ORG_ADJ_PRC:'0'}),
    {authorization:'Bearer '+tk,appkey:AK,appsecret:AS,tr_id:'FHKST03010100',custtype:'P'});
  return(r.output2||[]).map(d=>({date:d.stck_bsop_date,close:+d.stck_clpr,high:+d.stck_hgpr,low:+d.stck_lwpr,rate:+d.prdy_ctrt}));
}

function calcOutcome(sig,prices){
  if(!prices||!prices.length)return null;
  const ep=sig.entry_price,t1=ep*(1+sig.tp1/100),t2=ep*(1+sig.tp2/100),sl=ep*(1-sig.sl/100);
  let tp1h=false,tp2h=false,slh=false,tp1d=null,tp2d=null,sld=null,maxG=0,maxD=0;
  for(const d of prices){
    const g=(d.high-ep)/ep*100,dr=(d.low-ep)/ep*100;
    maxG=Math.max(maxG,g);maxD=Math.min(maxD,dr);
    if(!tp1h&&d.high>=t1){tp1h=true;tp1d=d.date;}
    if(!tp2h&&d.high>=t2){tp2h=true;tp2d=d.date;}
    if(!slh&&d.low<=sl){slh=true;sld=d.date;}
  }
  let result,profit;
  const last=prices[prices.length-1];
  if(tp2h){result='BOTH';profit=sig.tp1/2+sig.tp2/2;}
  else if(tp1h&&slh){result='SL2';profit=sig.tp1/2-sig.sl/2;}
  else if(tp1h){result='TP1';const cr=(last.close-ep)/ep*100;profit=sig.tp1/2+cr/2;}
  else if(slh){result='SL';profit=-(sig.sl+0.6);}
  else{result='OPEN';profit=(last.close-ep)/ep*100;}
  return{result,profit:Math.round(profit*100)/100,max_gain:Math.round(maxG*100)/100,max_drop:Math.round(maxD*100)/100,tp1_hit:tp1h,tp2_hit:tp2h,sl_hit:slh,tp1_date:tp1d,tp2_date:tp2d,sl_date:sld,days:prices.length};
}

function kst(){return new Date(Date.now()+9*3600000).toISOString().replace('T',' ').slice(0,16);}

module.exports=async function(req,res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','*');
  if(req.method==='OPTIONS')return res.status(200).end();

  const today=new Date(Date.now()+9*3600000).toISOString().slice(0,10).replace(/-/g,'');

  try{
    // POST: 새 신호 저장
    if(req.method==='POST'){
      const body=req.body||{};
      const arr=Array.isArray(body)?body:(body.signals||[body]);
      if(!arr.length||!arr[0].code)return res.status(400).json({ok:false,error:'code 필드 필요'});
      const{signals,sha}=await readSignals();
      const existing=new Set(signals.map(s=>s.code+'_'+s.signal_date));
      let added=0;
      for(const s of arr){
        const key=s.code+'_'+(s.signal_date||today);
        if(existing.has(key))continue;
        signals.unshift({id:Date.now()+'_'+s.code,code:s.code,name:s.name,
          signal_date:s.signal_date||today,entry_price:s.entry_price||s.price,
          rate:s.rate||s.change,score:s.score,grade:s.grade,supply:s.investor||s.supply,
          wick:s.wick,vol:s.amount||s.vol,market:s.market,
          tp1:s.tp1||(s.grade==='B'?12:15),tp2:s.tp2||50,sl:s.sl||13,
          outcome:null,saved_at:kst()});
        existing.add(key);added++;
      }
      if(added>0)await writeSignals(signals,sha);
      return res.json({ok:true,added,total:signals.length,
        github_ok:!!GITHUB_TOKEN,note:GITHUB_TOKEN?'저장됨':'GITHUB_TOKEN 없음'});
    }

    // GET
    const{check,code:fc,limit}=req.query;
    const{signals,sha}=await readSignals();
    let filtered=fc?signals.filter(s=>s.code===fc):signals;

    // outcome 체크
    let checked=0,updated=0;
    if(check==='1'&&AK&&AS){
      const tk=await tok();
      const pending=signals.filter(s=>!s.outcome||s.outcome.result==='OPEN').slice(0,parseInt(limit)||10);
      for(const s of pending){
        try{
          const prices=await getDailyPrices(tk,s.code,s.signal_date,today);
          const after=prices.filter(p=>p.date>=s.signal_date);
          if(!after.length)continue;
          const outcome=calcOutcome(s,after);
          const idx=signals.findIndex(x=>x.id===s.id);
          if(idx>=0){signals[idx].outcome=outcome;signals[idx].last_checked=kst();updated++;}
          checked++;
          await w(300);
        }catch(e){}
      }
      if(updated>0)await writeSignals(signals,sha);
    }

    const resolved=filtered.filter(s=>s.outcome&&s.outcome.result!=='OPEN');
    const wins=resolved.filter(s=>(s.outcome?.profit||0)>0);
    const avgP=resolved.length?Math.round(resolved.reduce((a,s)=>a+(s.outcome?.profit||0),0)/resolved.length*100)/100:0;

    return res.json({ok:true,
      stats:{total:filtered.length,resolved:resolved.length,open:filtered.length-resolved.length,
        wins:wins.length,losses:resolved.length-wins.length,
        win_rate:resolved.length?Math.round(wins.length/resolved.length*100):0,avg_profit:avgP},
      checked,updated,signals:filtered,
      github_ok:!!GITHUB_TOKEN});
  }catch(e){return res.status(500).json({ok:false,error:e.message});}
};
