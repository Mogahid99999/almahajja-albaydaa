/**
 * Empty stub for `expo-symbols`, aliased in via metro.config.js.
 *
 * WHY: expo-router's native-tabs feature (materialIconConverter.android.js)
 * statically `require("expo-symbols")`, which pulls the ~956KB MaterialSymbols
 * font into the bundle. This app renders no <SymbolView> and uses a custom
 * BottomNavBar instead of NativeTabs, so that font is pure dead weight.
 *
 * The stub keeps the same export surface so any reference resolves, but ships
 * nothing. If a future screen genuinely needs SF/Material Symbols, delete the
 * `expo-symbols` alias in metro.config.js and this file.
 */
function SymbolView() {
  return null;
}

async function unstable_getMaterialSymbolSourceAsync() {
  // Not reachable in this app (no NativeTabs / SymbolView usage). If this ever
  // throws, it means a symbol path was hit — remove the metro alias to restore.
  throw new Error(
    'expo-symbols is stubbed out for bundle size (see metro.config.js). ' +
      'Remove the alias to use SF/Material Symbols.',
  );
}

module.exports = {
  SymbolView,
  unstable_getMaterialSymbolSourceAsync,
};
