#!/bin/bash
# Segarkan cookie sesi Instagram untuk instagram_engine.py.
# Sumber: profil browser-agent google_aionly (yang login IG).
# Tujuan: /root/.config/yt-dlp/ig_cookies.txt (dibaca instagrapi & yt-dlp).
set -euo pipefail

TMP_JSON=$(mktemp /tmp/ig_cookies.XXXXXX.json)
trap 'rm -f "$TMP_JSON"' EXIT

node -e '
const fs = require("fs");
const patchright = require("/root/browser-agent/node_modules/patchright");
(async () => {
  const ctx = await patchright.chromium.launchPersistentContext("/root/browser-agent/profiles/google_aionly", { headless: true });
  const ig = (await ctx.cookies()).filter(c => /instagram\.com/.test(c.domain));
  fs.writeFileSync(process.argv[1], JSON.stringify(ig));
  console.log("[ig_session_refresh] cookies IG terbaca:", ig.length);
  if (!ig.some(c => c.name === "sessionid")) {
    console.error("[ig_session_refresh] TIDAK ada sessionid — login IG di profil google_aionly perlu diulang.");
    process.exit(2);
  }
  await ctx.close();
})().catch(e => { console.error("[ig_session_refresh]", e.message); process.exit(1); });
' "$TMP_JSON"

python3 - "$TMP_JSON" <<'PYEOF'
import json, sys, time
cookies = json.load(open(sys.argv[1]))
lines = ["# Netscape HTTP Cookie File",
         "# Instagram session — refresh via scripts/ig_session_refresh.sh", ""]
for c in cookies:
    exp = int(c.get('expires') or 0) or int(time.time()) + 3600 * 24 * 365
    lines.append("\t".join([c['domain'], "TRUE", c.get('path', '/'),
                            "TRUE" if c.get('secure') else "FALSE",
                            str(exp), c['name'], c['value']]))
out = "/root/.config/yt-dlp/ig_cookies.txt"
open(out, "w").write("\n".join(lines) + "\n")
print("[ig_session_refresh] ditulis ->", out)
PYEOF

chmod 600 /root/.config/yt-dlp/ig_cookies.txt
