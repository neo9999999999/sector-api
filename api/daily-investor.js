// api/daily-investor.js — 네이버 금융 외국인/기관 순매수 (debug 모드 지원)
// /api/daily-investor?code=000660&pages=5
// /api/daily-investor?code=000660&pages=1&debug=1  ← raw td 배열 반환
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  
  const code = req.query.code;
  const pages = Math.min(parseInt(req.query.pages) || 5, 30);
  const debug = req.query.debug === '1';
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
  
  function parseHtml(html, debugMode) {
    const rows = [];
    const debugRows = [];
    const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
    let m;
    while ((m = trRe.exec(html))) {
      const tr = m[1];
      const tds = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(x => 
        x[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim()
      );
      if (tds.length >= 8 && /\d{4}\.\d{2}\.\d{2}/.test(tds[0])) {
        if (debugMode && debugRows.length < 3) {
          debugRows.push(tds);
        }
        // 네이버 frgn: [0]날짜 [1]종가 [2]전일비 [3]등락률 [4]거래량 [5]외인보유주수 [6]외인보유율 [7]외국인순매수 [8]기관순매수
        const num = (s) => parseInt((s||'').replace(/[,\s+]/g, '')) || 0;
        rows.push({
          date: tds[0].replace(/\./g, ''),
          close: num(tds[1]),
          change: num(tds[2]),
          change_pct: tds[3],
          volume: num(tds[4]),
          frgn_hold_qty: num(tds[5]),
          frgn_hold_pct: tds[6],
          frgn_net: num(tds[7]),
          orgn_net: num(tds[8])
        });
      }
    }
    return { rows, debugRows };
  }
  
  try {
    const allRows = [];
    let firstDebug = null;
    for (let p = 1; p <= pages; p++) {
      const html = await getPage(p);
      const { rows, debugRows } = parseHtml(html, debug && p === 1);
      if (p === 1 && debug) firstDebug = debugRows;
      if (rows.length === 0) break;
      allRows.push(...rows);
      if (rows.length < 10) break;
    }
    if (debug) {
      res.json({ ok: true, code, count: allRows.length, debug_rows: firstDebug, rows: allRows.slice(0, 5) });
    } else {
      res.json({ ok: true, code, count: allRows.length, rows: allRows });
    }
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
};
