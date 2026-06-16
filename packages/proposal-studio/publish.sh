#!/usr/bin/env bash
#
# proposal-studio — one-command npm publish script.
#
# What this does:
#   1. Checks that you are logged in to npm
#   2. Auto-detects the situation:
#        - FIRST-TIME publish  -> the package name doesn't exist on npm yet.
#                                 Publishes the CURRENT version as-is (no bump).
#        - UPDATE publish      -> the package already exists on npm.
#                                 Asks patch / minor / major, bumps the version,
#                                 then publishes.
#   3. Builds a fresh dist/
#   4. (update only) Bumps the version, git-commits + tags it
#   5. Pushes the commit + tags to GitHub
#   6. Publishes to npm
#
# How to run (in a terminal):
#   cd packages/proposal-studio
#   ./publish.sh
#
# Run this ONCE the first time (to make the file executable):
#   chmod +x publish.sh
# -----------------------------------------------------------------------------

set -e   # stop the script immediately if any command fails

# go to the folder where this script lives
cd "$(dirname "$0")"

# --- a little color so output is easy to read --------------------------------
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

step()  { echo -e "\n${BLUE}==> $1${NC}"; }
ok()    { echo -e "${GREEN}✔ $1${NC}"; }
warn()  { echo -e "${YELLOW}⚠ $1${NC}"; }
fail()  { echo -e "${RED}✘ $1${NC}"; exit 1; }

# read package name + current version from package.json
PKG_NAME=$(node -p "require('./package.json').name")
CURRENT_VERSION=$(node -p "require('./package.json').version")

# -----------------------------------------------------------------------------
# 0. Are you logged in to npm?
# -----------------------------------------------------------------------------
step "Checking npm login..."
if ! NPM_USER=$(npm whoami 2>/dev/null); then
  fail "You are not logged in to npm. Run 'npm login' first, then re-run this script."
fi
ok "npm user: $NPM_USER"

# -----------------------------------------------------------------------------
# 1. Detect: is this a FIRST-TIME publish or an UPDATE?
#    We ask npm if this package name already has a published version.
# -----------------------------------------------------------------------------
step "Checking if '$PKG_NAME' already exists on npm..."
PUBLISHED_VERSION=$(npm view "$PKG_NAME" version 2>/dev/null || true)

if [ -z "$PUBLISHED_VERSION" ]; then
  MODE="first"
  ok "Not found on npm — this will be a FIRST-TIME publish (version $CURRENT_VERSION)."
else
  MODE="update"
  ok "Found on npm at version $PUBLISHED_VERSION — this will be an UPDATE publish."
fi

# -----------------------------------------------------------------------------
# 2. Is the git working tree clean? (safer before publishing)
# -----------------------------------------------------------------------------
step "Checking git status..."
if [ -n "$(git status --porcelain)" ]; then
  warn "You have uncommitted changes:"
  git status --short
  echo ""
  read -p "$(echo -e "${YELLOW}Commit these changes as part of the release and continue? (y/n): ${NC}")" CONFIRM_DIRTY
  if [ "$CONFIRM_DIRTY" != "y" ]; then
    fail "Stopped. Commit your changes first, then re-run the script."
  fi
fi

# -----------------------------------------------------------------------------
# 3. (UPDATE only) Ask which version bump: patch / minor / major
#    (For a first-time publish we keep the current version as-is.)
# -----------------------------------------------------------------------------
if [ "$MODE" = "update" ]; then
  step "Current version: ${CURRENT_VERSION}  (published on npm: ${PUBLISHED_VERSION})"
  echo ""
  echo "  What kind of update is this?"
  echo -e "    ${GREEN}1${NC}) patch  — small fix / bug fix            (e.g. 0.1.1 → 0.1.2)"
  echo -e "    ${GREEN}2${NC}) minor  — new feature, nothing breaks    (e.g. 0.1.1 → 0.2.0)"
  echo -e "    ${GREEN}3${NC}) major  — big change, may break old code (e.g. 0.1.1 → 1.0.0)"
  echo ""
  read -p "$(echo -e "${YELLOW}Your choice (1/2/3): ${NC}")" CHOICE

  case "$CHOICE" in
    1) BUMP="patch" ;;
    2) BUMP="minor" ;;
    3) BUMP="major" ;;
    *) fail "Invalid choice ('$CHOICE'). Enter 1, 2, or 3 only." ;;
  esac
  ok "Selected: $BUMP"
else
  step "First-time publish — keeping the current version ($CURRENT_VERSION), no bump needed."
fi

# -----------------------------------------------------------------------------
# 4. Build — create a fresh dist/ folder
# -----------------------------------------------------------------------------
step "Building (npm run build)..."
# PS_NG_BUILD=1 forces a fresh `ng build` so the LATEST Angular source changes
# are always included in dist/ (without it, an existing Angular build is reused).
PS_NG_BUILD=1 npm run build
ok "Build finished"

# (optional) run smoke test if one exists
if npm run | grep -q "  test"; then
  step "Running smoke test..."
  npm test
  ok "Tests passed"
fi

# -----------------------------------------------------------------------------
# 5. Version handling + git commit
#    - UPDATE : bump version (npm version commits + tags automatically)
#    - FIRST  : if there are staged/uncommitted changes, commit them so the
#               released code matches what's in git.
# -----------------------------------------------------------------------------
if [ "$MODE" = "update" ]; then
  step "Bumping version ($BUMP)..."
  # -m : npm replaces %s with the new version number in the commit message
  NEW_VERSION=$(npm version "$BUMP" -m "chore(release): $PKG_NAME v%s")
  ok "New version: $NEW_VERSION"
else
  # first-time publish: commit any pending changes (incl. build output if tracked)
  if [ -n "$(git status --porcelain)" ]; then
    step "Committing changes for the first release..."
    git add -A
    git commit -m "chore(release): $PKG_NAME v$CURRENT_VERSION"
    git tag -a "v$CURRENT_VERSION" -m "$PKG_NAME v$CURRENT_VERSION" || true
    ok "Committed and tagged v$CURRENT_VERSION"
  fi
  NEW_VERSION="v$CURRENT_VERSION"
fi

# -----------------------------------------------------------------------------
# 6. Push to GitHub (commit + tags)
# -----------------------------------------------------------------------------
step "Pushing to GitHub..."
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
git push origin "$CURRENT_BRANCH"
git push origin --tags
ok "Pushed to GitHub (branch: $CURRENT_BRANCH)"

# -----------------------------------------------------------------------------
# 7. Publish to npm
#    --access public = make the package publicly visible (needed for the very
#    first publish, especially for scoped @name/pkg packages; harmless after).
# -----------------------------------------------------------------------------
step "Publishing to npm..."
npm publish --access public
ok "Published to npm!"

# -----------------------------------------------------------------------------
# Done 🎉
# -----------------------------------------------------------------------------
FINAL_VERSION=$(node -p "require('./package.json').version")
echo ""
echo -e "${GREEN}=====================================================${NC}"
if [ "$MODE" = "first" ]; then
  echo -e "${GREEN} 🎉 First-time publish complete!${NC}"
else
  echo -e "${GREEN} 🎉 Update published!${NC}"
fi
echo -e "${GREEN}=====================================================${NC}"
echo -e "  Package : $PKG_NAME"
echo -e "  Version : ${FINAL_VERSION}"
echo -e "  npm     : https://www.npmjs.com/package/$PKG_NAME"
echo ""
echo -e "  To verify in a minute, run:"
echo -e "    ${BLUE}npm view $PKG_NAME version${NC}"
echo ""
