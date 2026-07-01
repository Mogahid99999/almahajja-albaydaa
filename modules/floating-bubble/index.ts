import { requireNativeModule } from 'expo-modules-core';

/**
 * Native `FloatingBubble` module (Android). Imported by `src/lib/bubble.ts` via
 * `requireOptionalNativeModule('FloatingBubble')`, so this thin entry only
 * matters once the module is moved into `modules/` and prebuilt (see README).
 */
export default requireNativeModule('FloatingBubble');
