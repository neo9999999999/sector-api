// api/daily-signal.js v4
// screening 호출 결과의 NEO 4+ (S/A/B 등급) 만 data.js R_26 에 append
const https = require('https');

const SCREENING_URL = 'https://sector-api-pink.vercel.app/api/screening';
const GH_OWNER = 'neo9999999999';
const GH_REPO = 'neo-score';
const GH_PATH = 'src/data.js';
const GH_BRANCH = 'main';

function httpsRequest(opts, body) {
  return new Promise(function (resolve, reject) {
    const req = https.request(opts, function (res) {
      const chunks = [];
      res.on('data', function (c) { chunks.push(c); });
      res.on('end', function () {
        const buf = Buffer.concat(chunks);
        const raw = buf.toString('utf8');
        let parsed = null;
        try { parsed = raw ? JSON.parse(raw) : null; } catch (_) {}
        resolve({ status: res.statusCode, data: parsed, raw: raw });
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function httpsGetAbs(urlStr) {
  const u = new URL(urlStr);
  return httpsRequest({
    hostname: u.hostname,
    port: u.port || 443,
    path: u.pathname + u.search,
    method: 'GET',
    headers: { 'User-Agent': 'neo-score-cron' }
  }, null);
}

function todayKR() {
  const now = new Date();
  const kst = new Date(now.getTime() + (9 * 60 - now.getTimezoneOffset()) * 60000);
  const yy = String(kst.getUTCFullYear()).slice(2);
  const mm = String(kst.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(kst.getUTCDate()).padStart(2, '0');
  return {
    yyMmDd: yy + '-' + mm + '-' + dd,
    yyyyMmDd: '20' + yy + '-' + mm + '-' + dd,
    dow: kst.getUTCDay()
  };
}

function escapeBacktick(s) {
  return String(s).replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
}
function bt(v) { return '`' + escapeBacktick(v) + '`'; }

function buildDataRow(c, dateYYMMDD) {
  const market = c.market === 'KOSPI' ? 'KS' : 'KQ';
  const mc = c.amount + '억';
  const grade = c.grade || 'C';
  return '[' + [
    bt(c.name),
    bt(dateYYMMDD),
    bt(market),
    String(c.change),
    bt(mc),
    bt(c.investor || '없음'),
    String(c.score),
    bt(grade),
    String(c.change),
    '0', '0',
    '0', '0',
    '0', '0', '0',
    String(c.tp1 || 10),
    String(c.sl ? -Math.abs(c.sl) : -5),
    '0',
    bt('PENDING'),
    '0',
    bt('ATH'),
    '0','0','0','0','0','0',
    '``','``','``','``',
    '0','0','0',
    '``',
    '0','0',
    '``'
  ].join(',') + ']';
}

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
    hostname: 'api.github.com', path: path, method: method, headers: headers
  }, reqBody);
}

async function readDataJs(token) {
  const meta = await ghRequest('GET',
    '/repos/' + GH_OWNER + '/' + GH_REPO + '/contents/' + GH_PATH + '?ref=' + GH_BRANCH,
    token, null, null);
  if (meta.status !== 200) {
    throw new Error('GH contents fail (' + meta.status + ')');
  }
  const fileSha = meta.data.sha;
  const blob = await ghRequest('GET',
    '/repos/' + GH_OWNER + '/' + GH_REPO + '/git/blobs/' + fileSha,
    token, null, 'application/vnd.github.raw');
  if (blob.status !== 200) throw new Error('GH blob fail (' + blob.status + ')');
  return { sha: fileSha, text: blob.raw };
}

async function writeDataJs(token, sha, newText, message) {
  const body = {
    message: message,
    content: Buffer.from(newText, 'utf8').toString('base64'),
    sha: sha,
    branch: GH_BRANCH
  };
  const r = await ghRequest('PUT',
    '/repos/' + GH_OWNER + '/' + GH_REPO + '/contents/' + GH_PATH,
    token, body, null);
  if (r.status !== 200 && r.status !== 201) {
    throw new Error('GH PUT fail (' + r.status + '): ' + (r.raw || '').slice(0, 200));
  }
  return {
    commit_sha: r.data && r.data.commit && r.data.commit.sha,
    html_url: r.data && r.data.commit && r.data.commit.html_url
  };
}

function injectRows(originalText, newRowStrs) {
  const closingIdx = originalText.lastIndexOf('];');
  if (closingIdx < 0) throw new Error('R_26 closing "];" not found');
  let prefix = originalText.slice(0, closingIdx);
  let trimEnd = prefix.length;
  while (trimEnd > 0 && /\s/.test(prefix[trimEnd - 1])) trimEnd--;
  const lastChar = prefix[trimEnd - 1];
  let separator;
  if (lastChar === ',') separator = '\n';
  else if (lastChar === ']') separator = ',\n';
  else throw new Error('Unexpected last char: "' + lastChar + '"');
  const newBlock = newRowStrs.join(',\n');
  return prefix.slice(0, trimEnd) + separator + newBlock + '\n' + originalText.slice(closingIdx);
}

async function commitToDataJs(token, today, candidates) {
  const file = await readDataJs(token);
  const occurrences = (file.text.match(new RegExp('`' + today.yyMmDd.replace(/-/g, '\\-') + '`', 'g')) || []).length;
  const rowStrs = candidates.map(function (c) { return buildDataRow(c, today.yyMmDd); });
  if (rowStrs.length === 0) return { skipped: 'no_candidates' };
  const newText = injectRows(file.text, rowStrs);
  const message = 'daily-signal: ' + today.yyyyMmDd + ' (' + candidates.length + ')';
  const result = await writeDataJs(token, file.sha, newText, message);
  return Object.assign({}, result, {
    appended: rowStrs.length,
    sizeBefore: file.text.length,
    sizeAfter: newText.length,
    duplicate_date_existed: occurrences > 0
  });
}

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
  if (!process.env.GITHUB_TOKEN) {
    return res.status(500).json({ error: 'GITHUB_TOKEN missing' });
  }
  try {
    const scr = await httpsGetAbs(SCREENING_URL);
    if (scr.status !== 200 || !scr.data || !scr.data.signals) {
      return res.status(500).json({
        error: 'screening fail',
        screening_status: scr.status,
        raw: (scr.raw || '').slice(0, 300)
      });
    }
    const sigs = scr.data.signals;
    const candidates = [].concat(sigs.S || [], sigs.A || [], sigs.B || []);
    let commitInfo = null;
    if (candidates.length > 0) {
      commitInfo = await commitToDataJs(process.env.GITHUB_TOKEN, today, candidates);
    }
    res.status(200).json({
      ok: true,
      date: today.yyyyMmDd,
      screening: {
        S: (sigs.S || []).length,
        A: (sigs.A || []).length,
        B: (sigs.B || []).length,
        X: (sigs.X || []).length,
        total: scr.data.summary && scr.data.summary.total
      },
      passed: candidates.length,
      commit: commitInfo,
      candidates: candidates.map(function (c) {
        return { code: c.code, name: c.name, market: c.market, change: c.change, score: c.score, grade: c.grade, amount: c.amount };
      })
    });
  } catch (e) {
    res.status(500).json({ error: e.message, stack: (e.stack || '').slice(0, 300) });
  }
};
