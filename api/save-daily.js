// 매일 장마감 후 데이터 자동 저장 (GitHub API 사용)
// Vercel cron 또는 market-data 호출 시 트리거
const https=require("https");

const GITHUB_TOKEN=process.env.GITHUB_TOKEN;
const REPO="neo9999999999/sector-api";
const BRANCH="main";

async function getFile(path){
  return new Promise((y,n)=>{
    const r=https.request({
      hostname:"api.github.com",path:`/repos/${REPO}/contents/${path}`,
      method:"GET",headers:{"Authorization":`token ${GITHUB_TOKEN}`,"User-Agent":"sector-api","Accept":"application/vnd.github.v3+json"}
    },s=>{let t="";s.on("data",c=>t+=c);s.on("end",()=>{try{y(JSON.parse(t))}catch{n(new Error(t.slice(0,100)))}})});
    r.on("error",n);r.end();
  });
}

async function saveFile(path,content,sha){
  return new Promise((y,n)=>{
    const body=JSON.stringify({message:`daily: ${path}`,content:Buffer.from(content).toString("base64"),branch:BRANCH,...(sha?{sha}:{})});
    const r=https.request({
      hostname:"api.github.com",path:`/repos/${REPO}/contents/${path}`,
      method:"PUT",headers:{"Authorization":`token ${GITHUB_TOKEN}`,"User-Agent":"sector-api","Content-Type":"application/json","Content-Length":Buffer.byteLength(body)}
    },s=>{let t="";s.on("data",c=>t+=c);s.on("end",()=>{try{y(JSON.parse(t))}catch{n(new Error(t.slice(0,100)))}})});
    r.on("error",n);r.write(body);r.end();
  });
}

async function saveDaily(date, payload){
  if(!GITHUB_TOKEN) return {ok:false,error:"no GITHUB_TOKEN"};
  const path=`data/daily/${date}.json`;
  try{
    const existing=await getFile(path).catch(()=>null);
    const sha=existing?.sha||null;
    await saveFile(path,JSON.stringify(payload,null,2),sha);
    return {ok:true,path,date};
  }catch(e){return {ok:false,error:e.message};}
}

function getKSTDate(){
  const d=new Date(new Date().toLocaleString("en-US",{timeZone:"Asia/Seoul"}));
  return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
}
function getKSTHour(){
  const d=new Date(new Date().toLocaleString("en-US",{timeZone:"Asia/Seoul"}));
  return d.getHours()*100+d.getMinutes(); // 1530 = 오후 3:30
}

module.exports={saveDaily,getKSTDate,getKSTHour};
