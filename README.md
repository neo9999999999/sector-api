# 🔥 주도섹터 실시간 API 서버

한국투자증권 OpenAPI를 통해 실시간 주도섹터/거래대금/상한가 데이터를 수집하는 백엔드 서버.
Vercel에 배포하면 프론트엔드에서 바로 호출 가능.

## 📋 제공 데이터

| 데이터 | 설명 |
|--------|------|
| 코스피/코스닥 지수 | 현재가, 등락률, 거래대금 |
| 주도섹터 | 상승 섹터 자동 분류 + 모멘텀 점수 |
| 거래대금 상위 | 코스피+코스닥 통합 상위 30종목 |
| 상한가 종목 | 코스피+코스닥 당일 상한가 |
| 종목 상세 | 현재가, 수급(외국인/기관), PER/PBR |

---

## 🚀 배포 방법 (5분)

### 1단계: 한투 API 키 발급

1. 한국투자증권 계좌 개설 (없으면 비대면 개설)
2. https://apiportal.koreainvestment.com 접속
3. 회원가입 → 로그인
4. [서비스 신청] → 실전투자 or 모의투자 선택
5. APP_KEY, APP_SECRET 복사

### 2단계: GitHub에 업로드

```bash
# 이 폴더를 GitHub 레포에 push
git init
git add .
git commit -m "sector-api"
git remote add origin https://github.com/너의계정/sector-api.git
git push -u origin main
```

### 3단계: Vercel 배포

1. https://vercel.com 접속 → GitHub 연결
2. "Import Project" → sector-api 레포 선택
3. Environment Variables 설정:
   - `KIS_APP_KEY` = 1단계에서 복사한 키
   - `KIS_APP_SECRET` = 1단계에서 복사한 시크릿
4. "Deploy" 클릭
5. 배포 완료 → `https://your-project.vercel.app/api/market-data` 접속 확인

---

## 📡 API 사용법

### 전체 시장 데이터
```
GET /api/market-data
```

응답 예시:
```json
{
  "ok": true,
  "date": "2026. 04. 09.",
  "market": {
    "kospi": { "value": "5817.67", "change": "-0.93%", "vol": "28.5조" },
    "kosdaq": { "value": "1088.48", "change": "-0.13%", "vol": "9.8조" }
  },
  "sectors": [
    {
      "name": "항공",
      "momentum": 78,
      "stocks": [
        { "n": "대한항공", "p": 28500, "c": 5.2, "v": "3800억", "isLimit": false }
      ],
      "avgChange": 4.8,
      "limitCount": 0
    }
  ],
  "topVolume": [...],
  "limitUp": [
    { "name": "퍼스텍", "code": "010820", "price": 11870, "change": 29.97, "sector": "방산" },
    { "name": "금강철강", "code": "053260", "price": 8210, "change": 29.97, "sector": "철강" }
  ]
}
```

### 개별 종목 상세
```
GET /api/market-data?type=stock&code=005930
```

---

## 🔗 프론트엔드 연결

배포된 URL을 프론트엔드 아티팩트에서 호출:

```javascript
const API_URL = "https://your-project.vercel.app";

// 전체 데이터 가져오기
const res = await fetch(`${API_URL}/api/market-data`);
const data = await res.json();

// data.sectors → 주도섹터
// data.topVolume → 거래대금 상위
// data.limitUp → 상한가 종목
// data.market → 코스피/코스닥 지수
```

---

## ⚠️ 주의사항

- **API 호출 제한**: 초당 20회. 프론트에서 캐싱 필수
- **장 운영시간**: 09:00~15:30 (시간외 16:00~18:00)
- **모의투자 계좌**: 호출 제한 더 낮음. 실전계좌 권장
- **토큰 만료**: 24시간. 서버에서 자동 갱신됨

---

## 📁 파일 구조

```
sector-api/
├── api/
│   └── market-data.js    ← Vercel Serverless Function (메인 API)
├── lib/
│   └── kis.js            ← 한투 API 인증 + 호출 라이브러리
├── package.json
├── next.config.js
├── vercel.json
├── .env.example
└── README.md
```
