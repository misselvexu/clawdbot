#!/usr/bin/env bash
# Multi-user isolation deployment script
# Usage: bash docs/multi-user-architecture/deploy.sh
#
# Prerequisites:
#   - Docker installed and running
#   - Current user in docker group
#   - pnpm installed
#   - GCP credentials at ~/logibricks-ai-be334f6ac01d.json
#   - Discord bot token in ~/.openclaw/secrets/discord.env
set -euo pipefail

OPENCLAW_DIR="${OPENCLAW_DIR:-$HOME/openclaw}"
UNIT_FILE="$HOME/.config/systemd/user/openclaw-gateway.service"

echo "=== Step 1: Build source ==="
cd "$OPENCLAW_DIR"
pnpm build

echo "=== Step 2: Global install (requires root) ==="
sudo npm i -g "openclaw@file:$(pwd)"

echo "=== Step 3: Build sandbox base image ==="
scripts/sandbox-setup.sh
echo "Sandbox image built: openclaw-sandbox:bookworm-slim"
docker images | grep openclaw-sandbox || true

echo "=== Step 4: Backup existing config ==="
if [ -f "$HOME/.openclaw/config.json" ]; then
  cp "$HOME/.openclaw/config.json" "$HOME/.openclaw/config.json.bak.$(date +%Y%m%d%H%M%S)"
  echo "Config backed up."
else
  echo "No existing config found, skipping backup."
fi

echo "=== Step 5: Prepare staff workspace ==="
mkdir -p "$HOME/.openclaw/workspace-staff"
TEMPLATE_DIR="$OPENCLAW_DIR/docs/multi-user-architecture/staff-workspace-templates"
for file in SOUL.md AGENTS.md IDENTITY.md USER.md; do
  if [ -f "$TEMPLATE_DIR/$file" ] && [ ! -f "$HOME/.openclaw/workspace-staff/$file" ]; then
    cp "$TEMPLATE_DIR/$file" "$HOME/.openclaw/workspace-staff/$file"
    echo "  Seeded: $file"
  else
    echo "  Skipped (already exists or template missing): $file"
  fi
done

echo "=== Step 6: Install gateway service ==="
echo "WARNING: This will overwrite the systemd service file!"
echo "         Custom settings (--use-env-proxy, HTTPS_PROXY, Vertex AI, etc.) will be lost."
echo "         Step 7 will re-apply them."
openclaw gateway install --force

echo "=== Step 7: Patch systemd service file ==="

# 7a. ExecStart: add --use-env-proxy
# Reason: Node.js built-in fetch does not use system proxy by default.
# --use-env-proxy makes Node.js read HTTPS_PROXY so Discord traffic goes through the proxy tunnel.
sed -i 's|/bin/node |/bin/node --use-env-proxy |' "$UNIT_FILE"
echo "  [7a] Added --use-env-proxy to ExecStart"

# 7b. Proxy environment variables
# These are NOT automatically carried over by gateway install if the shell doesn't have them set.
grep -q "HTTPS_PROXY" "$UNIT_FILE" || {
  sed -i '/^\[Service\]/a Environment=HTTPS_PROXY=http://127.0.0.1:18080' "$UNIT_FILE"
  sed -i '/^\[Service\]/a Environment=HTTP_PROXY=http://127.0.0.1:18080' "$UNIT_FILE"
  sed -i '/^\[Service\]/a Environment=NO_PROXY=127.0.0.1,localhost,hgj.com,aihub.hgj.com,git.hgj.net,open.feishu.cn,*.feishu.cn,*.larksuite.com,*.larkoffice.com,*.volcengineapi.com,*.volces.com,*.googleapis.com,*.anthropic.com,*.openai.com,*.openrouter.ai,*.bing.com,*.microsoft.com,*.azure.com,speech.platform.bing.com' "$UNIT_FILE"
  echo "  [7b] Added HTTPS_PROXY/HTTP_PROXY/NO_PROXY"
}

# 7c. GCP / Vertex AI variables (gateway install does NOT add these!)
grep -q "CLAUDE_CODE_USE_VERTEX" "$UNIT_FILE" || {
  sed -i '/^\[Service\]/a Environment=CLAUDE_CODE_USE_VERTEX=1' "$UNIT_FILE"
  sed -i '/^\[Service\]/a Environment=ANTHROPIC_VERTEX_PROJECT_ID=logibricks-ai' "$UNIT_FILE"
  sed -i '/^\[Service\]/a Environment=GOOGLE_APPLICATION_CREDENTIALS=/home/misselvexu/logibricks-ai-be334f6ac01d.json' "$UNIT_FILE"
  sed -i '/^\[Service\]/a Environment=GOOGLE_CLOUD_PROJECT=logibricks-ai' "$UNIT_FILE"
  sed -i '/^\[Service\]/a Environment=GOOGLE_CLOUD_LOCATION=global' "$UNIT_FILE"
  sed -i '/^\[Service\]/a Environment=CLOUD_ML_REGION=us-east5' "$UNIT_FILE"
  sed -i '/^\[Service\]/a Environment=GEMINI_MODEL=gemini-3-pro-preview' "$UNIT_FILE"
  echo "  [7c] Added Vertex AI / GCP environment variables"
}

# 7d. Discord bot token (loaded via EnvironmentFile, never hardcoded)
grep -q "discord.env" "$UNIT_FILE" || {
  sed -i '/^\[Service\]/a EnvironmentFile=/home/misselvexu/.openclaw/secrets/discord.env' "$UNIT_FILE"
  echo "  [7d] Added Discord bot token EnvironmentFile"
}

# 7e. Startup dependency: discord proxy tunnel service
grep -q "discord-proxy-tunnel" "$UNIT_FILE" || {
  sed -i 's/^After=network-online.target/After=network-online.target discord-proxy-tunnel.service/' "$UNIT_FILE"
  sed -i 's/^Wants=network-online.target/Wants=network-online.target discord-proxy-tunnel.service/' "$UNIT_FILE"
  echo "  [7e] Added discord-proxy-tunnel.service dependency"
}

echo "=== Step 8: Reload and restart ==="
systemctl --user daemon-reload
systemctl --user restart openclaw-gateway

echo "=== Step 9: Verify ==="
sleep 3
systemctl --user status openclaw-gateway --no-pager || true
echo ""
echo "Run manually to verify channels:"
echo "  openclaw channels status --probe"
echo "  openclaw agents list --bindings"
echo ""
echo "=== Deployment complete ==="
