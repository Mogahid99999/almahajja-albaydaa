#!/bin/bash

echo "🔨 Rebuilding iOS..."
npx expo run:ios &

echo "🔨 Rebuilding Android..."
JAVA_HOME=$(/usr/libexec/java_home -v 17) npx expo run:android &

wait
echo "✅ Both builds complete!"
