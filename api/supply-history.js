// api/supply-history.js — 네이버 금융 외국인/기관 순매수 과거 조회 (euc-kr 처리)
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  
  const code = req.query.code;
  const pages = Math.min(parseInt(req.query.pages) || 5, 30);
  if (!code) return res.status(400).json({ ok: false, error: 'code required' });
  
  async function getPage(p) {
    const url = `https://finance.naver.com/item/frgn.naver?code=${code}&page=${p}`;
    const r = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'Accept': 'text/html,application/xhtml+xml',
        'Referer': 'https://finance.naver.com/'
      }
    });
    if (!r.ok) throw new Error('fetch failed ' + r.status);
    const buf = await r.arrayBuffer();
    const decoder = new TextDecoder('euc-kr');
    return decoder.decode(buf);
  }
  
  function parseHtml(html) {
    const rows = [];
    const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
    let m;
    while ((m = trRe.exec(html))) {
      const tr = m[1];
      const tds = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(x => 
        x[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim()
      );
      if (tds.length >= 8 && /\d{4}\.\d{2}\.\d{2}/.test(tds[0])) {
        const frgnRaw = tds[6].replace(/[,\s]/g, '');
        const orgnRaw = tds[7].replace(/[,\s]/g, '');
        rows.push({
          date: tds[0].replace(/\./g, ''),
          close: parseInt(tds[1].replace(/,/g, '')) || 0,
          frgn_net: parseInt(frgnRaw) || 0,
          orgn_net: parseInt(orgnRaw) || 0
        });
      }
    }
    return rows;
  }
  
  try {
    const allRows = [];
    for (let p = 1; p <= pages; p++) {
      const html = await getPage(p);
      const rows = parseHtml(html);
      if (rows.length === 0) break;
      allRows.push(...rows);
      if (rows.length < 10) break;
    }
    res.json({ ok: true, code, count: allRows.length, rows: allRows });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
};
