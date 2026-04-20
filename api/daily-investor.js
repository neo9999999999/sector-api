// api/daily-investor.js v3 — correct unit conversion (백만원 → 억원)
async function getToken(k,s){
  const cached = globalThis.__kisTok;
  if (cached && Date.now() - cached.at < 23*3600*1000) return cached.token;
  const r = await fetch('https://openapi.koreainvestment.com:9443/oauth2/tokenP', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({grant_type:'client_credentials', appkey:k, appsecret:s})
  });
  const j = await r.json();
  if (!j.access_token) throw new Error('token fail: '+(j.msg1||JSON.stringify(j).slice(0,150)));
  globalThis.__kisTok = { token: j.access_token, at: Date.now() };
  return j.access_token;
}

export default async function handler(req, res) {
  try {
    res.setHeader('Access-Control-Allow-Origin','*');
    const { code, date, debug } = req.query;
    if (!code || !date) return res.status(400).json({ ok:false, error:'code and date required' });

    const APP_KEY = process.env.KIS_APP_KEY;
    const APP_SECRET = process.env.KIS_APP_SECRET;
    if (!APP_KEY || !APP_SECRET) return res.status(500).json({ ok:false, error:'KIS credentials missing' });

    const token = await getToken(APP_KEY, APP_SECRET);

    const url = 'https://openapi.koreainvestment.com:9443/uapi/domestic-stock/v1/quotations/inquire-investor'
      + '?FID_COND_MRKT_DIV_CODE=J&FID_INPUT_ISCD=' + code;

    const kr = await fetch(url, {
      headers: {
        'Content-Type':'application/json; charset=utf-8',
        'Authorization':'Bearer ' + token,
        'appkey': APP_KEY, 'appsecret': APP_SECRET,
        'tr_id': 'FHKST01010900'
      }
    });

    const kd = await kr.json();
    if (kd.rt_cd !== '0') {
      return res.status(502).json({ ok:false, error:'KIS '+kd.msg_cd+' '+kd.msg1 });
    }

    const rows = kd.output || [];
    const row = rows.find(r => r.stck_bsop_date === date);

    if (debug === '1') {
      return res.status(200).json({
        ok:true, debug:true,
        rowCount: rows.length,
        firstRow: rows[0] || null,
        firstRowKeys: rows[0] ? Object.keys(rows[0]) : [],
        targetRow: row,
        availableDates: rows.map(r => r.stck_bsop_date).slice(0, 10)
      });
    }

    if (!row) {
      return res.status(404).json({
        ok:false, error:'date not in 30-day window',
        availableDates: rows.map(r => r.stck_bsop_date).slice(0, 5)
      });
    }

    // KIS 반환은 '백만원' 단위 → 억원으로 환산 (÷100)
    const 외 = Math.round(+(row.frgn_ntby_tr_pbmn || 0) / 100);
    const 기 = Math.round(+(row.orgn_ntby_tr_pbmn || 0) / 100);
    const 개 = Math.round(+(row.prsn_ntby_tr_pbmn || 0) / 100);
    const 외기합 = 외 + 기;

    const sign = n => (n >= 0 ? '+' : '') + n;
    const inv_str = '외'+sign(외)+'억/기'+sign(기)+'억/개'+sign(개)+'억';
    const isX = 외기합 >= 50 || 개 <= -50;

    return res.status(200).json({
      ok: true, code, date,
      외, 기, 개, 외기합, inv_str, isX,
      source: 'kis-FHKST01010900', version: 'v3',
      unit: '억원 (from 백만원)'
    });

  } catch(e) {
    return res.status(500).json({ ok:false, error: e.message });
  }
}
