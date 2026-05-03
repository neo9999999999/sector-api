const https=require("https");
const AKEY=process.env.ANTHROPIC_API_KEY||"";
function post(body){return new Promise(function(y,n){var r=https.request({hostname:"api.anthropic.com",port:443,path:"/v1/messages",method:"POST",headers:{"Content-Type":"application/json","x-api-key":AKEY,"anthropic-version":"2023-06-01"}},function(s){var t="";s.on("data",function(c){t+=c});s.on("end",function(){try{y(JSON.parse(t))}catch(e){n(new Error(t.slice(0,500)))}})});r.on("error",n);r.write(JSON.stringify(body));r.end()})}
module.exports=async function(req,res){
  res.setHeader("Access-Control-Allow-Origin","*");
  res.setHeader("Access-Control-Allow-Methods","POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers","*");
  if(req.method==="OPTIONS")return res.status(200).end();
  if(req.method!=="POST")return res.status(405).json({error:"POST only"});
  if(!AKEY)return res.status(500).json({error:"ANTHROPIC_API_KEY not set"});
  try{
    var body=req.body;
    if(!body||!body.messages)return res.status(400).json({error:"messages required"});
    var payload={model:body.model||"claude-haiku-4-5-20251001",max_tokens:body.max_tokens||4000,system:(typeof body.system==="string"&&body.system.length>4000?[{type:"text",text:body.system,cache_control:{type:"ephemeral"}}]:(body.system||"")),messages:body.messages};
    var data=await post(payload);
    res.status(200).json(data);
  }catch(e){res.status(500).json({error:e.message})}
};
module.exports.config={api:{bodyParser:{sizeLimit:"4mb"}}};