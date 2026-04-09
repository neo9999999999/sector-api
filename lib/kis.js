// lib/kis.js — 한국투자증권 OpenAPI 핵심 라이브러리
// 토큰 관리 + API 호출 래퍼

let cachedToken = null;
let tokenExpiry = 0;

const BASE = "https://openapi.koreainvestment.com:9443";

// ─── 토큰 발급 ───
async function getToken() {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;

  const res = await fetch(`${BASE}/oauth2/tokenP`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      appkey: process.env.KIS_APP_KEY,
      appsecret: process.env.KIS_APP_SECRET,
    }),
  });

  if (!res.ok) throw new Error(`토큰 발급 실패: ${res.status}`);
  const data = await res.json();
  cachedToken = data.access_token;
  tokenExpiry = Date.now() + 23 * 60 * 60 * 1000; // 23시간
  return cachedToken;
}

// ─── API 호출 공통 ───
async function kisGet(path, trId, params = {}) {
  const token = await getToken();
  const qs = new URLSearchParams(params).toString();
  const url = `${BASE}${path}?${qs}`;

  const res = await fetch(url, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      authorization: `Bearer ${token}`,
      appkey: process.env.KIS_APP_KEY,
      appsecret: process.env.KIS_APP_SECRET,
      tr_id: trId,
      custtype: "P",
    },
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`KIS API 오류 [${trId}]: ${res.status} - ${err}`);
  }
  return res.json();
}

// ═══════════════════════════════════════════
// 1. 거래대금 상위 종목 (상승 종목만)
// ═══════════════════════════════════════════
export async function getVolumeRank() {
  const data = await kisGet(
    "/uapi/domestic-stock/v1/ranking/volume",
    "FHPST01710000",
    {
      FID_COND_MRKT_DIV_CODE: "J", // 코스피
      FID_COND_SCR_DIV_CODE: "20174",
      FID_INPUT_ISCD: "0000",
      FID_DIV_CLS_CODE: "0",
      FID_BLNG_CLS_CODE: "0",
      FID_TRGT_CLS_CODE: "111111111",
      FID_TRGT_EXLS_CLS_CODE: "000000",
      FID_INPUT_PRICE_1: "",
      FID_INPUT_PRICE_2: "",
      FID_VOL_CNT: "",
      FID_INPUT_DATE_1: "",
    }
  );

  return (data.output || []).map((item) => ({
    name: item.hts_kor_isnm, // 종목명
    code: item.mksc_shrn_iscd, // 종목코드
    price: parseInt(item.stck_prpr), // 현재가
    change: parseFloat(item.prdy_ctrt), // 등락률
    volume: parseInt(item.acml_vol), // 누적거래량
    tradeAmt: parseInt(item.acml_tr_pbmn), // 누적거래대금
    changeAmt: parseInt(item.prdy_vrss), // 전일대비
    sign: item.prdy_vrss_sign, // 등락부호
  }));
}

// 코스닥 거래대금 상위
export async function getVolumeRankKosdaq() {
  const data = await kisGet(
    "/uapi/domestic-stock/v1/ranking/volume",
    "FHPST01710000",
    {
      FID_COND_MRKT_DIV_CODE: "Q", // 코스닥
      FID_COND_SCR_DIV_CODE: "20174",
      FID_INPUT_ISCD: "0000",
      FID_DIV_CLS_CODE: "0",
      FID_BLNG_CLS_CODE: "0",
      FID_TRGT_CLS_CODE: "111111111",
      FID_TRGT_EXLS_CLS_CODE: "000000",
      FID_INPUT_PRICE_1: "",
      FID_INPUT_PRICE_2: "",
      FID_VOL_CNT: "",
      FID_INPUT_DATE_1: "",
    }
  );

  return (data.output || []).map((item) => ({
    name: item.hts_kor_isnm,
    code: item.mksc_shrn_iscd,
    price: parseInt(item.stck_prpr),
    change: parseFloat(item.prdy_ctrt),
    volume: parseInt(item.acml_vol),
    tradeAmt: parseInt(item.acml_tr_pbmn),
  }));
}

