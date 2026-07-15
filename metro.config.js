// Learn more: https://docs.expo.dev/guides/customizing-metro/
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

// Secrets: `.env*.local` files (staging DB password, service-role key, etc.)
// live at the project root inside Metro's default watchFolders. Block them
// from module resolution so they can never end up in the client bundle or
// be reachable through the dev server, regardless of how they're referenced.
const existingBlockList = Array.isArray(config.resolver.blockList)
  ? config.resolver.blockList
  : [config.resolver.blockList].filter(Boolean);
config.resolver.blockList = [...existingBlockList, /\.env(\..+)?\.local$/];

// Bundle-size: alias `expo-symbols` to an empty stub. It's only reached via
// expo-router's native-tabs feature (which this app doesn't use — custom
// BottomNavBar), and it drags a ~956KB MaterialSymbols font into the bundle.
// See shims/expo-symbols.js for the full rationale + how to revert.
const EXPO_SYMBOLS_STUB = path.resolve(__dirname, 'shims/expo-symbols.js');

const originalResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'expo-symbols') {
    return { type: 'sourceFile', filePath: EXPO_SYMBOLS_STUB };
  }
  // Fall through to Metro's default resolver (or a previously-set custom one).
  if (originalResolveRequest) {
    return originalResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
