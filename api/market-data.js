// api/market-data.js — 메인 API 엔드포인트
// Vercel Serverless Function
import {
  getVolumeRank,
  getVolumeRankKosdaq,
  getLimitUp,
  getLimitUpKosdaq,
  getSectorPerformance,
  getMarketIndex,
} from "../lib/kis.js";

// ─── 섹터 자동 분류 (종목명 → 섹터 매핑) ───
const SECTOR_MAP = {
  // 반도체
  반도체: ["삼성전자","SK하이닉스","한미반도체","리노공업","DB하이텍","심텍","파두","엠케이전자","SK스퀘어","삼성전기","아이티엠반도","테크윙","이오테크닉스","피에스케이","주성엔지니어링","원익IPS","HPSP"],
  // 건설/재건
  건설: ["현대건설","대우건설","GS건설","DL이앤씨","삼성E&A","삼성물산","HDC현대산업","태영건설","금호건설","희림","상지건설","코오롱글로벌"],
  // 방산
  방산: ["한화에어로스페이스","LIG넥스원","한화시스템","현대로템","풍산","퍼스텍","한국항공우주","스페코","빅텍"],
  // 원전
  원전: ["두산에너빌리","한국전력","한전기술","한전KPS","비에이치아이","우리기술","보성파워텍"],
  // 바이오
  바이오: ["삼성바이오로직스","셀트리온","알테오젠","삼천당제약","유한양행","종근당","SK바이오사이언스","에이비엘바이오","펩트론"],
  // 2차전지
  "2차전지": ["LG에너지솔루션","삼성SDI","에코프로","에코프로비엠","포스코퓨처엠","엘앤에프"],
  // 자동차
  자동차: ["현대차","기아","현대모비스","만도","HL만도"],
  // 조선
  조선: ["HD한국조선해양","삼성중공업","한화오션","HD현대중공업","HD현대미포"],
  // 에너지
  에너지: ["S-Oil","GS","SK이노베이션","SK에너지"],
  // 통신/광통신
  통신: ["KT","SK텔레콤","LG유플러스","대한광통신","옵티시스","비씨엔씨"],
  // 금융
  금융: ["KB금융","신한지주","하나금융","우리금융","키움증권","미래에셋증권","삼성증권","NH투자증권"],
  // 철강
  철강: ["POSCO홀딩스","현대제철","동국제강","금강철강","세아베스틸"],
  // 항공
  항공: ["대한항공","아시아나항공","제주항공","티웨이항공","진에어"],
  // AI/소프트웨어
  AI: ["네이버","카카오","솔트룩스","코난테크놀로지","셀바스AI","알체라"],
  // 로봇
  로봇: ["레인보우로보틱스","로보스타","두산로보틱스","로보티즈"],
};

function classifySector(stockName) {
  for (const [sector, stocks] of Object.entries(SECTOR_MAP)) {
    if (stocks.some((s) => stockName.includes(s) || s.includes(stockName))) {
      return sector;
    }
  }
  return "기타";
}

