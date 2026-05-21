#!/usr/bin/env bash
# After a successful Release Tauri Windows workflow, sync the manifest at
# Jktfe/scoop-antchat so scoop install antchat-tauri resolves with the new
# version + hash.
#
# Usage:
#   scoop/update-tauri-bucket.sh <version>
#   # e.g. scoop/update-tauri-bucket.sh 0.1.0

set -euo pipefail

VERSION="${1:-}"
if [ -z "$VERSION" ]; then
  echo "usage: $0 <version>   (e.g. 0.1.0)" >&2
  exit 1
fi

TAG="antchat-tauri-v${VERSION}"
SOURCE_MANIFEST="$(cd "$(dirname "$0")" && pwd)/antchat-tauri.json"
RELEASE_REPO="Jktfe/antDev"
BUCKET_REPO="Jktfe/scoop-antchat"
WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

# 1. Download SHA256SUMS for the release tag
curl -sL "https://github.com/${RELEASE_REPO}/releases/download/${TAG}/SHA256SUMS" > "${WORKDIR}/SHA256SUMS"

# 2. Extract the MSI hash
MSI_HASH=$(grep "\.msi" "${WORKDIR}/SHA256SUMS" | awk '{print $1}')
if [ -z "$MSI_HASH" ]; then
  echo "ERROR: could not find MSI hash in SHA256SUMS for ${TAG}" >&2
  exit 1
fi

# 3. Clone bucket repo, render manifest
git clone --depth 1 "git@github.com:${BUCKET_REPO}.git" "${WORKDIR}/bucket"

sed -e "s/0.0.0/${VERSION}/g"     -e "s/PLACEHOLDER_SHA256/${MSI_HASH}/g"     "$SOURCE_MANIFEST" > "${WORKDIR}/bucket/bucket/antchat-tauri.json"

# 4. Commit, push, PR
cd "${WORKDIR}/bucket"
git checkout -b "release/${TAG}"
git add bucket/antchat-tauri.json
git commit -m "antchat-tauri ${VERSION}"
git push origin "release/${TAG}"
gh pr create --repo "${BUCKET_REPO}" --title "antchat-tauri ${VERSION}" --body "Auto-bumped via CI."
