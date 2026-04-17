const OWNER='neo9999999999';
const REPO='neo-score';
const PATH='data/history.json';
const BRANCH='main';

export default async function handler(req, res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  if(req.method==='OPTIONS') return res.status(200).end();

  const token = process.env.GITHUB_TOKEN;
  if(!token) return res.status(500).json({error:'GITHUB_TOKEN missing'});

  const url = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${PATH}?ref=${BRANCH}`;
  const h = {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'neo-score-history',
    'X-GitHub-Api-Version': '2022-11-28'
  };

  try {
    if(req.method==='GET'){
      const r = await fetch(url, {headers: h});
      if(r.status === 404) return res.status(200).json({history: [], sha: null});
      if(!r.ok) return res.status(r.status).json({error:'fetch failed', status:r.status});
      const d = await r.json();
      const txt = Buffer.from(d.content, 'base64').toString('utf-8');
      return res.status(200).json({history: JSON.parse(txt), sha: d.sha});
    }

    if(req.method === 'POST'){
      const body = req.body || {};
      const history = body.history;
      if(!Array.isArray(history)) return res.status(400).json({error:'history must be array'});

      let sha = body.sha;
      if(!sha){
        const gr = await fetch(url, {headers: h});
        if(gr.ok){ const gd = await gr.json(); sha = gd.sha; }
      }

      const content = Buffer.from(JSON.stringify(history, null, 2)).toString('base64');
      const putBody = {
        message: `Update history (${history.length} items)`,
        content,
        branch: BRANCH,
        ...(sha ? {sha} : {})
      };

      const pr = await fetch(url, {
        method: 'PUT',
        headers: {...h, 'Content-Type': 'application/json'},
        body: JSON.stringify(putBody)
      });
      if(!pr.ok){
        const errTxt = await pr.text();
        return res.status(pr.status).json({error:'PUT failed', detail: errTxt});
      }
      const pd = await pr.json();
      return res.status(200).json({ok: true, sha: pd.content.sha, count: history.length});
    }

    return res.status(405).json({error:'Method not allowed'});
  } catch(e) {
    return res.status(500).json({error: e.message});
  }
}
