const https=require("https");
var KEY=process.env.KIS_APP_KEY||"",SECRET=process.env.KIS_APP_SECRET||"",TOKEN="",TEXP=0;
function kisGet(path,trId,params){return new Promise(function(y,n){var qs=Object.entries(params).map(function(e){return e[0]+"="+e[1]}).join("&");var r=https.request({hostname:"openapi.koreainvestment.com",port:443,path:path+"?"+qs,method:"GET",headers:{"Content-Type":"application/json; charset=utf-8","authorization":"Bearer "+TOKEN,"appkey":KEY,"appsecret":SECRET,"tr_id":trId}},function(s){var t="";s.on("data",function(c){t+=c});s.on("end",function(){try{y(JSON.parse(t))}catch(e){n(new Error(t.slice(0,500)))}})});r.on("error",n);r.end()})}
function getToken(){return new Promise(function(y,n){if(TOKEN&&Date.now()<TEXP)return y(TOKEN);var b=JSON.stringify({grant_type:"client_credentials",appkey:KEY,appsecret:SECRET});var r=https.request({hostname:"openapi.koreainvestment.com",port:443,path:"/oauth2/tokenP",method:"POST",headers:{"Content-Type":"application/json"}},function(s){var t="";s.on("data",function(c){t+=c});s.on("end",function(){try{var j=JSON.parse(t);TOKEN=j.access_token;TEXP=Date.now()+3500000;y(TOKEN)}catch(e){n(new Error(t.slice(0,300)))}})});r.on("error",n);r.write(b);r.end()})}
module.exports=async function(req,res){
  res.setHeader("Access-Control-Allow-Origin","*");
  res.setHeader("Access-Control-Allow-Methods","GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers","*");
  if(req.method==="OPTIONS")return res.status(200).end();
  if(!KEY)return res.status(500).json({error:"KIS keys not set"});
  try{await getToken();var code=req.query.code,sd=req.query.startDate||"20200101",ed=req.query.endDate||new Date().toISOString().slice(0,10).replace(/-/g,"");
    if(!code)return res.status(400).json({error:"code required"});
    var data=await kisGet("/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice","FHKST03010100",{FID_COND_MRKT_DIV_CODE:"J",FID_INPUT_ISCD:code,FID_INPUT_DATE_1:sd,FID_INPUT_DATE_2:ed,FID_PERIOD_DIV_CODE:"D",FID_ORG_ADJ_PRC:"0"});
    if(data.output2&&data.output2.length>0){var prices=data.output2.filter(function(p){return p.stck_bsop_date}).map(function(p){return{date:p.stck_bsop_date,close:parseInt(p.stck_clpr)||0,change:parseFloat(p.prdy_ctrt)||0}});
      res.status(200).json({ok:true,code:code,count:prices.length,prices:prices});
    }else{res.status(200).json({ok:false,code:code,error:"No data",msg:data.msg1||""})}
  }catch(e){res.status(500).json({error:e.message})}
};