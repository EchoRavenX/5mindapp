#!/bin/bash
#!/bin/bash
# package.sh — BUILD DISCORD DEB (WORKS EVERY TIME)

echo "Building 5mind DEB..."

# Use npx to run electron-forge (no global install needed)
npx electron-forge make

echo "Build complete! DEB is in out/make/"