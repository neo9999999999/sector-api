const https=require("https");
const AK=process.env.KIS_APP_KEY;
const AS=process.env.KIS_APP_SECRET;
const GITHUB_TOKEN=process.env.GITHUB_TOKEN;
const H="openapi.koreainvestment.com",P=9443;
const GH_OWNER="neo9999999999",GH_REPO="sector-api",SIGNALS_PATH="data/signals.json";
let _tk=null,_te=0;

function rq(m,p,h,b){return new Promise(function(y,n){var r=https.request({hostname:H,port:P,path:p,method:m,headers:Object.assign({},h,{"Content-Type":"application/json"})},function(s){var t="";s.on("data",function(c){t+=c});s.on("end",function(){try{y(JSON.parse(t))}catch(e){n(new Error(t.slice(0,200)))}})});r.on("error",n);if(b)r.write(JSON.stringify(b));r.end()})}
function rqGH(m,path,body){return new Promise(function(y,n){var d=body?JSON.stringify(body):null;var r=https.request({hostname:"api.github.com",path:path,method:m,headers:{"Authorization":"token "+GITHUB_TOKEN,"Content-Type":"application/json","User-Agent":"neo-score","Content-Length":d?Buffer.byteLength(d):0}},function(s){var t="";s.on("data",function(c){t+=c});s.on("end",function(){try{y(JSON.parse(t))}catch(e){y({_raw:t.slice(0,200)})}})});r.on("error",n);if(d)r.write(d);r.end()})}
async function tok(){if(_tk&&Date.now()<_te)return _tk;var r=await rq("POST","/oauth2/tokenP",{},{grant_type:"client_credentials",appkey:AK,appsecret:AS});if(!r.access_token)throw new Error("Tok:"+JSON.stringify(r).slice(0,200));_tk=r.access_token;_te=Date.now()+86300000;return _tk}
function w(ms){return new Promise(function(r){setTimeout(r,ms)})}
function ps(s){var c=s.mksc_shrn_iscd||s.stck_shrn_iscd||"";return{code:c,name:s.hts_kor_isnm||"",price:+s.stck_prpr||0,change:+(s.prdy_ctrt||0),vol:+s.acml_vol||0,amt:Math.round((+s.acml_tr_pbmn||0)/1e8),open:+s.stck_oprc||0,high:+s.stck_hgpr||0,low:+s.stck_lwpr||0,market:"UNKNOWN"}}
async function pages(tk,path,trId,params,n){var all=[],errs=[];for(var i=0;i<n;i++){try{var h={authorization:"Bearer "+tk,appkey:AK,appsecret:AS,tr_id:trId,custtype:"P"};if(i>0)h.tr_cont="N";var r=await rq("GET",path+"?"+new URLSearchParams(params).toString(),h);if(r.rt_cd!=="0"){errs.push(r.msg1||r.msg_cd);break}var items=(r.output||[]).map(ps);if(!items.length)break;all=all.concat(items);await w(250)}catch(e){errs.push(e.message);break}}return{items:all,errs:errs}}
function score(s){var sc=0;var inv=s.inst>0&&s.frgn>0?"both":s.frgn>0?"frgn":s.inst>0?"inst":"none";if(inv==="both")sc+=3;else if(inv==="frgn")sc+=2;var wk=s.high>0&&s.price>0?(s.high-s.price)/s.price*100:0;if(wk<=0.5)sc+=2;else if(wk<=2)sc+=1;else if(wk>=7)sc-=1;if(s.amt>0&&s.amt<200)sc+=2;else if(s.amt<500)sc+=1;else if(s.amt>=1500)sc-=1;if(s.change>=25)sc+=2;else if(s.change>=20)sc+=1;if(s.market==="KOSDAQ")sc+=1;var etf=["KODEX","TIGER","RISE","ACE","SOL","KIWOOM","KOSEF","HANARO","ETN"].some(function(k){return(s.name||"").indexOf(k)>=0});if(etf)sc-=3;if(s.change>0&&s.change<=13)sc+=2;if(s.change>=15)sc-=1;sc=Math.max(sc,0);var g=sc>=9?"S":sc>=7?"A":sc>=5?"B":"X";var invL=inv==="both"?"기+외":inv==="frgn"?"외인":inv==="inst"?"기관":"없음";return{code:s.code,name:s.name,price:s.price,change:s.change,amount:s.amt,market:s.market,open:s.open,high:s.high,low:s.low,volume:s.vol,score:sc,grade:g,tp1:g==="B"?12:15,tp2:50,sl:13,investor:invL,wick:Math.round(wk*10)/10,etf:etf,inst:s.inst,frgn:s.frgn}}

// GitHub에 신호 저장
async function saveSignals(signals,today){
  if(!GITHUB_TOKEN||!signals.length)return{saved:false,reason:"no token or no signals"};
  try{
    var existing={signals:[],sha:null};
    var r=await rqGH("GET","/repos/"+GH_OWNER+"/"+GH_REPO+"/contents/"+SIGNALS_PATH);
    if(r.content){existing.signals=JSON.parse(Buffer.from(r.content,"base64").toString());existing.sha=r.sha;}
    var existingKeys=new Set(existing.signals.map(function(s){return s.code+"_"+s.signal_date;}));
    var added=0;
    signals.filter(function(s){return s.grade!=="X";}).forEach(function(s){
      var key=s.code+"_"+today;
      if(!existingKeys.has(key)){
        existing.signals.unshift({id:Date.now()+"_"+s.code,code:s.code,name:s.name,signal_date:today,
          entry_price:s.price,rate:s.change,score:s.score,grade:s.grade,supply:s.investor,
          wick:s.wick,vol:s.amount,market:s.market,tp1:s.tp1,tp2:s.tp2,sl:s.sl,outcome:null,
          saved_at:new Date(Date.now()+9*3600000).toISOString().replace("T"," ").slice(0,16)});
        existingKeys.add(key);added++;
      }
    });
    if(!added)return{saved:false,reason:"all duplicates"};
    var content=Buffer.from(JSON.stringify(existing.signals,null,2)).toString("base64");
    var pr=await rqGH("PUT","/repos/"+GH_OWNER+"/"+GH_REPO+"/contents/"+SIGNALS_PATH,
      {message:"signals "+today,content:content,...(existing.sha?{sha:existing.sha}:{})});
    return{saved:true,added:added,total:existing.signals.length};
  }catch(e){return{saved:false,reason:e.message};}
}

