// api/daily-investor.js
// 특정 종목+날짜의 투자자별 순매수 금액 조회
// KIS API: 종목별 외국인 기관 추정가집계 (FHPST01060000) + 개인 추출
// Usage: GET /api/daily-investor?code=005930&date=20260115
// Response: { ok:true, code, date, 외, 기, 개, 외기합, inv_str, isX, source }

async function getToken(k,s){
  const cached = globalThis.__kisTok;
  if (cached && Date.now() - cached.at < 23*3600*1000) return cached.token;
  const r = await fetch('https://openapi.koreainvestment.com:9443/oauth2/tokenP', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({grant_type:'client_credentials', appkey:k, appsecret:s})
  });
  const j = await r.json();
  if (!j.access_token) throw new Error('token fail: '+(j.msg1||JSON.stringify(j).slice(0,100)));
  globalThis.__kisTok = { token: j.access_token, at: Date.now() };
  return j.access_token;
}

export default async function handler(req, res) {
  try {
    res.setHeader('Access-Control-Allow-Origin','*');
    const { code, date } = req.query;
    if (!code || !date) return res.status(400).json({ ok:false, error:'code and date required' });

    const APP_KEY = process.env.KIS_APP_KEY;
    const APP_SECRET = process.env.KIS_APP_SECRET;
    if (!APP_KEY || !APP_SECRET) return res.status(500).json({ ok:false, error:'KIS credentials missing' });

    const token = await getToken(APP_KEY, APP_SECRET);

    // KIS: 종목별 투자자 순매수 (FHKST03010900 — 일자별)
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
      return res.status(502).json({ ok:false, error:'KIS '+kd.msg_cd+' '+kd.msg1, tried:'inquire-investor' });
    }

    // output: 일자별 리스트 (최근 30일)
    const rows = kd.output || [];
    const row = rows.find(r => r.stck_bsop_date === date);
    if (!row) {
      return res.status(404).json({
        ok:false, error:'date not in 30-day window',
        availableDates: rows.map(r=>r.stck_bsop_date).slice(0,5),
        hint:'use a recent date within 30 days'
      });
    }

    // 순매수 거래대금: 원 단위 → 억원 (소수점 1자리)
    const 외원 = +(row.frgn_ntby_tr_pbmn || 0);
    const 기원 = +(row.orgn_ntby_tr_pbmn || 0);
    const 개원 = +(row.prsn_ntby_tr_pbmn || 0);
    const 외 = Math.round(외원 / 1e8);
    const 기 = Math.round(기원 / 1e8);
    const 개 = Math.round(개원 / 1e8);
    const 외기합 = 외 + 기;

    const sign = n => (n>=0?'+':'') + n;
    const inv_str = '외'+sign(외)+'억/기'+sign(기)+'억/개'+sign(개)+'억';
    const isX = 외기합 >= 50 || 개 <= -50;

    return res.status(200).json({
      ok:true, code, date, 외, 기, 개, 외기합, inv_str, isX,
      source:'kis-inquire-investor', version:'v1'
    });

  } catch(e) {
    return res.status(500).json({ ok:false, error: e.message });
  }
}
