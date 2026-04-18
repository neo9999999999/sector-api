// api/stock-master.js — KRX에서 전 종목 코드/이름 가져오기 (서버 사이드 프록시)
const https = require('https');

function request(opts, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(opts, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({status: res.statusCode, body: Buffer.concat(chunks).toString('utf8')}));
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
    // KRX 전종목 기본정보 조회: MDCSTAT01901
    const formBody = new URLSearchParams({
      bld: 'dbms/MDC/STAT/standard/MDCSTAT01901',
      mktId: 'ALL',
      share: '1',
      csvxls_isNo: 'false'
    }).toString();

    const opts = {
      hostname: 'data.krx.co.kr',
      port: 443,
      path: '/comm/bldAttendant/getJsonData.cmd',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'Content-Length': Buffer.byteLength(formBody),
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (compatible; NeoScoreBot/1.0)',
        'Referer': 'http://data.krx.co.kr/contents/MDC/MDI/mdiLoader/index.cmd?menuId=MDC0201020203'
      }
    };

    const r = await request(opts, formBody);
    if (r.status !== 200) {
      return res.status(502).json({ok: false, error: 'KRX upstream failed', status: r.status, bodyPreview: r.body.slice(0, 300)});
    }

    let data;
    try { data = JSON.parse(r.body); }
    catch(e) { return res.status(502).json({ok: false, error: 'parse failed', bodyPreview: r.body.slice(0, 300)}); }

    const rows = data.OutBlock_1 || [];
    const stocks = rows
      .filter(x => x.MKT_TP_NM === 'KOSPI' || x.MKT_TP_NM === 'KOSDAQ')
      .map(x => ({
        code: x.ISU_SRT_CD,         // 단축 종목코드 (6자리)
        name: x.ISU_ABBRV,          // 한글종목약명
        market: x.MKT_TP_NM,        // KOSPI / KOSDAQ
        sector: x.IDX_IND_NM || '',  // 업종
        listed: x.LIST_DD || ''     // 상장일 YYYY/MM/DD
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
