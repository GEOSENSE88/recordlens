# 과세특 점검 도우미

NEIS에서 내려받은 반별 엑셀 파일을 병합하고, 교과 세부능력 및 특기사항의 중복·유사 문장을 점검하는 웹앱입니다.

## 실행 주소

- GitHub Pages: https://geosense88.github.io/gwase-teuk-checker/
- Sites: https://gwase-teuk-checker.geosense.chatgpt.site/

## 개인정보 처리

- 선택한 엑셀 파일은 사용자의 브라우저 안에서만 처리됩니다.
- 학생 기록을 별도 서버나 GitHub로 업로드하지 않습니다.
- `.xls`, `.xlsx`, `.xlsm`, `.xlsb` 파일은 Git 커밋 대상에서 제외되어 있습니다.

## 주요 기능

- 여러 반의 NEIS 엑셀 파일 동시 분석
- 교과 세부능력 및 특기사항 열 자동 탐색
- 완전 일치 및 유사 문장 비교
- 과목별 현황과 위험도 필터
- 점검 결과 엑셀 다운로드
- 익명 예시 자료로 기능 체험

## 로컬 실행

Node.js 22.13 이상이 필요합니다.

```bash
npm ci
npm run dev
```

프로덕션 빌드:

```bash
npm run build
```

GitHub Pages용 정적 빌드:

```bash
npm run build:pages
```

## 배포

- `main` 브랜치가 갱신되면 GitHub Pages가 자동 배포됩니다.
- Docker 이미지는 `ghcr.io/geosense88/gwase-teuk-checker:latest`로 게시됩니다.
- Docker 및 서버 배포 방법은 [DEPLOYMENT.md](./DEPLOYMENT.md)를 참고하세요.
