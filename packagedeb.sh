#!/bin/bash

echo "Building 5mind DEB..."

npx electron-forge make

echo "Build complete! DEB is in out/make/"
