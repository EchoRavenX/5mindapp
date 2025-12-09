#!/bin/bash
echo "Building 5mind Snap via Electron Forge..."

# Run Forge make targeting Snap
npx electron-forge make --targets=@electron-forge/maker-snap

# Find the resulting snap
SNAPFILE=$(ls out/make/*.snap 2>/dev/null | head -n1)
if [ -f "$SNAPFILE" ]; then
  echo "Snap created: $SNAPFILE"
else
  echo "Snap build failed. Check Forge output above."
fi

