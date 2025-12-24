#!/usr/bin/env zsh
VOICES_DIR="/Users/davidcaballero/gengems/apps/gen_avatar_debate/public/assets/voices"
OUT="$VOICES_DIR/index.json"
print -r -- "{" > "$OUT"
first=1
for f in "$VOICES_DIR"/*.json(N); do
  name=${f:t:r}
  meta=$(cat "$f")
  [[ $first -eq 0 ]] && print -r -- "," >> "$OUT"
  print -r -- "\"$name\": $meta" >> "$OUT"
  first=0
done
print -r -- "}" >> "$OUT"
echo "wrote $OUT"
