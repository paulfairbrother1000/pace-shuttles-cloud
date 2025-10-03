#!/usr/bin/env bash
set -euo pipefail

CSV="./storage_images_missing.csv"
TARGET_BASE="./supabase/storage/images"
SEARCH_DIR="$HOME/Downloads"          # set to "$HOME/Downloads" if you prefer
DRY=0                       # set to 1 for a dry run (no copies)

if [[ ! -f "$CSV" ]]; then
  echo "CSV not found at: $CSV"
  exit 1
fi

echo "Using CSV: $CSV"
echo "Search dir: $SEARCH_DIR"
echo "Target base: $TARGET_BASE"
echo

total=0; found=0; copied=0; notfound=0; prompted=0

# normalize a string for fuzzy matching (lowercase, remove non-alnum)
norm() {
  echo "$1" | tr '[:upper:]' '[:lower:]' | tr -cd '[:alnum:]'
}

search_one() {
  local needle="$1"
  local path=""

  # 1) exact filename via Spotlight
  if command -v mdfind >/dev/null 2>&1; then
    path=$(mdfind -onlyin "$SEARCH_DIR" "kMDItemFSName == '$needle'" | head -n 1 || true)
  fi

  # 2) exact filename via find
  if [[ -z "$path" ]]; then
    path=$(find "$SEARCH_DIR" -type f -iname "$needle" -print -quit 2>/dev/null || true)
  fi

  # 3) fuzzy (strip punctuation and compare normalized names)
  if [[ -z "$path" ]]; then
    local nneedle nfile
    nneedle=$(norm "$needle")
    # walk a limited depth first to keep speed reasonable
    while IFS= read -r f; do
      nfile=$(norm "$(basename "$f")")
      if [[ "$nfile" == "$nneedle" ]]; then path="$f"; break; fi
    done < <(find "$SEARCH_DIR" -type f -maxdepth 6 2>/dev/null)
  fi

  echo "$path"
}

manual_pick() {
  local key="$1"
  local picked=""

  # macOS file picker if available
  if command -v osascript >/dev/null 2>&1; then
    echo "   ⏹  Couldn’t auto-find a file for:"
    echo "       $key"
    echo "   ▶  Choose a replacement in the dialog (or Cancel to skip)…"
    picked=$(osascript <<'APPLESCRIPT'
      set dlg to choose file with prompt "Select a replacement image" of type {"public.jpeg", "public.png", "public.tiff", "public.heic"} default location (path to downloads folder)
      POSIX path of dlg
APPLESCRIPT
    ) || true
    if [[ -n "$picked" ]]; then echo "$picked"; return 0; fi
  fi

  # CLI prompt fallback
  read -rp "   Enter full path to replacement image (or leave blank to skip): " picked
  echo "$picked"
}

first=1
while IFS= read -r line; do
  [[ -z "$line" ]] && continue

  if (( first )); then
    first=0
    hdr=$(echo "$line" | tr -d '\r"')
    [[ "$hdr" =~ ^key($|,) ]] && continue
  fi

  total=$((total+1))
  key=$(echo "$line" | awk -F',' '{print $1}' | tr -d '"\r')
  [[ -z "$key" ]] && continue

  filename="${key##*/}"
  echo "[$total] Need: $filename"

  dest_dir="$TARGET_BASE/$(dirname "$key")"
  dest_path="$TARGET_BASE/$key"

  path="$(search_one "$filename")"

  if [[ -z "$path" ]]; then
    prompted=$((prompted+1))
    picked="$(manual_pick "$key")"
    if [[ -n "$picked" && -f "$picked" ]]; then
      path="$picked"
      echo "   ✓ Using manual selection: $path"
    else
      echo "   ✗ NOT FOUND / SKIPPED"
      notfound=$((notfound+1))
      continue
    fi
  else
    echo "   ✓ Found: $path"
    found=$((found+1))
  fi

  echo "   → Stage to: $dest_path"
  if (( DRY )); then
    continue
  fi
  mkdir -p "$dest_dir"
  cp -f "$path" "$dest_path" && copied=$((copied+1))
done < "$CSV"

echo
echo "Done."
echo "  Total keys:        $total"
echo "  Auto-found:         $found"
echo "  Manually selected:  $prompted"
echo "  Copied/staged:      $copied"
echo "  Not found:          $notfound"
