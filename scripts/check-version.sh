#!/bin/bash

# Get the version from package.json
CURRENT_VERSION=$(node -p "require('./package.json').version")

# Fetch updates from the remote repository
git fetch

# Get the version from package.json on the main branch
MASTER_VERSION=$(git show origin/main:package.json | node -p "JSON.parse(require('fs').readFileSync(0)).version")

# If the versions are not equal, then it has been updated
if [ "$CURRENT_VERSION" != "$MASTER_VERSION" ]; then
  echo "Version has been updated."
  echo "::set-output name=version_updated::true"
else
  echo "Version has not been updated. Skipping publish step."
  echo "::set-output name=version_updated::false"
fi
