// api/daily-price.js — KIS 일별 주가 + 투자자 매매동향 (최근 30일 & 과거)
const https = require('https');
const AK = process.env.KIS_APP_KEY;
const AS = process.env.KIS_APP_SECRET;
const H = 'openapi.koreainvestment.com', P = 9443;
let _tk=null, _te=0;

function rq(m,p,h,b){return new Promise((y,n)=>{const r=https.request({hostname:H,port:P,path:p,method:m,headers:Object.assign({},h,{'Content-Type':'application/json'})},s=>{let t='';s.on('data',c=>t+=c);s.on('end',()=>{try{y(JSON.parse(t))}catch(e){n(new Error(t.slice(0,200)))}})});r.on('error',n);if(b)r.write(JSON.stringify(b));r.end()});}

async function tok(){if(_tk&&Date.now()<_te)return _tk;let lastErr;for(let i=0;i<3;i++){try{const r=await rq('POST','/oauth2/tokenP',{},{grant_type:'client_credentials',appkey:AK,appsecret:AS});if(r.access_token){_tk=r.access_token;_te=Date.now()+86300000;return _tk;}lastErr='Token:'+JSON.stringify(r).slice(0,200);if(lastErr.includes('EGW00133')){await new Promise(r=>setTimeout(r,62000));continue;}}catch(e){lastErr=e.message;}await new Promise(r=>setTimeout(r,5000));}throw new Error(lastErr||'token fail');}

function toKis(d){if(!d)return '';d=String(d);if(d.includes('-')){const p=d.split('-');const y=p[0].length===2?(parseInt(p[0])>=70?'19':'20')+p[0]:p[0];return y+p[1]+p[2];}return d;}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchNxt(c){try{const nv=await fetch('https://m.stock.naver.com/api/stock/'+c+'/integration',{headers:{'User-Agent':'Mozilla/5.0'}});if(!nv.ok)return null;const d=await nv.json();const ti=d.totalInfos||[];const f=k=>{const x=ti.find(y=>y.code===k);return x?x.value:'';};const n=s=>+String(s).replace(/[^\d]/g,'')||0;const amtBM=n(f('accumulatedTradingValue'));const di=(d.dealTrendInfos&&d.dealTrendInfos[0])||{};const lastC=n(f('lastClosePrice'));const closeR=n(String(di.closePrice||'').replace(/[^\d]/g,''));return{amt:amtBM*1000000,vol:n(f('accumulatedTradingVolume')),high:n(f('highPrice')),low:n(f('lowPrice')),open:n(f('openPrice')),close:closeR,lastClose:lastC,rate:lastC>0?Math.round((closeR-lastC)/lastC*10000)/100:0};}catch(e){return null;}}

async function fetchInv(code, tk){
  const r = await rq('GET','/uapi/domestic-stock/v1/quotations/inquire-investor?'+new URLSearchParams({FID_COND_MRKT_DIV_CODE:'J',FID_INPUT_ISCD:code}),{authorization:'Bearer '+tk,appkey:AK,appsecret:AS,tr_id:'FHKST01010900',custtype:'P'});
  return r;
}

// 과거 일자 범위 투자자 매매동향 - inquire-investor-daily-by-date (tr_id: FHKST03010400 또는 FHPTJ04400000)
// FHKST03900000: 종목별 외국인/기관 일별 — 과거 데이터 가능
async function fetchInvHist(code, fromYmd, toYmd, tk){
  const r = await rq('GET','/uapi/domestic-stock/v1/quotations/inquire-investor-daily-by-date?'+new URLSearchParams({FID_COND_MRKT_DIV_CODE:'J',FID_INPUT_ISCD:code,FID_INPUT_DATE_1:fromYmd,FID_INPUT_DATE_2:toYmd}),{authorization:'Bearer '+tk,appkey:AK,appsecret:AS,tr_id:'FHKST03010400',custtype:'P'});
  return r;
}

