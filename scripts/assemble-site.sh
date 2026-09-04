#!/bin/sh
# Assembles the deployable site into a directory: copies index.html along with
# every asset it references, then rewrites each ?v= cache buster to a hash of
# the file it points at.
#
# GitHub Pages serves assets with max-age=600, so a deploy without a fresh
# query leaves browsers on the old script for up to 10 minutes. Deriving the
# value from the file means an unchanged asset keeps its query and stays
# cached, while a changed one always gets a new URL.
#
# index.html is the only list of assets: anything it references with a ?v=
# query gets copied. Adding a script therefore means editing one file instead
# of three, and a reference with no matching file stops the run rather than
# shipping a 404. PR #6 shipped one because the copy list was kept by hand
# here and nobody updated it when sheet.js appeared.
#
# Usage: scripts/assemble-site.sh <directory>
set -eu

root=$(cd "$(dirname "$0")/.." && pwd)
out=${1:?usage: scripts/assemble-site.sh <directory>}

hash_of() {
  # Piping straight into cut would hand back cut's exit status and hide a
  # missing file, which is how an empty ?v= reached production once.
  _sum=$(if command -v md5 >/dev/null 2>&1; then md5 -q "$1"; else md5sum "$1"; fi)
  echo "$_sum" | cut -c1-8
}

# The local assets index.html points at, in the order it names them.
assets=$(grep -oE '(src|href)="[^"]+\?v=[^"]*"' "$root/index.html" \
  | sed -e 's/^[^"]*"//' -e 's/\?v=.*//')

if [ -z "$assets" ]; then
  echo "assemble-site: index.html references no ?v= assets" >&2
  exit 1
fi

mkdir -p "$out"
cp "$root/index.html" "$out/"
for asset in $assets; do
  cp "$root/$asset" "$out/"
done

cd "$out"
for asset in $assets; do
  version=$(hash_of "$asset")
  if [ -z "$version" ]; then
    echo "assemble-site: no hash for $asset" >&2
    exit 1
  fi
  perl -pi -e "s/\Q$asset\E\?v=[A-Za-z0-9]*/$asset?v=$version/g" index.html
done

grep -oE '[A-Za-z0-9.-]+\.(css|js)\?v=[A-Za-z0-9]*' index.html
