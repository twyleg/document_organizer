#!/usr/bin/env bash
set -euo pipefail

readonly repository='twyleg/document_organizer'
readonly release_api="https://api.github.com/repos/${repository}/releases/latest"

usage() {
  cat <<'HELP'
Usage: update_document_organizer.sh [INSTALL_DIRECTORY]

Download the latest stable Document Organizer Linux x86_64 AppImage from GitHub.
The default installation directory is ./document_organizer, relative to your
current directory. Old versions are kept. The executable symlink is latest.

Example:
  ./update_document_organizer.sh "$HOME/.local/opt/document_organizer"
  ln -s "$HOME/.local/opt/document_organizer/latest" "$HOME/.bin/document-organizer"

Requires Bash, curl, Python 3, flock, and GNU coreutils. No sudo is needed.
HELP
}

fail() {
  printf 'Error: %s\n' "$*" >&2
  exit 1
}

download() {
  local url=$1
  local destination=$2

  curl --fail --show-error --silent --location \
    --proto '=https' --proto-redir '=https' \
    --connect-timeout 20 --max-time 600 --retry 3 \
    --header 'Accept: application/vnd.github+json' \
    --output "$destination" "$url"
}

if [[ ${1:-} == '--help' || ${1:-} == '-h' ]]; then
  usage
  exit 0
fi

if (( $# > 1 )); then
  usage >&2
  exit 1
fi

for dependency in curl python3 flock sha256sum; do
  command -v "$dependency" > /dev/null || fail "Required command is missing: $dependency"
done

if [[ $(uname -s) != Linux || $(uname -m) != x86_64 ]]; then
  fail 'This updater supports Linux x86_64; the release currently has no Linux ARM binary.'
fi

install_directory=${1:-./document_organizer}
mkdir -p -- "$install_directory"
install_directory=$(cd -- "$install_directory" && pwd -P)

# Serialize updates to this installation, including the final symlink switch.
exec 9> "$install_directory/.update.lock"
flock --nonblock 9 || fail 'Another update is already running for this installation.'

if [[ -e "$install_directory/latest" && ! -L "$install_directory/latest" ]]; then
  fail "The launcher path already exists and is not a symlink: $install_directory/latest"
fi

staging_directory=$(mktemp -d "$install_directory/.update.XXXXXXXX")
trap 'rm -rf -- "$staging_directory"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

printf 'Checking the latest stable release of %s…\n' "$repository"
download "$release_api" "$staging_directory/release.json"

# Read metadata as data, never as shell code. Reject unsafe tag names and URLs.
python3 - "$staging_directory/release.json" "$repository" > "$staging_directory/assets.txt" <<'PY'
import json
import re
import sys

with open(sys.argv[1], encoding="utf-8") as metadata:
    release = json.load(metadata)

repository = sys.argv[2]
tag = release.get("tag_name", "")
if release.get("draft") or release.get("prerelease"):
    sys.exit("Error: GitHub returned a draft or prerelease instead of a stable release.")

if not re.fullmatch(r"v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)", tag):
    sys.exit("Error: The stable release must have a tag in the form vX.Y.Z.")

binary_names = {
    f"document-organizer-{tag[1:]}-linux-x86_64.AppImage",
    f"document-organizer-{tag[1:]}-linux-x64.AppImage",
}
binaries = [asset for asset in release.get("assets", []) if asset.get("name") in binary_names]
if len(binaries) != 1:
    sys.exit(f"Error: Release {tag} must contain exactly one Linux x86_64 AppImage.")

filename = binaries[0]["name"]
urls = []
for name in (filename, "SHA256SUMS.txt"):
    assets = [asset for asset in release.get("assets", []) if asset.get("name") == name]
    if len(assets) != 1:
        sys.exit(f"Error: Release {tag} must contain exactly one {name} asset.")

    url = assets[0].get("browser_download_url")
    expected_url = f"https://github.com/{repository}/releases/download/{tag}/{name}"
    if url != expected_url:
        sys.exit(f"Error: Unexpected download URL for {name}.")

    urls.append(url)

print(tag)
print(filename)
print(*urls, sep="\n")
PY

mapfile -t assets < "$staging_directory/assets.txt"
release_tag=${assets[0]}
filename=${assets[1]}
appimage_url=${assets[2]}
checksums_url=${assets[3]}
version_directory="$install_directory/$release_tag"
installed_file="$version_directory/$filename"

download "$checksums_url" "$staging_directory/SHA256SUMS.txt"

expected_checksum=$(python3 - "$staging_directory/SHA256SUMS.txt" "$filename" <<'PY'
import re
import sys

checksums = []
with open(sys.argv[1], encoding="utf-8") as manifest:
    for line in manifest:
        match = re.fullmatch(r"([0-9a-fA-F]{64}) [ *](.+)", line.rstrip("\n"))
        if match and match[2] == sys.argv[2]:
            checksums.append(match[1].lower())

if len(checksums) != 1:
    sys.exit("Error: The release checksum manifest must contain exactly one AppImage checksum.")

print(checksums[0])
PY
)

if [[ -e "$version_directory" || -L "$version_directory" ]]; then
  [[ -d "$version_directory" && ! -L "$version_directory" ]] \
    || fail "The version path is not a regular directory: $version_directory"
  [[ -f "$installed_file" && ! -L "$installed_file" ]] \
    || fail "The existing version is incomplete: $version_directory"

  actual_checksum=$(sha256sum -- "$installed_file")
  [[ ${actual_checksum%% *} == "$expected_checksum" ]] \
    || fail "The existing $release_tag binary does not match its release checksum."

  printf '%s is already downloaded and verified.\n' "$release_tag"
else
  printf 'Downloading %s…\n' "$filename"
  mkdir -- "$staging_directory/version"
  download "$appimage_url" "$staging_directory/version/$filename"

  actual_checksum=$(sha256sum -- "$staging_directory/version/$filename")
  [[ ${actual_checksum%% *} == "$expected_checksum" ]] \
    || fail 'Downloaded AppImage does not match its release checksum; keeping the current version.'

  chmod +x -- "$staging_directory/version/$filename"
  mv -- "$staging_directory/version" "$version_directory"
fi

chmod +x -- "$installed_file"

# A relative executable symlink keeps the installation directory movable.
# Rename it atomically so a failed update leaves the current launcher usable.
ln -s -- "$release_tag/$filename" "$staging_directory/latest"
mv -Tf -- "$staging_directory/latest" "$install_directory/latest"

printf 'Ready: %s\nVersion: %s\n' "$install_directory/latest" "$release_tag"
