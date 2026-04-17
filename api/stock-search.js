const https=require("https");

function naverSearch(name){
  return new Promise(function(y,n){
    var url="/ac?q="+encodeURIComponent(name)+"&q_enc=utf-8&st=111&frm=stock&r_format=json&t_koreng=1&r_lt=111";
    var r=https.request({hostname:"ac.finance.naver.com",port:443,path:url,method:"GET"},function(s){
      var t="";
      s.on("data",function(c){t+=c});
      s.on("end",function(){try{y(JSON.parse(t))}catch(e){n(new Error(t.slice(0,300)))}});
    });
    r.on("error",n);
    r.end();
  });
}

module.exports=async function(req,res){
  res.setHeader("Access-Control-Allow-Origin","*");
  res.setHeader("Access-Control-Allow-Methods","GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers","*");
  if(req.method==="OPTIONS")return res.status(200).end();
  try{
    var names=req.query.names?req.query.names.split(","):req.body&&req.body.names?req.body.names:[];
    if(req.query.name)names=[req.query.name];
    if(names.length===0)return res.status(400).json({error:"name or names required"});
    var results={};
    for(var i=0;i<names.length;i++){
      var name=names[i].trim();
      if(!name)continue;
      try{
        var data=await naverSearch(name);
        var items=data&&data.items&&data.items[0]?data.items[0]:[];
        if(items.length>0&&items[0].length>0){
          results[name]={code:items[0][0],name:items[0][1],market:items[0][2]};
        }else{results[name]=null}
      }catch(e){results[name]={error:e.message}}
      if(i<names.length-1)await new Promise(function(r){setTimeout(r,100)});
    }
    res.status(200).json({ok:true,count:Object.keys(results).length,results:results});
  }catch(e){res.status(500).json({error:e.message})}
};