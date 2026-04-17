const https=require("https");

function naverSearch(name){
  return new Promise(function(y,n){
    var url="/api/search/ac?keyword="+encodeURIComponent(name)+"&target=stock";
    var r=https.request({hostname:"m.stock.naver.com",port:443,path:url,method:"GET",headers:{"User-Agent":"Mozilla/5.0"}},function(s){
      var t="";
      s.on("data",function(c){t+=c});
      s.on("end",function(){
        try{
          var d=JSON.parse(t);
          var items=d.stocks||d.result&&d.result.stocks||[];
          if(items.length>0){
            var st=items[0];
            y({code:st.code||st.reutersCode||"",name:st.name||st.stockName||"",market:st.stockExchangeType&&st.stockExchangeType.name||st.marketName||""});
          }else{y(null)}
        }catch(e){
          n(new Error("Parse:"+t.slice(0,200)))
        }
      });
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
        results[name]=data;
      }catch(e){results[name]={error:e.message}}
      if(i<names.length-1)await new Promise(function(r){setTimeout(r,100)});
    }
    res.status(200).json({ok:true,count:Object.keys(results).length,results:results});
  }catch(e){res.status(500).json({error:e.message})}
};
