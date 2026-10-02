#!/usr/bin/env bash
# 《千軍令》台灣中文語音產生器（macOS 內建 say + afconvert，不需任何 API key）
#
# 用法：
#   bash scripts/gen_voice.sh                 # 全部重新產生
#   bash scripts/gen_voice.sh ack_move victory # 只產生指定台詞
#   VOICE='Reed (中文（台灣）)' bash scripts/gen_voice.sh   # 改用其他 zh_TW 聲音（男聲：Eddy/Reed/Rocko/Grandpa）
#   RATE_SCALE=1.1 bash scripts/gen_voice.sh  # 整體語速倍率
#
# 輸出：public/assets/voice/<VoiceId>.m4a（AAC，單聲道）
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/public/assets/voice"
mkdir -p "$OUT"

if ! command -v say >/dev/null 2>&1 || ! command -v afconvert >/dev/null 2>&1; then
  echo "需要 macOS 的 say 與 afconvert" >&2
  exit 1
fi

# 選聲音：優先 Meijia（品質最好的台灣中文），否則第一個 zh_TW 聲音
if [[ -z "${VOICE:-}" ]]; then
  if say -v '?' | grep -q '^Meijia '; then
    VOICE="Meijia"
  else
    VOICE="$(say -v '?' | grep 'zh_TW' | head -1 | sed -E 's/[[:space:]]+zh_TW.*$//')"
  fi
fi
if [[ -z "$VOICE" ]]; then
  echo "找不到台灣中文（zh_TW）聲音，請到「系統設定 → 輔助使用 → 朗讀內容」下載 Meijia" >&2
  exit 1
fi
RATE_SCALE="${RATE_SCALE:-1}"
echo "聲音：$VOICE（語速倍率 $RATE_SCALE）"

# 暫存目錄（只放本腳本產生的 aiff，結束時逐檔清掉）
TMP="$(mktemp -d "${TMPDIR:-/tmp}/qjl_voice.XXXXXX")"
cleanup() {
  for f in "$TMP"/*.aiff; do [[ -e "$f" ]] && rm -f "$f"; done
  rmdir "$TMP" 2>/dev/null || true
}
trap cleanup EXIT

# 台詞表：id|語速（字/分）|台詞 —— 命令口吻語速偏快，敗戰、陣亡放慢
LINES=$(cat <<'EOF'
ack_move|230|遵命！
ack_attack|240|殺！
ack_charge|240|衝鋒！
ack_retreat|240|撤！
ack_hold|225|堅守陣地！
enemy_depot_burning|220|敵軍糧倉起火了！
our_depot_burning|225|我軍糧倉遭襲！
enemy_depot_burnt|215|敵軍糧草已焚，軍心大亂！
our_depot_burnt|205|糧倉失守，軍心動搖！
general_down|190|將軍陣亡！
enemy_routing|225|敵軍潰逃了！
our_routing|220|我軍有部隊潰逃！
victory|200|大獲全勝！
defeat|150|全軍潰敗……
battle_start|210|全軍聽令，進攻！
EOF
)

want=("$@")
count=0
while IFS='|' read -r id rate text; do
  [[ -z "$id" ]] && continue
  if [[ ${#want[@]} -gt 0 ]]; then
    hit=0
    for w in "${want[@]}"; do [[ "$w" == "$id" ]] && hit=1; done
    [[ $hit -eq 0 ]] && continue
  fi
  r=$(awk -v a="$rate" -v s="$RATE_SCALE" 'BEGIN { printf "%d", a * s }')
  aiff="$TMP/$id.aiff"
  say -v "$VOICE" -r "$r" -o "$aiff" "$text"
  # AAC 單聲道，品質最高；m4af 容器（瀏覽器 decodeAudioData 可直接解）
  afconvert -f m4af -d aac -c 1 -q 127 "$aiff" "$OUT/$id.m4a"
  dur=$(afinfo "$OUT/$id.m4a" | awk '/estimated duration/ { printf "%.2f", $3 }')
  printf '  %-22s %5ss  %s\n' "$id.m4a" "$dur" "$text"
  count=$((count + 1))
done <<< "$LINES"

echo "完成 $count 句 → $OUT"
