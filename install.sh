#!/usr/bin/env bash
# Install the outreach skills into Claude Code / Claude Desktop.
#   ./install.sh            copy the skills into ~/.claude/skills
#   ./install.sh --link     symlink them instead (edits in this repo take effect at once)
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST="${CLAUDE_SKILLS_DIR:-$HOME/.claude/skills}"
LINK=0
[ "${1:-}" = "--link" ] && LINK=1

command -v node >/dev/null || { echo "Node.js is required (v20+). Install it from https://nodejs.org and run this again."; exit 1; }
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 20 ] || { echo "Node $NODE_MAJOR found; v20+ is required."; exit 1; }

mkdir -p "$DEST" "$HOME/.claude/artist-reach"

for s in youtube-artist-scout x-artist-scout podcast-scout patreon-scout artist-reach-run; do
  target="$DEST/$s"
  if [ -e "$target" ] || [ -L "$target" ]; then
    echo "~ $s already exists in $DEST — moving it to $s.backup"
    rm -rf "$target.backup"
    mv "$target" "$target.backup"
  fi
  if [ "$LINK" = "1" ]; then
    ln -s "$HERE/skills/$s" "$target"
    echo "→ linked $s"
  else
    cp -R "$HERE/skills/$s" "$target"
    echo "+ installed $s"
  fi
done

# Pitch templates, where the runner and tools/pitch.mjs look for them.
cp "$HERE/pitch/shared.js" "$HOME/.claude/artist-reach/shared.js"
echo "+ pitch templates → ~/.claude/artist-reach/shared.js"

echo
echo "Installing npm dependencies (youtubei.js, playwright-core)…"
( cd "$DEST/youtube-artist-scout/scripts" && npm install --silent --no-audit --no-fund )
( cd "$DEST/x-artist-scout/scripts" && npm install --silent --no-audit --no-fund )

# A starting point for the Gmail accounts, if there isn't one yet.
if [ ! -f "$HOME/.claude/artist-reach/senders.json" ]; then
  cp "$HERE/senders.example.json" "$HOME/.claude/artist-reach/senders.example.json"
  echo "+ Gmail account template → ~/.claude/artist-reach/senders.example.json"
  echo "  Fill it in, save it as senders.json, then: node tools/draft-gmail.mjs --test"
  echo "  (see docs/gmail-setup.md)"
fi

echo
echo "Done. Restart Claude Code, then try:"
echo "  \"scout YouTube for indie artists in Denver and Austin\""
echo "  \"find 40 independent podcasters with no website\""
echo
echo "Smoke test without Claude:"
echo "  node \"$DEST/podcast-scout/scripts/scout.mjs\" --terms \"horror movie podcast\" --limit 5"
echo
echo "To draft into Gmail, set up the accounts first: docs/gmail-setup.md"
