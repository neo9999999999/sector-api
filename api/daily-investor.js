// api/daily-investor.js v2 — multi-TR with debug mode
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

const FIELD_CANDIDATES = {
  외: ['frgn_ntby_tr_pbmn','frgn_ntby_qty','ntby_frgn_pbmn','frgn_ntby_pbmn','ntby_frgn_qty','frgn_ntby_nmix'],
  기: ['orgn_ntby_tr_pbmn','orgn_ntby_qty','ntby_orgn_pbmn','orgn_ntby_pbmn','ntby_orgn_qty','orgn_ntby_nmix'],
  개: ['prsn_ntby_tr_pbmn','prsn_ntby_qty','ntby_prsn_pbmn','prsn_ntby_pbmn','ntby_prsn_qty','prsn_ntby_nmix']
};

function extract(row, key){
  for (const f of FIELD_CANDIDATES[key]) {
    if (row[f] !== undefined && row[f] !== '') return { field: f, value: +row[f] };
  }
  return { field: null, value: 0 };
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
        ok:false, error:'date not found',
        availableDates: rows.map(r => r.stck_bsop_date).slice(0, 5)
      });
    }

    const fExt = extract(row, '외');
    const kExt = extract(row, '기');
    const pExt = extract(row, '개');

    // 거래대금이면 원 단위 → 억, 수량이면 그대로
    const isAmount = f => /pbmn/.test(f || '');
    const 외 = isAmount(fExt.field) ? Math.round(fExt.value / 1e8) : fExt.value;
    const 기 = isAmount(kExt.field) ? Math.round(kExt.value / 1e8) : kExt.value;
    const 개 = isAmount(pExt.field) ? Math.round(pExt.value / 1e8) : pExt.value;
    const 외기합 = 외 + 기;

    const sign = n => (n >= 0 ? '+' : '') + n;
    const inv_str = '외'+sign(외)+'억/기'+sign(기)+'억/개'+sign(개)+'억';
    const isX = 외기합 >= 50 || 개 <= -50;

    return res.status(200).json({
      ok: true, code, date,
      외, 기, 개, 외기합, inv_str, isX,
      fields_used: { 외: fExt.field, 기: kExt.field, 개: pExt.field },
      is_amount: { 외: isAmount(fExt.field), 기: isAmount(kExt.field), 개: isAmount(pExt.field) },
      source: 'kis-FHKST01010900', version: 'v2'
    });

  } catch(e) {
    return res.status(500).json({ ok:false, error: e.message });
  }
}
