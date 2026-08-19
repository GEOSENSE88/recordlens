#!/usr/bin/env bash
#
# Record LENS 를 개인 서버(26sannam3.site)의 /recordlens/ 경로로 배포한다.
#
#   bash scripts/deploy-sannam.sh
#
# GitHub Pages(https://geosense88.github.io/recordlens/)와 같은 정적 번들을 쓴다.
# vite.pages.config.ts 의 base 가 "/recordlens/" 라서 두 주소 모두 그대로 동작한다.
#
# 서버에서는 새 폴더에 먼저 풀고 마지막에 폴더 이름만 바꾼다.
# 압축을 푸는 동안 반쯤 갱신된 파일이 보이는 일을 막기 위해서다.

set -euo pipefail

HOST="${SANNAM_HOST:-ubuntu@140.245.50.83}"
KEY="${SANNAM_KEY:-$HOME/.ssh/id_ed25519}"
REMOTE_DIR="/var/www/recordlens"
URL="https://26sannam3.site/recordlens/"

cd "$(dirname "$0")/.."

echo "[1/4] 정적 번들 빌드"
npm run build:pages

echo "[2/4] 압축 후 서버로 전송"
TARBALL="$(mktemp -t recordlens-XXXXXX).tgz"
trap 'rm -f "$TARBALL"' EXIT
tar -czf "$TARBALL" -C pages-dist .
scp -i "$KEY" "$TARBALL" "$HOST:/tmp/recordlens-dist.tgz"

echo "[3/4] 서버에 반영"
ssh -i "$KEY" "$HOST" "set -e
  sudo rm -rf ${REMOTE_DIR}.new
  sudo mkdir -p ${REMOTE_DIR}.new
  sudo tar -xzf /tmp/recordlens-dist.tgz -C ${REMOTE_DIR}.new
  sudo chown -R www-data:www-data ${REMOTE_DIR}.new
  sudo find ${REMOTE_DIR}.new -type d -exec chmod 755 {} \;
  sudo find ${REMOTE_DIR}.new -type f -exec chmod 644 {} \;
  sudo rm -rf ${REMOTE_DIR}.old
  if [ -d ${REMOTE_DIR} ]; then sudo mv ${REMOTE_DIR} ${REMOTE_DIR}.old; fi
  sudo mv ${REMOTE_DIR}.new ${REMOTE_DIR}
  rm -f /tmp/recordlens-dist.tgz"

echo "[4/4] 배포 확인"
CODE="$(curl -s -o /dev/null -w '%{http_code}' "$URL")"
if [ "$CODE" != "200" ]; then
  echo "확인 실패: $URL 가 $CODE 를 돌려줬다. 서버에서 sudo mv ${REMOTE_DIR}.old ${REMOTE_DIR} 로 되돌릴 수 있다." >&2
  exit 1
fi
echo "완료: $URL"
