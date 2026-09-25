#!/usr/bin/env bash
# Rebuilds the podcast feed from the manifests already in R2 and publishes it as podcast.xml. It reads only files that
# exist and costs nothing (no Sarvam), so it is safe to run at any time. Used by audio.yml (after each recording) and
# by podcast.yml (by hand).  Needs: aws CLI credentials in the environment, R2_BUCKET, R2_ENDPOINT, R2_PUBLIC_URL.
#   FEED_DRY=1  build and check the feed but do not upload it
set -euo pipefail
cd "$(dirname "$0")"
: "${R2_BUCKET:?R2_BUCKET is not set}" "${R2_ENDPOINT:?R2_ENDPOINT is not set}" "${R2_PUBLIC_URL:?R2_PUBLIC_URL is not set}"
R2_PUBLIC_URL="${R2_PUBLIC_URL%/}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

aws s3 sync "s3://$R2_BUCKET/audio/" "$WORK/manifests" --exclude '*' --include '*/manifest.json' \
  --endpoint-url "$R2_ENDPOINT" --only-show-errors
echo "manifests found: $(find "$WORK/manifests" -name manifest.json | wc -l | tr -d ' ')"

# Fails (and publishes nothing) if there are no usable episodes or the feed does not pass its own checks.
SITE_ARGS=()
[ -n "${PODCAST_SITE:-}" ] && SITE_ARGS=(--site "$PODCAST_SITE")          # only the tests set this
node podcast.mjs --audio "$WORK/manifests" --audio-base "$R2_PUBLIC_URL" --feed-url "$R2_PUBLIC_URL/podcast.xml" --out "$WORK/podcast.xml" --episodes-out "$WORK/episodes.json" ${SITE_ARGS[@]+"${SITE_ARGS[@]}"}

if [ "${FEED_DRY:-}" = "1" ]; then
  echo "FEED_DRY=1: not uploading. Feed is at $WORK/podcast.xml"; cat "$WORK/podcast.xml" | head -40; exit 0
fi

aws s3 cp "$WORK/podcast.xml" "s3://$R2_BUCKET/podcast.xml" --endpoint-url "$R2_ENDPOINT" \
  --content-type "application/rss+xml; charset=utf-8" --cache-control "public, max-age=600"
# the Audio screen's list of all episodes (the site reads this, the podcast apps read the feed)
aws s3 cp "$WORK/episodes.json" "s3://$R2_BUCKET/episodes.json" --endpoint-url "$R2_ENDPOINT" \
  --content-type "application/json" --cache-control "public, max-age=300"
echo "published $R2_PUBLIC_URL/podcast.xml and episodes.json"
node podcast.mjs --verify "$R2_PUBLIC_URL/podcast.xml"
