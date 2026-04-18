// api/inv.js - 종목별 투자자 매매동향
const https = require('https');
const H = 'openapi.koreainvestment.com', P = 9443;
const AK = process.env.KIS_APP_KEY, SK = process.env.KIS_APP_SECRET;
let _t = null, _e = 0;

function r(o,b){return new Promise((rs,rj)=>{const q=https.request(o,s=>{const cs=[];s.on('data',c=>cs.push(c));s.on('end',()=>rs({status:s.statusCode,body:Buffer.concat(cs).toString('utf8')}));});q.on('error',rj);q.setTimeout(20000,()=>q.destroy(new Error('timeout')));if(b)q.write(b);q.end();});}

async function tok(){
  if(_t && Date.now()<_e) return _t;
  const b=JSON.stringify({grant_type:'client_credentials',appkey:AK,appsecret:SK});
  const x=await r({hostname:H,port:P,path:'/oauth2/tokenP',method:'POST',headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(b)}},b);
  const d=JSON.parse(x.body);
  if(!d.access_token) throw new Error('tokfail '+x.body.slice(0,200));
  _t=d.access_token; _e=Date.now()+23*3600*1000; return _t;
}

async function inv(code){
  const t=await tok();
  const p='/uapi/domestic-stock/v1/quotations/inquire-investor?FID_COND_MRKT_DIV_CODE=J&FID_INPUT_ISCD='+code;
  const x=await r({hostname:H,port:P,path:p,method:'GET',headers:{'Content-Type':'application/json; charset=utf-8','authorization':'Bearer '+t,'appkey':AK,'appsecret':SK,'tr_id':'FHKST01010900','custtype':'P'}});
  return {status:x.status, body:x.body};
}

module.exports = async (q,res)=>{
  res.setHeader('Access-Control-Allow-Origin','*');
  if(q.method==='OPTIONS') return res.status(200).end();
  if(!AK||!SK) return res.status(500).json({ok:false,error:'keys missing'});
  const code = q.query.code;
  const codes = q.query.codes;
  try{
    if(code){
      const out=await inv(code);
      try{ return res.status(200).json({ok:true, code, data:JSON.parse(out.body)}); }
      catch(_){ return res.status(200).json({ok:false, code, status:out.status, raw:out.body.slice(0,500)}); }
    }
    if(codes){
      const list = codes.split(',').filter(Boolean).slice(0,15);
      const result = {};
      const errors = [];
      for(const c of list){
        const o = await inv(c);
        await new Promise(x=>setTimeout(x,200));
        try{
          const d = JSON.parse(o.body);
          if(d.rt_cd==='0') result[c]=d.output||[];
          else errors.push({code:c, msg:d.msg1||d.msg_cd});
        }catch(e){ errors.push({code:c, parse:e.message}); }
      }
      return res.status(200).json({ok:true, count:list.length, data:result, errors});
    }
    return res.status(400).json({ok:false,error:'missing code or codes'});
  }catch(e){
    return res.status(500).json({ok:false,error:e.message});
  }
};
