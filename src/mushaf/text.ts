/**
 * The KFGQPC Hafs V22 text — one ayah per line, shipped as a bundled ASSET
 * (assets/mushaf/hafs-v22.txt, ~1.3 MB) rather than compiled into the JS
 * bundle, and read once per app session. Works offline from the first launch.
 * Its bytes are pinned by src/mushaf/__tests__/quranText.test.ts.
 */
import { Asset } from 'expo-asset';
import { File } from 'expo-file-system';
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

import { AYAH_COUNT } from './quran';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const TEXT_ASSET = require('../../assets/mushaf/hafs-v22.txt');

let cache: Promise<string[]> | null = null;
let loaded: string[] | null = null;

async function readAsset(): Promise<string> {
  const asset = Asset.fromModule(TEXT_ASSET);
  if (Platform.OS === 'web') return (await fetch(asset.uri)).text();
  await asset.downloadAsync();
  return new File(asset.localUri ?? asset.uri).text();
}

export function loadQuranText(): Promise<string[]> {
  if (!cache) {
    cache = readAsset()
      .then((raw) => {
        // Line terminators only (a CRLF checkout must not leave \r on an ayah).
        const lines = raw.split(/\r?\n/);
        if (lines[lines.length - 1] === '') lines.pop();
        if (lines.length !== AYAH_COUNT) throw new Error('quran text: unexpected ayah count');
        loaded = lines;
        return lines;
      })
      .catch((e) => {
        cache = null; // let the next mount retry
        throw e;
      });
  }
  return cache;
}

/** The text lines once loaded (null while loading / on failure). */
export function useQuranText(): { text: string[] | null; error: boolean } {
  const [text, setText] = useState<string[] | null>(loaded);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (loaded) return;
    let alive = true;
    loadQuranText().then(
      (t) => alive && setText(t),
      () => alive && setError(true),
    );
    return () => {
      alive = false;
    };
  }, []);
  return { text, error };
}
