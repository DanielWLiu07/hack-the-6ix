#!/bin/bash
# Optimize heavy Meshy deco GLBs -> web-usable .min.glb (aggressive geometry
# decimation + 512 webp textures + quantize). Re-runnable: skips props that are
# already small (<2MB), so it can be run repeatedly as new gens land.
cd "$(dirname "$0")/.." || exit 1
for f in barrel haybale basket monitor server harddrive battery robotarm floppy chip database magnifier; do
  raw="public/assets/$f.glb"
  min="public/assets/$f.min.glb"
  [ -f "$raw" ] || continue
  if [ -f "$min" ]; then
    sz=$(stat -f%z "$min" 2>/dev/null || echo 0)
    [ "$sz" -lt 2000000 ] && { echo "skip $f (already small)"; continue; }
  fi
  npx @gltf-transform/cli optimize "$raw" "$min" \
    --simplify-error 0.01 --texture-size 512 --texture-compress webp --compress quantize \
    >/dev/null 2>&1 \
    && echo "opt $f -> $(stat -f%z "$min" 2>/dev/null) bytes" \
    || echo "FAIL $f"
done
