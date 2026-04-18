// api/save-stocks.js — 종목 마스터를 neo-score repo에 저장
const https = require('https');

function req(opts, body) {
  return new Promise((resolve, reject) => {
    const r = https.request(opts, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8')}));
    });
    r.on('error', reject);
    if (body) r.write(body);
    r.end();
  });
}

module.exports = async (q, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (q.method === 'OPTIONS') return res.status(200).end();

  const token = process.env.GITHUB_TOKEN;
  if (!token) return res.status(500).json({ok:false, error:'GITHUB_TOKEN missing'});

  try {
    // 1. 내부적으로 stock-master 호출
    const selfHost = q.headers['x-forwarded-host'] || q.headers.host || 'sector-api-pink.vercel.app';
    const masterResp = await req({
      hostname: selfHost,
      port: 443,
      path: '/api/stock-master',
      method: 'GET',
      headers: {'Accept': 'application/json'}
    });
    if (masterResp.status !== 200) {
      return res.status(502).json({ok:false, error:'stock-master failed', status:masterResp.status});
    }
    const d = JSON.parse(masterResp.body);
    if (!d.ok) return res.status(502).json({ok:false, error:'stock-master not ok', detail:d});

    const isEtp = n => /ETN|ETF|선물|인버스|레버리지|2X|KODEX|TIGER|HANARO|PLUS|KBSTAR|KOSEF|SOL|ACE|ARIRANG|RISE|TIMEFOLIO/i.test(n);
    const real = d.stocks.filter(s => !isEtp(s.name));
    const output = {
      fetched_at: d.fetched_at,
      source: 'naver-finance sise_market_sum',
      filter: 'ETF/ETN/선물/인버스/레버리지 excluded',
      total: real.length,
      kospi: real.filter(s=>s.market==='KOSPI').length,
      kosdaq: real.filter(s=>s.market==='KOSDAQ').length,
      stocks: real
    };
    const jsonStr = JSON.stringify(output, null, 2);
    const content64 = Buffer.from(jsonStr).toString('base64');

    // 2. 기존 파일 sha 확인
    const repoPath = '/repos/neo9999999999/neo-score/contents/data/stocks.json';
    const ghHeaders = {
      'Authorization': 'Bearer ' + token,
      'Accept': 'application/vnd.github+json',
      'User-Agent': 'neo-score-saver',
      'X-GitHub-Api-Version': '2022-11-28'
    };

    let sha = null;
    const getResp = await req({
      hostname: 'api.github.com',
      port: 443,
      path: repoPath + '?ref=main',
      method: 'GET',
      headers: ghHeaders
    });
    if (getResp.status === 200) {
      try { sha = JSON.parse(getResp.body).sha; } catch(_){}
    }

    // 3. PUT
    const putBody = JSON.stringify({
      message: 'Update data/stocks.json (' + real.length + ' stocks from NAVER)',
      content: content64,
      branch: 'main',
      ...(sha ? {sha} : {})
    });
    const putResp = await req({
      hostname: 'api.github.com',
      port: 443,
      path: repoPath,
      method: 'PUT',
      headers: {...ghHeaders, 'Content-Type':'application/json', 'Content-Length': Buffer.byteLength(putBody)}
    }, putBody);

    if (putResp.status !== 200 && putResp.status !== 201) {
      return res.status(putResp.status).json({ok:false, error:'PUT failed', status:putResp.status, body:putResp.body.slice(0,500)});
    }

    const pd = JSON.parse(putResp.body);
    return res.status(200).json({
      ok: true,
      committed: true,
      sha: pd.content.sha,
      total: real.length,
      kospi: output.kospi,
      kosdaq: output.kosdaq,
      url: pd.content.html_url
    });
  } catch(e) {
    return res.status(500).json({ok:false, error:e.message, stack:e.stack});
  }
};
