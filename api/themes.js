// 네이버 금융 테마 스크래퍼
// GET /api/themes?top=15 → 상위 N개 테마 + 종목 (1,2,3등주)
// 응답: { date, themes: [{no, name, change, count, up, down, leaders: [{code, name, change, amount, price}]}] }
const https = require("https");

function rqHttps(opts, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(opts, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// EUC-KR/CP949 → UTF-8 디코딩 (iconv 없이 처리)
// 한국 웹사이트가 cp949인 경우 — Node.js native로 처리하려면 iconv-lite 필요
// 간단한 우회: Naver는 charset=utf-8 옵션 일부 제공 안하므로, raw bytes를 일단 받아서
// HTTP 응답 charset을 활용하거나, accept-charset 헤더로 강제
function fetchNaver(path) {
  return rqHttps({
    hostname: 'finance.naver.com', port: 443, path, method: 'GET',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      'Accept': 'text/html',
      'Accept-Language': 'ko-KR,ko;q=0.9'
    }
  });
}

// CP949 → UTF-8 (iconv-lite 미설치 가정 시 fallback) — Node 18+ TextDecoder 사용
function decodeKorean(buf) {
  try {
    // TextDecoder는 cp949/euc-kr 지원 — Node 18+
    return new TextDecoder('euc-kr').decode(buf);
  } catch (e) {
    // fallback: bytes 그대로 (한글 깨질 수 있음)
    return buf.toString('utf-8');
  }
}

async function getThemes(topN = 15) {
  // 등락률 순 정렬 페이지 (1페이지)
  const r = await fetchNaver('/sise/sise_group.naver?type=theme');
  const html = decodeKorean(r.body);

  const themes = [];
  const pattern = /no=(\d+)">([^<]+)<\/a>[\s\S]*?<span class="tah p11 (red\d+|nv\d+)">\s*([+\-]?\d+\.\d+)%\s*<\/span>\s*<\/td>\s*<td class="number">(\d+)<\/td>\s*<td class="number">(\d+)<\/td>\s*<td class="number">(\d+)<\/td>\s*<td class="number">(\d+)<\/td>/g;
  let m;
  while ((m = pattern.exec(html)) !== null) {
    themes.push({
      no: m[1],
      name: m[2].trim(),
      change: parseFloat(m[4]),
      direction: m[3].startsWith('red') ? 'up' : 'down',
      count: +m[5], up: +m[6], flat: +m[7], down: +m[8]
    });
  }
  // 등락률 desc 정렬 후 상위 topN
  themes.sort((a, b) => b.change - a.change);
  return themes.slice(0, topN);
}

async function getThemeStocks(themeNo) {
  const r = await fetchNaver(`/sise/sise_group_detail.naver?type=theme&no=${themeNo}`);
  const html = decodeKorean(r.body);
  const stocks = [];
  // 종목 row: code, name, 현재가, 전일비, 등락률, 거래량 등
  // <td><a href="/item/main.naver?code=XXXXXX" ...>NAME</a></td>
  // <td class="number">현재가</td>
  // 전일비/등락률 span
  const rowPat = /\/item\/main\.naver\?code=(\d+)"[^>]*>([^<]+)<\/a>([\s\S]*?)<\/tr>/g;
  let m;
  while ((m = rowPat.exec(html)) !== null) {
    const code = m[1], name = m[2].trim(), inner = m[3];
    // 현재가
    const priceMatch = inner.match(/<td class="number">[\s\n]*<span[^>]*>([\d,]+)<\/span>/);
    const price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, '')) : null;
    // 등락률
    const chMatch = inner.match(/<span class="tah p11 (red\d+|nv\d+)">\s*([+\-]?[\d.]+)%\s*<\/span>/);
    const change = chMatch ? parseFloat(chMatch[2]) * (chMatch[1].startsWith('nv') ? -1 : 1) : null;
    // 거래량 (number 클래스 td 중 가장 큰 숫자가 거래량인 경우가 많음)
    const nums = [...inner.matchAll(/<td class="number">[\s\n]*([\d,]+)[\s\n]*<\/td>/g)].map(x => parseInt(x[1].replace(/,/g, '')));
    // 일반적으로: 현재가, 전일비, 등락률, 매수호가, 매도호가, 거래량, 거래대금, ...
    // 거래량은 보통 마지막 몇 개 중 큰 값
    const volume = nums.length > 0 ? Math.max(...nums.slice(-3)) : null;
    stocks.push({ code, name, price, change, volume });
  }
  // 등락률 desc 정렬 — 상위 3개 = 대장주 1,2,3등
  stocks.sort((a, b) => (b.change || 0) - (a.change || 0));
  return stocks;
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Cache-Control", "s-maxage=120, stale-while-revalidate");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const topN = parseInt(url.searchParams.get('top') || '15');
    const includeStocks = url.searchParams.get('stocks') !== '0';
    const stocksPerTheme = parseInt(url.searchParams.get('per') || '3');

    const themes = await getThemes(topN);

    if (includeStocks) {
      // 병렬로 상위 테마들 종목 가져오기 (5개씩 배치)
      const batchSize = 5;
      for (let i = 0; i < themes.length; i += batchSize) {
        const batch = themes.slice(i, i + batchSize);
        const results = await Promise.all(batch.map(t => getThemeStocks(t.no).catch(() => [])));
        for (let j = 0; j < batch.length; j++) {
          batch[j].leaders = results[j].slice(0, stocksPerTheme);
        }
      }
    }

    const now = new Date(Date.now() + 9 * 3600000);
    const date = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
    const time = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');

    return res.status(200).json({ date, time, themes });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
