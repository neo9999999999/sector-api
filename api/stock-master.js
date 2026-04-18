// api/stock-master.js — KRX 전종목 리스트 (세션 2단계 호출)
const https = require('https');

function request(opts, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(opts, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks).toString('utf8')
      }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // 1단계: 세션 쿠키 확보 (KRX 페이지 GET)
    const warmup = await request({
      hostname: 'data.krx.co.kr',
      port: 443,
      path: '/contents/MDC/MDI/mdiLoader/index.cmd?menuId=MDC0201020203',
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8'
      }
    });

    const setCookie = warmup.headers['set-cookie'] || [];
    const cookieStr = setCookie.map(c => c.split(';')[0]).join('; ');

    // 2단계: POST getJsonData.cmd
    const formBody = new URLSearchParams({
      bld: 'dbms/MDC/STAT/standard/MDCSTAT01901',
      mktId: 'ALL',
      share: '1',
      csvxls_isNo: 'false'
    }).toString();

    const r = await request({
      hostname: 'data.krx.co.kr',
      port: 443,
      path: '/comm/bldAttendant/getJsonData.cmd',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'Content-Length': Buffer.byteLength(formBody),
        'Accept': 'application/json, text/javascript, */*; q=0.01',
        'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'http://data.krx.co.kr/contents/MDC/MDI/mdiLoader/index.cmd?menuId=MDC0201020203',
        'Origin': 'http://data.krx.co.kr',
        'X-Requested-With': 'XMLHttpRequest',
        'Cookie': cookieStr
      }
    }, formBody);

    if (r.status !== 200) {
      return res.status(502).json({
        ok: false,
        error: 'KRX upstream failed',
        status: r.status,
        bodyPreview: r.body.slice(0, 300),
        cookieStr: cookieStr.slice(0, 200)
      });
    }

    let data;
    try { data = JSON.parse(r.body); }
    catch(e) {
      return res.status(502).json({ok: false, error: 'parse failed', bodyPreview: r.body.slice(0, 300)});
    }

    const rows = data.OutBlock_1 || [];
    const stocks = rows
      .filter(x => x.MKT_TP_NM === 'KOSPI' || x.MKT_TP_NM === 'KOSDAQ')
      .map(x => ({
        code: x.ISU_SRT_CD,
        name: x.ISU_ABBRV,
        market: x.MKT_TP_NM,
        sector: x.IDX_IND_NM || '',
        listed: x.LIST_DD || ''
      }))
      .filter(x => x.code && /^\d{6}$/.test(x.code));

    const kospi = stocks.filter(s => s.market === 'KOSPI').length;
    const kosdaq = stocks.filter(s => s.market === 'KOSDAQ').length;

    return res.status(200).json({
      ok: true,
      fetched_at: new Date().toISOString(),
      total: stocks.length,
      kospi,
      kosdaq,
      stocks
    });
  } catch (e) {
    return res.status(500).json({ok: false, error: e.message, stack: e.stack});
  }
};