// ─── 주도 섹터 분석 ───
function analyzeSectors(volumeRank, limitUp) {
  // 거래대금 상위 + 상승 종목만
  const risingStocks = volumeRank.filter((s) => s.change > 0);

  // 섹터별 그룹핑
  const sectorMap = {};
  risingStocks.forEach((stock) => {
    const sector = classifySector(stock.name);
    if (!sectorMap[sector]) sectorMap[sector] = [];
    sectorMap[sector].push(stock);
  });

  // 상한가 종목 추가
  limitUp.forEach((stock) => {
    const sector = classifySector(stock.name);
    if (!sectorMap[sector]) sectorMap[sector] = [];
    const exists = sectorMap[sector].find((s) => s.code === stock.code);
    if (!exists) sectorMap[sector].push({ ...stock, isLimit: true });
    else exists.isLimit = true;
  });

  // 섹터별 모멘텀 점수 계산
  const sectors = Object.entries(sectorMap)
    .map(([name, stocks]) => {
      const totalAmt = stocks.reduce((a, s) => a + (s.tradeAmt || 0), 0);
      const avgChange = stocks.reduce((a, s) => a + s.change, 0) / stocks.length;
      const limitCount = stocks.filter((s) => s.isLimit).length;
      const stockCount = stocks.length;

      // 모멘텀 = 종목수(20%) + 평균등락률(30%) + 거래대금(30%) + 상한가수(20%)
      let momentum = Math.min(100, Math.round(
        (Math.min(stockCount, 5) / 5) * 20 +
        (Math.min(avgChange, 15) / 15) * 30 +
        (Math.min(totalAmt / 1e12, 5) / 5) * 30 +
        (Math.min(limitCount, 3) / 3) * 20
      ));

      return {
        name,
        momentum,
        stocks: stocks
          .sort((a, b) => (b.tradeAmt || 0) - (a.tradeAmt || 0))
          .slice(0, 10)
          .map((s) => ({
            n: s.name,
            p: s.price,
            c: s.change,
            v: formatAmt(s.tradeAmt),
            vr: Math.round((s.tradeAmt || 0) / 1e8), // 억 단위
            isLimit: s.isLimit || false,
          })),
        avgChange: Math.round(avgChange * 100) / 100,
        totalAmt: formatAmt(totalAmt),
        limitCount,
      };
    })
    .filter((s) => s.stocks.length >= 1 && s.avgChange > 0) // 상승 섹터만
    .sort((a, b) => b.momentum - a.momentum);

  return sectors;
}

function formatAmt(amt) {
  if (!amt) return "0";
  if (amt >= 1e12) return (amt / 1e12).toFixed(2) + "조";
  if (amt >= 1e8) return Math.round(amt / 1e8) + "억";
  return Math.round(amt / 1e4) + "만";
}

// ─── API Handler ───
export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const { type } = req.query;

    // 개별 종목 상세
    if (type === "stock" && req.query.code) {
      const { getStockDetail } = await import("../lib/kis.js");
      const detail = await getStockDetail(req.query.code);
      return res.status(200).json({ ok: true, data: detail });
    }

    // 전체 시장 데이터
    const [
      volumeKospi,
      volumeKosdaq,
      limitKospi,
      limitKosdaq,
      marketIndex,
    ] = await Promise.all([
      getVolumeRank(),
      getVolumeRankKosdaq(),
      getLimitUp(),
      getLimitUpKosdaq(),
      getMarketIndex(),
    ]);

    // 거래대금 상위 통합 (코스피 + 코스닥)
    const allVolume = [...volumeKospi, ...volumeKosdaq]
      .sort((a, b) => b.tradeAmt - a.tradeAmt)
      .slice(0, 30);

    // 상한가 통합
    const allLimit = [...limitKospi, ...limitKosdaq];

    // 주도섹터 분석
    const sectors = analyzeSectors(allVolume, allLimit);

    // 거래대금 상위 (상승만)
    const topVolume = allVolume
      .filter((s) => s.change > 0)
      .slice(0, 20)
      .map((s) => ({
        name: s.name,
        code: s.code,
        sector: classifySector(s.name),
        price: s.price,
        change: s.change,
        tradeAmt: formatAmt(s.tradeAmt),
        tradeAmtRaw: s.tradeAmt,
        isLimit: allLimit.some((l) => l.code === s.code),
      }));

    const today = new Date().toLocaleDateString("ko-KR", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });

    return res.status(200).json({
      ok: true,
      date: today,
      timestamp: new Date().toISOString(),
      market: marketIndex,
      sectors,
      topVolume,
      limitUp: allLimit.map((s) => ({
        name: s.name,
        code: s.code,
        price: s.price,
        change: s.change,
        sector: classifySector(s.name),
        tradeAmt: formatAmt(s.tradeAmt),
      })),
    });
  } catch (error) {
    console.error("API Error:", error);
    return res.status(500).json({
      ok: false,
      error: error.message,
      hint: "KIS_APP_KEY, KIS_APP_SECRET 환경변수를 확인하세요",
    });
  }
}