module.exports=async function(req,res){
  res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Cache-Control','no-store,no-cache,must-revalidate,max-age=0');
  res.setHeader('Access-Control-Allow-Methods','GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','*');
  if(req.method==='OPTIONS')return res.status(200).end();
  try{
    if(!AK||!AS)return res.status(500).json({ok:false,error:'KIS keys missing'});
    const tk=await tok();
    const {code,date,from,to,name,verify_rate,kind,codes}=req.query;

    if(kind==='inv'){
      if(codes){
        const list=codes.split(',').filter(Boolean).slice(0,20);
        const data={};
        const errors=[];
        for(const c of list){
          try{
            const r=await fetchInv(c,tk);
            if(r.rt_cd==='0') data[c]=r.output||[];
            else errors.push({code:c,msg:r.msg1||r.msg_cd});
          }catch(e){errors.push({code:c,err:e.message});}
          await sleep(180);
        }
        return res.json({ok:true,count:list.length,data,errors});
      }
      if(!code)return res.status(400).json({ok:false,error:'kind=inv requires code or codes'});
      const r=await fetchInv(code,tk);
      return res.json({ok:true,code,rt_cd:r.rt_cd,msg:r.msg1,output:r.output||[]});
    }

    if(kind==='naver'){try{const u1='https://m.stock.naver.com/api/stock/'+code+'/integration';const u2='https://finance.naver.com/item/main.naver?code='+code;const r1=await fetch(u1,{headers:{'User-Agent':'Mozilla/5.0'}});const t1=await r1.text();let r2text='';try{const r2=await fetch(u2,{headers:{'User-Agent':'Mozilla/5.0'}});r2text=await r2.text();}catch(e){r2text='ERR:'+e.message;}return res.json({mobile_status:r1.status,mobile_len:t1.length,mobile_body:t1.slice(0,8000),pc_len:r2text.length,pc_body_sample:r2text.slice(0,3000)});}catch(e){return res.json({err:e.message});}}

  if(kind==='inv2'){
      if(!code) return res.status(400).json({ok:false,error:'kind=inv2 requires code'});
      const f = toKis(from||date) || '20260101';
      const t = toKis(to||date) || '20261231';
      const r=await fetchInvHist(code,f,t,tk);
      return res.json({ok: r.rt_cd==='0', code, from:f, to:t, rt_cd:r.rt_cd, msg:r.msg1, output:r.output||[], raw:r.rt_cd!=='0'?r:undefined});
    }

    if(name&&!code){
      const r=await rq('GET','/uapi/domestic-stock/v1/quotations/search-stock-info?'+new URLSearchParams({PRDT_TYPE_CD:'300',PDNO:name}),{authorization:'Bearer '+tk,appkey:AK,appsecret:AS,tr_id:'CTPF1604R',custtype:'P'});
      return res.json({ok:true,mode:'name_search',name,result:r.output||r});
    }

    if(!code)return res.status(400).json({ok:false,error:'code 파라미터 필요'});

    const t1=toKis(from||date), t2=toKis(to||date||from); const targetYmd=toKis(date||to||from);
    if(!t1)return res.status(400).json({ok:false,error:'date 파라미터 필요'});
    const r=await rq('GET','/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice?'+new URLSearchParams({FID_COND_MRKT_DIV_CODE:'J',FID_INPUT_ISCD:code,FID_INPUT_DATE_1:t1,FID_INPUT_DATE_2:t2,FID_PERIOD_DIV_CODE:'D',FID_ORG_ADJ_PRC:'0'}),{authorization:'Bearer '+tk,appkey:AK,appsecret:AS,tr_id:'FHKST03010100',custtype:'P'});
    if(r.rt_cd!=='0')return res.json({ok:false,code,date:t1,kis_error:r.msg1||r.msg_cd,raw:r});
    const rows=(r.output2||[]).map(d=>({date:d.stck_bsop_date,close:+d.stck_clpr,open:+d.stck_oprc,high:+d.stck_hgpr,low:+d.stck_lwpr,vol:+d.acml_vol,amt:+d.acml_tr_pbmn||0,rate:+d.prdy_ctrt}));
    const targetRow=targetYmd?rows.find(d=>d.date===targetYmd):null;
    let verification=null;
    if(verify_rate!==undefined&&targetRow){
      const exp=parseFloat(verify_rate),act=targetRow.rate,diff=Math.abs(act-exp);
      verification={expected_rate:exp,actual_rate:act,diff:Math.round(diff*100)/100, match:diff<=1.0,status:diff<=0.5?'정확':diff<=1.0?'근사':'불일치'};
    }
    if(rows[0]){const _td=new Date();const _ty=_td.getFullYear()+String(_td.getMonth()+1).padStart(2,"0")+String(_td.getDate()).padStart(2,"0");if(rows[0].date===_ty){try{const nxt=await fetchNxt(code);if(nxt&&nxt.amt>0){rows[0].amt=nxt.amt;rows[0].vol=nxt.vol||rows[0].vol;rows[0].high=nxt.high||rows[0].high;rows[0].low=nxt.low||rows[0].low;if(!rows[0].rate||isNaN(rows[0].rate))rows[0].rate=nxt.rate;rows[0]._nxt=true;}}catch(e){}}}
  return res.json({ok:true,code,name:(r.output1||{}).hts_kor_isnm||'', market:(r.output1||{}).rprs_mrkt_kor_name||'', target_date:targetYmd,target_row:targetRow,all_rows:rows,verification});
  }catch(e){return res.status(500).json({ok:false,error:e.message});}
};
