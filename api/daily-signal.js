// api/daily-signal.js
// 매일 14:55 KST cron — KIS 등락률 상위 → 거래대금 50억+ → NEO 4+ → src/data.js R_26 array 에 append
const https = require('https');

// ═══ Config ═══════════════════════════════════════════════════
const KIS_HOST = 'openapi.koreainvestment.com';
const KIS_PORT = 9443;
const MIN_CHANGE = 10;
const MIN_AMOUNT = 50 * 100000000;
const MIN_NEO = 4;
const KIS_BATCH = 10;
const KIS_GAP_MS = 600;

const GH_OWNER = 'neo9999999999';
const GH_REPO = 'neo-score';
const GH_PATH = 'src/data.js';
const GH_BRANCH = 'main';

// ═══ HTTPS ═══════════════════════════════════════════════════
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

function httpsRequest(opts, body) {
  return new Promise(function (resolve, reject) {
    const req = https.request(opts, function (res) {
      const chunks = [];
      res.on('data', function (c) { chunks.push(c); });
      res.on('end', function () {
        const buf = Buffer.concat(chunks);
        const raw = buf.toString('utf8');
        let parsed = null;
        try { parsed = raw ? JSON.parse(raw) : null; } catch (_) { /* not JSON */ }
        resolve({ status: res.statusCode, data: parsed, raw: raw, buf: buf });
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// ═══ KIS Token ═══════════════════════════════════════════════
let _tokenCache = { token: null, expiresAt: 0 };

async function getKisToken() {
  if (_tokenCache.token && Date.now() < _tokenCache.expiresAt) return _tokenCache.token;
  const body = JSON.stringify({
    grant_type: 'client_credentials',
    appkey: process.env.KIS_APP_KEY,
    appsecret: process.env.KIS_APP_SECRET
  });
  const r = await httpsRequest({
    hostname: KIS_HOST, port: KIS_PORT, path: '/oauth2/tokenP',
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
  }, body);
  if (!r.data || !r.data.access_token) {
    throw new Error('KIS token fail: ' + (r.raw || '').slice(0, 200));
  }
  _tokenCache = { token: r.data.access_token, expiresAt: Date.now() + 23 * 3600 * 1000 };
  return r.data.access_token;
}

async function kisGet(path, trId, params, token) {
  const qs = Object.keys(params).map(function (k) {
    return k + '=' + encodeURIComponent(params[k]);
  }).join('&');
  const r = await httpsRequest({
    hostname: KIS_HOST, port: KIS_PORT, path: path + '?' + qs,
    method: 'GET',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'authorization': 'Bearer ' + token,
      'appkey': process.env.KIS_APP_KEY,
      'appsecret': process.env.KIS_APP_SECRET,
      'tr_id': trId,
      'custtype': 'P'
    }
  });
  return r.data;
}

async function getFluctuationRising(market, token) {
  const data = await kisGet(
    '/uapi/domestic-stock/v1/quotations/fluctuation',
    'FHPST01700000',
    {
      FID_COND_MRKT_DIV_CODE: market,
      FID_COND_SCR_DIV_CODE: '20170',
      FID_INPUT_ISCD: '0000',
      FID_RANK_SORT_CLS_CODE: '0',
      FID_INPUT_CNT_1: '0',
      FID_PRC_CLS_CODE: '0',
      FID_INPUT_PRICE_1: '',
      FID_INPUT_PRICE_2: '',
      FID_VOL_CNT: '',
      FID_TRGT_CLS_CODE: '0',
      FID_TRGT_EXLS_CLS_CODE: '0',
      FID_DIV_CLS_CODE: '0',
      FID_RSFL_RATE1: '',
      FID_RSFL_RATE2: ''
    },
    token
  );
  const out = (data && data.output) || [];
  return out.map(function (r) {
    return {
      code: r.stck_shrn_iscd,
      name: r.hts_kor_isnm,
      market: market === 'J' ? 'KS' : 'KQ',
      change: parseFloat(r.prdy_ctrt) || 0
    };
  });
}

async function getStockSnapshot(code, token) {
  const data = await kisGet(
    '/uapi/domestic-stock/v1/quotations/inquire-price',
    'FHKST01010100',
    { FID_COND_MRKT_DIV_CODE: 'J', FID_INPUT_ISCD: code },
    token
  );
  const o = (data && data.output) || {};
  const open = parseFloat(o.stck_oprc) || 0;
  const high = parseFloat(o.stck_hgpr) || 0;
  const close = parseFloat(o.stck_prpr) || 0;
  const change = parseFloat(o.prdy_ctrt) || 0;
  const amount = parseFloat(o.acml_tr_pbmn) || 0;
  const frgn = parseFloat(o.frgn_ntby_qty) || 0;
  const prgm = parseFloat(o.pgtr_ntby_qty) || 0;
  const wick = open > 0 ? Math.max(0, (high - close) / open * 100) : 0;
  let investor = '개인';
  if (frgn > 0 && prgm > 0) investor = '기+외';
  else if (frgn > 0) investor = '외인';
  else if (prgm > 0) investor = '기관';
  return {
    price: close, change: change, amount: amount,
    amountEok: Math.round(amount / 100000000),
    wick: +wick.toFixed(2),
    investor: investor
  };
}

// ═══ NEO 점수 (0~6) — 임시 휴리스틱 ═══════════════════════════
function calcNeoScore(s) {
  let n = 0;
  if (s.change >= 10) n++;
  if (s.amountEok >= 50) n++;
  if (s.amountEok >= 200) n++;
  if (s.amountEok >= 500) n++;
  if (s.investor === '기+외') n++;
  if (s.wick <= 3) n++;
  return n;
}

// 등급 letter approximation (frontend 표시용)
function gradeLetter(neo) {
  if (neo >= 7) return 'S';
  if (neo >= 6) return 'A';
  if (neo >= 5) return 'B';
  if (neo >= 4) return 'C';
  return 'D';
}

// ═══ 시간 ═══════════════════════════════════════════════════
function todayKR() {
  const now = new Date();
  const kst = new Date(now.getTime() + (9 * 60 - now.getTimezoneOffset()) * 60000);
  const yy = String(kst.getUTCFullYear()).slice(2);
  const mm = String(kst.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(kst.getUTCDate()).padStart(2, '0');
  return {
    yyMmDd: yy + '-' + mm + '-' + dd,           // 26-04-28 (data.js row format)
    yyyyMmDd: '20' + yy + '-' + mm + '-' + dd,  // 2026-04-28 (commit message)
    dow: kst.getUTCDay()
  };
}

// ═══ 배치 inquire-price ═══════════════════════════════════════
async function batchEnrich(candidates, token) {
  const result = [];
  for (let i = 0; i < candidates.length; i += KIS_BATCH) {
    const slice = candidates.slice(i, i + KIS_BATCH);
    const promises = slice.map(function (c) {
      return getStockSnapshot(c.code, token)
        .then(function (s) { return Object.assign({}, c, s); })
        .catch(function (e) { return Object.assign({}, c, { error: e.message }); });
    });
    const snaps = await Promise.all(promises);
    snaps.forEach(function (s) { result.push(s); });
    if (i + KIS_BATCH < candidates.length) await sleep(KIS_GAP_MS);
  }
  return result;
}

// ═══ data.js row 생성 (39 컬럼) ════════════════════════════════
// 기존 row 예시:
// [`한화엔진`,`26-04-17`,`KS`,16.39,`2873억`,`기+외`,7,`A`,16.39,2,164,0,0,25,80,7,13,-13,0,`TO`,-13.6,`ATH`,21,6,1,1,0,0,``,``,``,``,0,0,0,``,0,0,``]
function escapeBacktick(s) {
  return String(s).replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
}
function bt(v) { return '`' + escapeBacktick(v) + '`'; }

function buildDataRow(c, dateYYMMDD) {
  const mc = c.amountEok + '억';
  const grade = gradeLetter(c.neo);
  // 미래 백테스트 결과는 모르므로 result='PENDING', peak/trough/pnl=0, breakType='ATH' (기본)
  return '[' + [
    bt(c.name),         // 0
    bt(dateYYMMDD),     // 1
    bt(c.market),       // 2  KS/KQ
    String(c.change),   // 3
    bt(mc),             // 4
    bt(c.investor),     // 5
    String(c.neo),      // 6  NEO score
    bt(grade),          // 7  grade letter
    String(c.change),   // 8  change again
    '0',                // 9
    '0',                // 10
    '0',                // 11 peak%
    '0',                // 12 trough%
    '0',                // 13
    '0',                // 14
    '0',                // 15
    '10',               // 16 TP1%
    '-5',               // 17 SL%
    '0',                // 18 pnl
    bt('PENDING'),      // 19 result
    '0',                // 20
    bt('ATH'),          // 21 breakType
    '0',                // 22
    '0',                // 23
    '0',                // 24
    '0',                // 25
    '0',                // 26
    '0',                // 27
    '``',               // 28
    '``',               // 29
    '``',               // 30
    '``',               // 31
    '0',                // 32
    '0',                // 33
    '0',                // 34
    '``',               // 35
    '0',                // 36
    '0',                // 37
    '``'                // 38 OHLC trail
  ].join(',') + ']';
}

// ═══ GitHub API ══════════════════════════════════════════════
async function ghRequest(method, path, token, body, acceptHeader) {
  const reqBody = body ? JSON.stringify(body) : null;
  const headers = {
    'Authorization': 'token ' + token,
    'Accept': acceptHeader || 'application/vnd.github+json',
    'User-Agent': 'neo-score-cron',
    'X-GitHub-Api-Version': '2022-11-28'
  };
  if (reqBody) {
    headers['Content-Type'] = 'application/json';
    headers['Content-Length'] = Buffer.byteLength(reqBody);
  }
  return await httpsRequest({
    hostname: 'api.github.com',
    path: path,
    method: method,
    headers: headers
  }, reqBody);
}

async function readDataJs(token) {
  // 1. contents API → file SHA
  const meta = await ghRequest(
    'GET',
    '/repos/' + GH_OWNER + '/' + GH_REPO + '/contents/' + GH_PATH + '?ref=' + GH_BRANCH,
    token,
    null,
    null
  );
  if (meta.status !== 200) {
    throw new Error('GH contents fail (' + meta.status + '): ' + (meta.raw || '').slice(0, 200));
  }
  const fileSha = meta.data.sha;

  // 2. blobs API (raw) → 큰 파일도 OK (3.5MB)
  const blob = await ghRequest(
    'GET',
    '/repos/' + GH_OWNER + '/' + GH_REPO + '/git/blobs/' + fileSha,
    token,
    null,
    'application/vnd.github.raw'
  );
  if (blob.status !== 200) {
    throw new Error('GH blob fail (' + blob.status + '): ' + (blob.raw || '').slice(0, 200));
  }
  return { sha: fileSha, text: blob.raw };
}

async function writeDataJs(token, sha, newText, message) {
  const body = {
    message: message,
    content: Buffer.from(newText, 'utf8').toString('base64'),
    sha: sha,
    branch: GH_BRANCH
  };
  const r = await ghRequest(
    'PUT',
    '/repos/' + GH_OWNER + '/' + GH_REPO + '/contents/' + GH_PATH,
    token,
    body,
    null
  );
  if (r.status !== 200 && r.status !== 201) {
    throw new Error('GH PUT fail (' + r.status + '): ' + (r.raw || '').slice(0, 300));
  }
  return {
    commit_sha: r.data && r.data.commit && r.data.commit.sha,
    html_url: r.data && r.data.commit && r.data.commit.html_url
  };
}

function injectRows(originalText, newRowStrs, dateYYMMDD) {
  // R_26 array 의 닫는 부분 찾기. 파일은 `export const R_26 =[ ... ];` 형태.
  // 같은 날짜로 이미 push 된 경우 중복 방지: dateYYMMDD 패턴이 이미 존재하면 추가 안함
  // (단, 같은 날 두 번 cron 도는 일 없음 — 이중 안전장치)
  
  // 닫는 위치: 마지막 ']' + ';'  찾기
  // 정확한 패턴: 마지막 row의 ']' 다음에 '\n];' 또는 ']\n];' 또는 '];'
  // 가장 안전: 파일 끝 쪽에서 마지막 '];' 찾기
  const closingIdx = originalText.lastIndexOf('];');
  if (closingIdx < 0) {
    throw new Error('R_26 closing "];" not found in data.js');
  }

  // 그 직전에 trailing comma 가 있는지 / 마지막 char 가 ']' 인지 확인
  let prefix = originalText.slice(0, closingIdx);
  // trim trailing whitespace
  let trimEnd = prefix.length;
  while (trimEnd > 0 && /\s/.test(prefix[trimEnd - 1])) trimEnd--;
  const lastChar = prefix[trimEnd - 1];

  let separator;
  if (lastChar === ',') {
    // trailing comma 있음 → 그냥 newline 후 새 row 들 추가
    separator = '\n';
  } else if (lastChar === ']') {
    // trailing comma 없음 → comma + newline 추가 후 새 row 들
    separator = ',\n';
  } else {
    throw new Error('Unexpected last char before "];": "' + lastChar + '"');
  }

  const newRowsBlock = newRowStrs.join(',\n');
  // 새 row 마지막에 colon X (다음에 ']'바로 옴)
  return prefix.slice(0, trimEnd) + separator + newRowsBlock + '\n' + originalText.slice(closingIdx);
}

async function commitToDataJs(token, today, candidates) {
  const file = await readDataJs(token);

  // 같은 날짜 row 가 이미 있으면 cron 재실행 → idempotent (skip)
  // 검사 패턴: `,\`26-04-28\`,` 또는 `[\`...\`,\`26-04-28\`,...
  const dateMarker = '`' + today.yyMmDd + '`';
  // 좀 더 specific: row 의 1번 컬럼 위치 확인이 어려우니 marker count 로 판정
  const occurrences = (file.text.match(new RegExp('`' + today.yyMmDd.replace(/-/g, '\\-') + '`', 'g')) || []).length;

  // 새 row 생성
  const rowStrs = candidates.map(function (c) { return buildDataRow(c, today.yyMmDd); });

  if (rowStrs.length === 0) {
    return { skipped: 'no_candidates', occurrences: occurrences };
  }

  const newText = injectRows(file.text, rowStrs, today.yyMmDd);

  const message = 'daily-signal: ' + today.yyyyMmDd + ' (' + candidates.length + '종)';
  const result = await writeDataJs(token, file.sha, newText, message);
  return Object.assign({}, result, {
    appended: rowStrs.length,
    sizeBefore: file.text.length,
    sizeAfter: newText.length,
    duplicate_date_existed: occurrences > 0
  });
}

// ═══ 핸들러 ═══════════════════════════════════════════════════
module.exports = async function (req, res) {
  const isCron = req.headers['x-vercel-cron'] === '1';
  const isAuthed = process.env.CRON_SECRET
    && req.headers.authorization === 'Bearer ' + process.env.CRON_SECRET;
  if (!isCron && !isAuthed) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const today = todayKR();
  if (today.dow === 0 || today.dow === 6) {
    return res.status(200).json({ ok: true, skipped: 'weekend', date: today.yyyyMmDd });
  }

  const missing = [];
  if (!process.env.KIS_APP_KEY) missing.push('KIS_APP_KEY');
  if (!process.env.KIS_APP_SECRET) missing.push('KIS_APP_SECRET');
  if (!process.env.GITHUB_TOKEN) missing.push('GITHUB_TOKEN');
  if (missing.length) {
    return res.status(500).json({ error: 'env missing: ' + missing.join(', ') });
  }

  try {
    const token = await getKisToken();

    const lists = await Promise.all([
      getFluctuationRising('J', token),
      getFluctuationRising('Q', token)
    ]);
    const all = lists[0].concat(lists[1]);
    const filtered = all.filter(function (c) { return c.change >= MIN_CHANGE; });
    const enriched = await batchEnrich(filtered, token);
    const valid = enriched.filter(function (c) {
      return !c.error && c.amount >= MIN_AMOUNT;
    });
    const scored = valid.map(function (c) {
      return Object.assign({}, c, { neo: calcNeoScore(c) });
    });
    const passed = scored.filter(function (c) { return c.neo >= MIN_NEO; });
    passed.sort(function (a, b) {
      return (b.neo - a.neo) || (b.amount - a.amount);
    });

    let commitInfo = null;
    if (passed.length > 0) {
      commitInfo = await commitToDataJs(process.env.GITHUB_TOKEN, today, passed);
    }

    res.status(200).json({
      ok: true,
      date: today.yyyyMmDd,
      stats: {
        kospiTop: lists[0].length,
        kosdaqTop: lists[1].length,
        changeFilter: filtered.length,
        amountFilter: valid.length,
        neoPassed: passed.length
      },
      commit: commitInfo,
      candidates: passed.map(function (c) {
        return {
          code: c.code, name: c.name, market: c.market,
          change: c.change, amountEok: c.amountEok,
          neo: c.neo, investor: c.investor, wick: c.wick
        };
      })
    });
  } catch (e) {
    res.status(500).json({ error: e.message, stack: (e.stack || '').slice(0, 500) });
  }
};
