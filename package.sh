#!/bin/bash
echo "Building 5mind AppImage..."

# Ensure electron-builder is installed locally
if ! npm list --depth=0 electron-builder >/dev/null 2>&1; then
  echo "Installing electron-builder..."
  npm install --save-dev electron-builder
fi

# Build the AppImage directly
echo "Creating AppImage..."
npx electron-builder --linux AppImage

# Make the AppImage executable
APPIMAGE=$(ls dist/*.AppImage 2>/dev/null | head -n1)
if [ -f "$APPIMAGE" ]; then
  chmod +x "$APPIMAGE"
  echo "AppImage created: $APPIMAGE"
else
  echo "AppImage build failed. Check electron-builder output above."
fi

