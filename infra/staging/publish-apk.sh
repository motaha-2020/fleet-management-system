#!/usr/bin/env bash
# Puts a finished EAS build of the driver app at https://fleet.projectflow.site/download/fleet-driver.apk
# (the "Download the driver app" link on the sign-in page).
#   infra/staging/publish-apk.sh <user@host> <ssh-key> <eas-build-id>
# The server downloads the APK itself; the new file replaces the old one only when it is complete.
set -euo pipefail

TARGET=${1:?usage: publish-apk.sh <user@host> <ssh-key> <eas-build-id>}
KEY=${2:?ssh key}
BUILD=${3:?eas build id}

cd "$(git rev-parse --show-toplevel)/apps/mobile"
URL=$(eas build:view "$BUILD" --json | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d);if(j.status!=="FINISHED"){console.error("build is "+j.status);process.exit(1)}process.stdout.write(j.artifacts.buildUrl||j.artifacts.applicationArchiveUrl)})')
echo "==> $URL"

ssh -o IdentitiesOnly=yes -i "$KEY" "$TARGET" URL="$URL" bash -s <<'REMOTE'
set -euo pipefail
mkdir -p /srv/fleet/download && chmod 755 /srv/fleet /srv/fleet/download
curl -fsSL "$URL" -o /srv/fleet/download/.fleet-driver.apk.part
# An APK is a zip: refuse anything else.
head -c 2 /srv/fleet/download/.fleet-driver.apk.part | grep -q PK
chmod 644 /srv/fleet/download/.fleet-driver.apk.part
mv /srv/fleet/download/.fleet-driver.apk.part /srv/fleet/download/fleet-driver.apk
ls -l /srv/fleet/download/fleet-driver.apk
REMOTE