// ═══════════════════════════════════════════
// 2. 상한가 종목
// ═══════════════════════════════════════════
export async function getLimitUp() {
  // 상승률 상위로 상한가(+29.9%이상) 필터
  const data = await kisGet(
    "/uapi/domestic-stock/v1/ranking/fluctuation",
    "FHPST01700000",
    {
      FID_COND_MRKT_DIV_CODE: "J",
      FID_COND_SCR_DIV_CODE: "20170",
      FID_INPUT_ISCD: "0000",
      FID_RANK_SORT_CLS_CODE: "0", // 상승률 순
      FID_INPUT_CNT_1: "0",
      FID_PRC_CLS_CODE: "0",
      FID_INPUT_PRICE_1: "",
      FID_INPUT_PRICE_2: "",
      FID_VOL_CNT: "",
      FID_TRGT_CLS_CODE: "0",
      FID_TRGT_EXLS_CLS_CODE: "0",
      FID_DIV_CLS_CODE: "0",
      FID_RSFL_RATE1: "",
      FID_RSFL_RATE2: "",
    }
  );

  return (data.output || [])
    .filter((item) => parseFloat(item.prdy_ctrt) >= 29.0)
    .map((item) => ({
      name: item.hts_kor_isnm,
      code: item.mksc_shrn_iscd,
      price: parseInt(item.stck_prpr),
      change: parseFloat(item.prdy_ctrt),
      tradeAmt: parseInt(item.acml_tr_pbmn),
      time: item.stck_cntg_hour, // 체결시간
    }));
}

// 코스닥 상한가
export async function getLimitUpKosdaq() {
  const data = await kisGet(
    "/uapi/domestic-stock/v1/ranking/fluctuation",
    "FHPST01700000",
    {
      FID_COND_MRKT_DIV_CODE: "Q",
      FID_COND_SCR_DIV_CODE: "20170",
      FID_INPUT_ISCD: "0000",
      FID_RANK_SORT_CLS_CODE: "0",
      FID_INPUT_CNT_1: "0",
      FID_PRC_CLS_CODE: "0",
      FID_INPUT_PRICE_1: "",
      FID_INPUT_PRICE_2: "",
      FID_VOL_CNT: "",
      FID_TRGT_CLS_CODE: "0",
      FID_TRGT_EXLS_CLS_CODE: "0",
      FID_DIV_CLS_CODE: "0",
      FID_RSFL_RATE1: "",
      FID_RSFL_RATE2: "",
    }
  );

  return (data.output || [])
    .filter((item) => parseFloat(item.prdy_ctrt) >= 29.0)
    .map((item) => ({
      name: item.hts_kor_isnm,
      code: item.mksc_shrn_iscd,
      price: parseInt(item.stck_prpr),
      change: parseFloat(item.prdy_ctrt),
      tradeAmt: parseInt(item.acml_tr_pbmn),
    }));
}

// ═══════════════════════════════════════════
// 3. 업종별 등락률 (섹터)
// ═══════════════════════════════════════════
export async function getSectorPerformance() {
  // 주요 업종 코드
  const sectors = [
    { code: "0001", name: "코스피" },
    { code: "0002", name: "대형주" },
    { code: "0003", name: "중형주" },
    { code: "0004", name: "소형주" },
    { code: "0005", name: "음식료" },
    { code: "0006", name: "섬유의복" },
    { code: "0007", name: "종이목재" },
    { code: "0008", name: "화학" },
    { code: "0009", name: "의약품" },
    { code: "0010", name: "비금속광물" },
    { code: "0011", name: "철강금속" },
    { code: "0012", name: "기계" },
    { code: "0013", name: "전기전자" },
    { code: "0014", name: "의료정밀" },
    { code: "0015", name: "운수장비" },
    { code: "0016", name: "유통업" },
    { code: "0017", name: "전기가스" },
    { code: "0018", name: "건설업" },
    { code: "0019", name: "운수창고" },
    { code: "0020", name: "통신업" },
    { code: "0021", name: "금융업" },
    { code: "0024", name: "증권" },
    { code: "0025", name: "보험" },
    { code: "0026", name: "서비스업" },
    { code: "0027", name: "제조업" },
  ];

  const results = [];
  for (const sector of sectors) {
    try {
      const data = await kisGet(
        "/uapi/domestic-stock/v1/quotations/inquire-daily-indexchart",
        "FHKUP03500100",
        {
          FID_COND_MRKT_DIV_CODE: "U",
          FID_INPUT_ISCD: sector.code,
          FID_INPUT_DATE_1: new Date().toISOString().slice(0, 10).replace(/-/g, ""),
          FID_INPUT_DATE_2: new Date().toISOString().slice(0, 10).replace(/-/g, ""),
          FID_PERIOD_DIV_CODE: "D",
        }
      );

      if (data.output1) {
        results.push({
          code: sector.code,
          name: sector.name,
          price: parseFloat(data.output1.bstp_nmix_prpr),
          change: parseFloat(data.output1.bstp_nmix_prdy_ctrt),
        });
      }
    } catch (e) {
      // 개별 섹터 실패 시 스킵
    }
  }

  return results.sort((a, b) => b.change - a.change);
}

