#!/bin/sh
# Rewrites the ?v= cache buster in index.html so each asset carries a hash of
# its own contents. Deriving the value from the file means an unchanged asset
# keeps its query and stays cached, while a changed one always gets a new URL.
#
# Usage: scripts/bump-cache-buster.sh [directory]   (defaults to the repo root)
# The deploy workflow points it at the assembled _site directory, so the value
# committed to index.html is never the one that matters.
set -eu

root=$(cd "$(dirname "$0")/.." && pwd)
cd "${1:-$root}"

hash_of() {
  if command -v md5 >/dev/null 2>&1; then
    md5 -q "$1" | cut -c1-8
  else
    md5sum "$1" | cut -c1-8
  fi
}

for asset in style.css chords.js main.js; do
  version=$(hash_of "$asset")
  perl -pi -e "s/\Q$asset\E\?v=[A-Za-z0-9]+/$asset?v=$version/g" index.html
done

grep -o '[a-z]*\.\(css\|js\)?v=[A-Za-z0-9]*' index.html
