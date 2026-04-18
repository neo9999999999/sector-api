// api/stock-master.js — NAVER Finance 시총 순위 페이지 파싱
const https = require('https');

function request(opts) {
  return new Promise((resolve, reject) => {
    const req = https.request(opts, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({
        status: res.statusCode,
        body: Buffer.concat(chunks)
      }));
    });
    req.on('error', reject);
    req.end();
  });
}

// EUC-KR → UTF-8 디코드 (NAVER Finance는 EUC-KR 인코딩)
// Node 기본 iconv 지원 안 하므로 iconv-lite 필요하지만 Vercel 기본 환경에선 없을 수 있음
// 대신 TextDecoder('euc-kr')이 Node 20+ 지원 (ICU full build 필요)
function decode(buf) {
  try {
    return new TextDecoder('euc-kr').decode(buf);
  } catch(e) {
    return buf.toString('latin1');
  }
}

async function fetchPage(sosok, page) {
  const path = `/sise/sise_market_sum.naver?sosok=${sosok}&page=${page}`;
  const r = await request({
    hostname: 'finance.naver.com',
    port: 443,
    path,
    method: 'GET',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html',
      'Accept-Language': 'ko-KR,ko;q=0.9'
    }
  });
  return {status: r.status, html: decode(r.body)};
}

function parsePage(html) {
  // 패턴: /item/main.naver?code=XXXXXX">종목명</a>
  // 또는 class="tit"><a href="/item/main.naver?code=XXXXXX">...
  const results = [];
  const re = /\/item\/main\.naver\?code=(\d{6})[^>]*>([^<]+)</g;
  let m;
  const seen = new Set();
  while ((m = re.exec(html)) !== null) {
    const code = m[1];
    const name = m[2].trim();
    if (seen.has(code)) continue;
    seen.add(code);
    if (name && name.length > 0) {
      results.push({code, name});
    }
  }
  return results;
}

async function fetchMarket(sosok, marketName) {
  // 페이지 수 확인: 일단 1페이지 가져와서 "맨뒤" 링크에서 max page 추출
  const first = await fetchPage(sosok, 1);
  if (first.status !== 200) return {error: 'status ' + first.status, list: []};

  // 총 페이지 수 찾기
  // 패턴: page=N" class="pgRR"> 또는 맨뒤
  let maxPage = 1;
  const pageMatches = [...first.html.matchAll(/page=(\d+)/g)];
  for (const pm of pageMatches) {
    const p = parseInt(pm[1]);
    if (p > maxPage) maxPage = p;
  }

  // 안전 상한
  if (maxPage > 50) maxPage = 50;

  const allStocks = new Map();
  for (const s of parsePage(first.html)) {
    allStocks.set(s.code, {...s, market: marketName});
  }

  // 나머지 페이지 병렬 fetch
  const batchSize = 5;
  for (let i = 2; i <= maxPage; i += batchSize) {
    const batch = [];
    for (let j = 0; j < batchSize && i + j <= maxPage; j++) {
      batch.push(fetchPage(sosok, i + j));
    }
    const responses = await Promise.all(batch);
    for (const r of responses) {
      if (r.status === 200) {
        for (const s of parsePage(r.html)) {
          if (!allStocks.has(s.code)) {
            allStocks.set(s.code, {...s, market: marketName});
          }
        }
      }
    }
  }

  return {maxPage, list: [...allStocks.values()]};
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const onlyMarket = req.query.market; // 'KOSPI' or 'KOSDAQ' or empty

    const out = {};
    if (!onlyMarket || onlyMarket === 'KOSPI') {
      out.kospi = await fetchMarket(0, 'KOSPI');
    }
    if (!onlyMarket || onlyMarket === 'KOSDAQ') {
      out.kosdaq = await fetchMarket(1, 'KOSDAQ');
    }

    const stocks = [
      ...(out.kospi?.list || []),
      ...(out.kosdaq?.list || [])
    ];

    return res.status(200).json({
      ok: true,
      fetched_at: new Date().toISOString(),
      source: 'naver-finance',
      total: stocks.length,
      kospi_count: out.kospi?.list?.length || 0,
      kosdaq_count: out.kosdaq?.list?.length || 0,
      kospi_pages: out.kospi?.maxPage,
      kosdaq_pages: out.kosdaq?.maxPage,
      stocks
    });
  } catch (e) {
    return res.status(500).json({ok: false, error: e.message, stack: e.stack});
  }
};