// ═══════════════════════════════════════════
// 4. 개별 종목 상세 (현재가 + 투자자별)
// ═══════════════════════════════════════════
export async function getStockDetail(code) {
  const [priceData, investorData] = await Promise.all([
    kisGet("/uapi/domestic-stock/v1/quotations/inquire-price", "FHKST01010100", {
      FID_COND_MRKT_DIV_CODE: "J",
      FID_INPUT_ISCD: code,
    }),
    kisGet("/uapi/domestic-stock/v1/quotations/inquire-investor", "FHKST01010900", {
      FID_COND_MRKT_DIV_CODE: "J",
      FID_INPUT_ISCD: code,
    }).catch(() => null),
  ]);

  const p = priceData.output;
  const inv = investorData?.output;

  return {
    name: p.hts_kor_isnm,
    code,
    price: parseInt(p.stck_prpr),
    change: parseFloat(p.prdy_ctrt),
    open: parseInt(p.stck_oprc),
    high: parseInt(p.stck_hgpr),
    low: parseInt(p.stck_lwpr),
    volume: parseInt(p.acml_vol),
    tradeAmt: parseInt(p.acml_tr_pbmn),
    marketCap: parseInt(p.hts_avls),
    per: p.per,
    pbr: p.pbr,
    high52: parseInt(p.stck_dryy_hgpr),
    low52: parseInt(p.stck_dryy_lwpr),
    foreignBuy: inv ? parseInt(inv[0]?.frgn_ntby_qty || 0) : null,
    institutionBuy: inv ? parseInt(inv[0]?.orgn_ntby_qty || 0) : null,
  };
}

// ═══════════════════════════════════════════
// 5. 코스피/코스닥 지수
// ═══════════════════════════════════════════
export async function getMarketIndex() {
  const [kospi, kosdaq] = await Promise.all([
    kisGet("/uapi/domestic-stock/v1/quotations/inquire-daily-indexchart", "FHKUP03500100", {
      FID_COND_MRKT_DIV_CODE: "U",
      FID_INPUT_ISCD: "0001",
      FID_INPUT_DATE_1: new Date().toISOString().slice(0, 10).replace(/-/g, ""),
      FID_INPUT_DATE_2: new Date().toISOString().slice(0, 10).replace(/-/g, ""),
      FID_PERIOD_DIV_CODE: "D",
    }),
    kisGet("/uapi/domestic-stock/v1/quotations/inquire-daily-indexchart", "FHKUP03500100", {
      FID_COND_MRKT_DIV_CODE: "U",
      FID_INPUT_ISCD: "1001",
      FID_INPUT_DATE_1: new Date().toISOString().slice(0, 10).replace(/-/g, ""),
      FID_INPUT_DATE_2: new Date().toISOString().slice(0, 10).replace(/-/g, ""),
      FID_PERIOD_DIV_CODE: "D",
    }),
  ]);

  return {
    kospi: {
      value: kospi.output1?.bstp_nmix_prpr,
      change: kospi.output1?.bstp_nmix_prdy_ctrt + "%",
      vol: kospi.output1?.acml_tr_pbmn,
    },
    kosdaq: {
      value: kosdaq.output1?.bstp_nmix_prpr,
      change: kosdaq.output1?.bstp_nmix_prdy_ctrt + "%",
      vol: kosdaq.output1?.acml_tr_pbmn,
    },
  };
}
