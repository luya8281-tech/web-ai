#!/usr/bin/env bash
# Deploy ai-chat tanpa mematikan server saat build.
#
# Alur:
#   1. build ke .next.new  -> server lama TETAP melayani .next
#   2. kalau build gagal   -> server tidak disentuh sama sekali
#   3. tukar folder (cepat) -> restart PM2 (~1 detik)
#   4. kalau setelah restart tidak hidup -> rollback ke .next.old
#
# Pakai: bash scripts/deploy.sh
set -uo pipefail

APP_DIR="/root/ai-chat"
NEW_DIR="$APP_DIR/.next.new"
OLD_DIR="$APP_DIR/.next.old"
LOG="/tmp/opencode/ai-chat-build.log"
PORT=3010
START_TS=$(date +%s)

# Laporan machine-readable untuk detached-jobs (diisi oleh pembungkus job).
# Kalau tidak di-set, deploy manual dari terminal tidak menulis file apa pun.
RESULT_FILE="${AICHAT_DEPLOY_RESULT:-}"

write_result() {
  # $1=status $2=ok(true/false) $3=buildId $4=onlineInSec $5=exitCode $6=tail
  [ -n "$RESULT_FILE" ] || return 0
  local status="$1" ok="$2" build_id="$3" online="$4" code="$5" tail_txt="$6"
  tail_txt="$(printf '%s' "$tail_txt" | tr '\n' '~' | sed 's/\\/\\\\/g; s/"/\\"/g')"
  printf '{"status":"%s","ok":%s,"buildId":"%s","elapsedSec":%s,"onlineInSec":"%s","exitCode":%s,"tail":"%s","finishedAt":%s}\n' \
    "$status" "$ok" "$build_id" "$(( $(date +%s) - START_TS ))" "$online" "$code" "$tail_txt" "$(date +%s%3N)" \
    > "$RESULT_FILE.tmp" && mv "$RESULT_FILE.tmp" "$RESULT_FILE"
}

tail_log() { tail -n 20 "$1" 2>/dev/null; }

cd "$APP_DIR" || exit 1
mkdir -p /tmp/opencode

# Cegah dua deploy berjalan bersamaan.
exec 9>/tmp/opencode/ai-chat-deploy.lock
if ! flock -n 9; then
  echo "[deploy] deploy lain masih berjalan. Batal."
  write_result skipped_locked false "" "" 1 "deploy lain masih berjalan"
  exit 1
fi

health() {
  local code
  code=$(curl -s -m 2 -o /dev/null -w "%{http_code}" "http://127.0.0.1:${PORT}/" 2>/dev/null)
  [ "$code" = "307" ] || [ "$code" = "200" ]
}

echo "[deploy] build ke .next.new (server lama tetap jalan)..."
rm -rf "$NEW_DIR"
if ! NEXT_DIST_DIR=.next.new npm run build >"$LOG" 2>&1; then
  echo "[deploy] BUILD GAGAL. Server lama tidak disentuh."
  echo "[deploy] 30 baris terakhir log:"
  tail -30 "$LOG"
  rm -rf "$NEW_DIR"
  write_result build_failed false "" "" 1 "$(tail_log "$LOG")"
  exit 1
fi

if [ ! -f "$NEW_DIR/BUILD_ID" ]; then
  echo "[deploy] build selesai tapi BUILD_ID tidak ada. Batal."
  rm -rf "$NEW_DIR"
  write_result build_failed false "" "" 1 "BUILD_ID tidak ada setelah build"
  exit 1
fi

BUILD_ID="$(cat "$NEW_DIR/BUILD_ID" 2>/dev/null)"
echo "[deploy] build sukses (build $BUILD_ID). Menukar folder..."
rm -rf "$OLD_DIR"
if ! mv "$APP_DIR/.next" "$OLD_DIR" 2>/dev/null; then
  echo "[deploy] tidak ada .next lama; memakai hasil build baru."
  rm -rf "$OLD_DIR"
fi
if ! mv "$NEW_DIR" "$APP_DIR/.next"; then
  echo "[deploy] gagal menukar folder"
  write_result swap_failed false "$BUILD_ID" "" 1 "gagal menukar folder .next"
  exit 1
fi

echo "[deploy] restart ai-chat..."
pm2 startOrReload /root/ai-chat/ecosystem.config.js --update-env >/dev/null 2>&1

ok=0
online_in=""
for i in $(seq 1 30); do
  sleep 1
  if health; then
    echo "[deploy] online dalam ${i}s. Selesai."
    ok=1
    online_in="$i"
    break
  fi
done

if [ "$ok" = "1" ]; then
  rm -rf "$OLD_DIR"
  write_result success true "$BUILD_ID" "$online_in" 0 ""
  exit 0
fi

echo "[deploy] server tidak merespons -> ROLLBACK ke build sebelumnya..."
rm -rf "$APP_DIR/.next"
if [ -d "$OLD_DIR" ]; then
  mv "$OLD_DIR" "$APP_DIR/.next"
  pm2 startOrReload /root/ai-chat/ecosystem.config.js --update-env >/dev/null 2>&1
  for i in $(seq 1 20); do
    sleep 1
    if health; then
      echo "[deploy] rollback berhasil, online dalam ${i}s."
      write_result rolled_back false "$BUILD_ID" "" 1 "server baru tak sehat, build lama dipulihkan"
      exit 1
    fi
  done
fi
echo "[deploy] rollback gagal. Cek: pm2 logs ai-chat --lines 80"
write_result rollback_failed false "$BUILD_ID" "" 1 "rollback gagal, cek pm2 logs ai-chat"
exit 1
