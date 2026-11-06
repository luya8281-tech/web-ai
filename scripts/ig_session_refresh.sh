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
import json, re, sys, time
cookies = json.load(open(sys.argv[1]))
lines = ["# Netscape HTTP Cookie File",
         "# Instagram session — refresh via scripts/ig_session_refresh.sh", ""]
sid = None
uid = None
for c in cookies:
    if c['name'] == 'sessionid': sid = c['value']
    if c['name'] == 'ds_user_id': uid = c['value']
    exp = int(c.get('expires') or 0) or int(time.time()) + 3600 * 24 * 365
    lines.append("\t".join([c['domain'], "TRUE", c.get('path', '/'),
                            "TRUE" if c.get('secure') else "FALSE",
                            str(exp), c['name'], c['value']]))
out = "/root/.config/yt-dlp/ig_cookies.txt"
open(out, "w").write("\n".join(lines) + "\n")
print("[ig_session_refresh] ditulis ->", out)

# engine membaca INSTAGRAM_SESSION_ID dari .env.local dengan PRIORITAS di atas
# file cookie — kalau tidak ikut disinkron, sesi basi di .env menang diam-diam.
env_path = "/root/ai-chat/.env.local"
try:
    text = open(env_path).read()
    changed = False
    if sid and "INSTAGRAM_SESSION_ID=" in text:
        new = re.sub(r'^INSTAGRAM_SESSION_ID=.*$', f'INSTAGRAM_SESSION_ID="{sid}"', text, flags=re.M)
        changed |= new != text; text = new
    if uid and "INSTAGRAM_USER_ID=" in text:
        new = re.sub(r'^INSTAGRAM_USER_ID=.*$', f'INSTAGRAM_USER_ID="{uid}"', text, flags=re.M)
        changed |= new != text; text = new
    if changed:
        open(env_path, "w").write(text)
        print("[ig_session_refresh] .env.local ikut disinkron")
except Exception as e:
    print("[ig_session_refresh] WARN sinkron .env.local gagal:", e)
PYEOF

chmod 600 /root/.config/yt-dlp/ig_cookies.txt