module.exports=async function(req,res){
  res.setHeader("Access-Control-Allow-Origin","*");
  res.setHeader("Access-Control-Allow-Methods","GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers","*");
  if(req.method==="OPTIONS")return res.status(200).end();
  try{
    if(!AK||!AS)return res.status(500).json({ok:false,error:"KIS_APP_KEY / KIS_APP_SECRET 없음"});
    var tk=await tok();
    var vp={FID_INPUT_ISCD:"0000",FID_RANK_SORT_CLS_CODE:"0",FID_COND_SCR_DIV_CODE:"20171",FID_DIV_CLS_CODE:"0",FID_BLNG_CLS_CODE:"0",FID_TRGT_CLS_CODE:"111111111",FID_TRGT_EXLS_CLS_CODE:"000000",FID_INPUT_PRICE_1:"",FID_INPUT_PRICE_2:"",FID_VOL_CNT:"",FID_INPUT_DATE_1:""};
    var gp={FID_COND_MRKT_DIV_CODE:"J",FID_COND_SCR_DIV_CODE:"20170",FID_INPUT_ISCD:"0000",FID_RANK_SORT_CLS_CODE:"0",FID_INPUT_CNT_1:"0",FID_PRC_CLS_CODE:"0",FID_INPUT_PRICE_1:"",FID_INPUT_PRICE_2:"",FID_VOL_CNT:"",FID_TRGT_CLS_CODE:"0",FID_TRGT_EXLS_CLS_CODE:"0",FID_DIV_CLS_CODE:"0",FID_RSFL_RATE1:"",FID_RSFL_RATE2:""};
    var v=await pages(tk,"/uapi/domestic-stock/v1/quotations/volume-rank","FHPST01710000",Object.assign({},vp,{FID_COND_MRKT_DIV_CODE:"J"}),7);
    var g=await pages(tk,"/uapi/domestic-stock/v1/ranking/fluctuation","FHPST01700000",gp,3);
    var seen={},all=[];
    v.items.concat(g.items).forEach(function(s){if(!s.code||seen[s.code])return;seen[s.code]=1;if(s.change>=10&&s.change<29&&s.amt>=50&&s.price>=1000)all.push(s)});
    var mktCnt={kospi:0,kosdaq:0,unknown:0};
    for(var i=0;i<Math.min(all.length,20);i++){
      await w(200);
      try{var r=await rq("GET","/uapi/domestic-stock/v1/quotations/inquire-price?"+new URLSearchParams({FID_COND_MRKT_DIV_CODE:"J",FID_INPUT_ISCD:all[i].code}).toString(),{authorization:"Bearer "+tk,appkey:AK,appsecret:AS,tr_id:"FHKST01010100",custtype:"P"});
        if(r.output){var mn=(r.output.rprs_mrkt_kor_name||"").toUpperCase();if(mn.indexOf("KOSDAQ")>=0){all[i].market="KOSDAQ";mktCnt.kosdaq++}else if(mn.indexOf("KOSPI")>=0||mn.indexOf("KRX")>=0){all[i].market="KOSPI";mktCnt.kospi++}else{all[i].market="KOSPI";mktCnt.unknown++}all[i].frgn=+(r.output.frgn_ntby_qty||0);all[i].inst=+(r.output.pgtr_ntby_qty||0);}}catch(e){}
    }
    var scored=all.map(score).filter(function(s){return!s.etf});
    scored.sort(function(a,b){return b.score-a.score});
    var kst=new Date(Date.now()+9*3600000);
    var today=kst.toISOString().slice(0,10).replace(/-/g,"");

    // 장중/장마감 신호 자동저장 (GITHUB_TOKEN 있을 때)
    var saveResult=null;
    if(GITHUB_TOKEN&&scored.filter(function(s){return s.grade!=="X";}).length>0){
      saveResult=await saveSignals(scored,today);
    }

    res.status(200).json({
      ok:true,date:kst.toISOString().slice(0,10),time:kst.toISOString().slice(11,16),
      summary:{total:scored.length,S:scored.filter(function(s){return s.grade==="S";}).length,A:scored.filter(function(s){return s.grade==="A";}).length,B:scored.filter(function(s){return s.grade==="B";}).length,X:scored.filter(function(s){return s.grade==="X";}).length},
      signals:{S:scored.filter(function(s){return s.grade==="S";}),A:scored.filter(function(s){return s.grade==="A";}),B:scored.filter(function(s){return s.grade==="B";}),X:scored.filter(function(s){return s.grade==="X";})},
      all:scored,
      auto_saved:saveResult,
      debug:{vol:v.items.length,gain:g.items.length,kospi:mktCnt.kospi,kosdaq:mktCnt.kosdaq,filtered:all.length,errors:v.errs.concat(g.errs)}
    });
  }catch(e){res.status(500).json({ok:false,error:e.message})}
};
