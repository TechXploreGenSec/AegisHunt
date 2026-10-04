#!/usr/bin/env bash
# fetch-methodology.sh — first-run bootstrap for the knowledge layer.
# Clones HackTricks src (sparse, depth 1) and community skill packs the
# agents are instructed to consult. Idempotent — skips whatever exists.
# Run once per machine (setup.sh calls this automatically).
set -euo pipefail

command -v git >/dev/null 2>&1 || { echo "git required" >&2; exit 2; }

SKILLS_DIR="${SKILLS_DIR:-$HOME/.config/opencode/skills}"
HT_DIR="${HT_DIR:-$HOME/hacktricks}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# --- 1. HackTricks src (sparse: src/ only, no history) -------------------------
if [[ -d "$HT_DIR/src" ]]; then
  echo "hacktricks src present, skipping"
else
  echo "cloning hacktricks src/ ..."
  git clone --depth 1 --filter=blob:none --sparse https://github.com/HackTricks-wiki/hacktricks.git "$HT_DIR"
  git -C "$HT_DIR" sparse-checkout set src
fi

# --- 2. agentic-bug-hunter skills (distinctive names, copy as-is) ---------------
if [[ -d "$SKILLS_DIR/bb-methodology" ]]; then
  echo "agentic-bug-hunter skills present, skipping"
else
  echo "fetching agentic-bug-hunter skills ..."
  git clone --depth 1 https://github.com/awarexone/agentic-bug-hunter.git "$TMP/abh"
  mkdir -p "$SKILLS_DIR"
  for d in "$TMP/abh/skills/"*/; do
    [[ -f "$d/SKILL.md" ]] || [[ -f "$d/skill.md" ]] || continue
    cp -a "$d" "$SKILLS_DIR/"
  done
fi

# --- 3. recon-skills packs (generic dir names -> prefixed, only SKILL.md holders) --
if ls -d "$SKILLS_DIR"/recon-skills-* >/dev/null 2>&1; then
  echo "recon-skills packs present, skipping"
else
  echo "fetching recon-skills packs ..."
  git clone --depth 1 https://github.com/uphiago/recon-skills.git "$TMP/rs"
  mkdir -p "$SKILLS_DIR"
  for d in "$TMP/rs/"*/; do
    name="$(basename "$d")"
    case "$name" in
      .git|scripts|assets) continue ;;
    esac
    if [[ -f "$d/SKILL.md" ]]; then
      cp -a "$d" "$SKILLS_DIR/recon-skills-$name"
    else
      # pack without top-level SKILL.md: keep structure under one folder
      mkdir -p "$SKILLS_DIR/recon-skills-pack"
      cp -a "$d" "$SKILLS_DIR/recon-skills-pack/"
    fi
  done
fi

echo "knowledge layer ready: $HT_DIR/src + $SKILLS_DIR"
echo "next: run methodology_index_build, then hunt."
