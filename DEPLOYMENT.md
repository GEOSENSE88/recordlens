# Record LENS 배포 안내

이 웹앱은 업로드한 엑셀 파일을 브라우저 안에서만 처리합니다. 학생 기록 파일은 서버나 GitHub로 전송되지 않습니다.

> 저장소 이름을 `gwase-teuk-checker`에서 `recordlens`로 바꾼 뒤에야 아래 주소가 동작합니다.
> GitHub 저장소 Settings → General → Repository name에서 변경하세요. GitHub가 옛 주소를
> 새 주소로 자동 리다이렉트하므로 기존 링크도 당분간 함께 열립니다.

## GitHub Pages

`main` 브랜치에 변경 사항이 올라가면 GitHub Actions가 정적 사이트를 빌드해 아래 주소에 게시합니다.

```text
https://geosense88.github.io/recordlens/
```

## 개인 서버 (26sannam3.site)

GitHub Pages 주소가 막히거나 느릴 때를 대비해 같은 번들을 개인 서버에도 올려 둔다.

```text
https://26sannam3.site/recordlens/
```

배포는 아래 한 줄이면 끝난다. 빌드 → 전송 → 교체 → 확인까지 스크립트가 처리한다.

```bash
bash scripts/deploy-sannam.sh
```

서버 쪽 구성은 다음과 같다.

- 파일 위치: `/var/www/recordlens/` (소유자 `www-data`)
- nginx 설정: `/etc/nginx/sites-enabled/default` 안의 `SANNAM_RECORDLENS_START ~ END` 구간.
  `26sannam3.site` 와 `www.26sannam3.site` 두 서버 블록에 같은 내용이 들어 있다.
  `sites-available/default` 는 오래된 사본이라 실제로 쓰이지 않으니 반드시 `sites-enabled/default` 를 고친다.
- 이 경로는 로그인 없이 열린다. 나머지 화면과 달리 학생 데이터를 서버에 두지 않는 도구라서다.

되돌리려면 서버에서 직전 판을 다시 붙인다.

```bash
sudo rm -rf /var/www/recordlens && sudo mv /var/www/recordlens.old /var/www/recordlens
```

## GitHub Actions와 컨테이너 이미지

`main` 브랜치에 변경 사항이 올라가면 GitHub Actions가 Docker 이미지를 빌드해 아래 주소에 게시합니다.

```text
ghcr.io/geosense88/recordlens:latest
```

저장소와 컨테이너 패키지가 비공개인 동안에는 서버에서 GitHub Personal Access Token으로 먼저 로그인해야 합니다. 토큰에는 `read:packages` 권한이 필요합니다.

```bash
echo "$GHCR_TOKEN" | docker login ghcr.io -u GEOSENSE88 --password-stdin
```

## Docker Compose 배포

서버에 `compose.yaml`을 복사한 뒤 다음 명령을 실행합니다.

```bash
docker compose pull
docker compose up -d
docker compose ps
```

기본 포트는 `3000`입니다. 다른 호스트 포트를 사용하려면 다음처럼 지정할 수 있습니다.

```bash
APP_PORT=8080 docker compose up -d
```

새 버전을 반영할 때는 아래 명령을 다시 실행합니다.

```bash
docker compose pull
docker compose up -d
```

## 서버에서 직접 빌드

GitHub Container Registry를 사용하지 않고 소스에서 직접 빌드할 수도 있습니다.

```bash
docker build -t recordlens .
docker run -d \
  --name recordlens \
  --restart unless-stopped \
  -p 3000:3000 \
  recordlens
```

## 운영 점검

컨테이너가 실행된 뒤 다음 주소가 HTTP 200을 반환하는지 확인합니다.

```bash
curl -I http://127.0.0.1:3000/
```

외부 도메인으로 제공할 때는 Nginx, Caddy 또는 서버 관리 패널에서 해당 포트로 역방향 프록시를 연결하고 HTTPS를 적용합니다.
