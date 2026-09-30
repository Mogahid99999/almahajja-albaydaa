/*
 * go.almahajja.app/live/{code} — the share-link fallback (PLAN_LIVE_V23 §9.3, D8).
 *
 * Reached only when the app did NOT take the link:
 *   - no app installed;
 *   - an OLD app (< 1.1.3: no https /live filter) — Android hands the link to the browser;
 *   - a current app whose App Link is not verified (assetlinks.json had no SHA-256
 *     when it was installed), an in-app browser, or a URL typed into Chrome.
 *
 * Android — one button covers all three. «افتح البث في التطبيق» is a
 * package-targeted https intent:
 *   intent://go.almahajja.app/live/{code}#Intent;scheme=https;package=com.riwaqalilm.app;
 *     S.browser_fallback_url=<Google Play, url-encoded>;end
 *   → a current app (its https /live filter matches — verification is not needed
 *     for an explicit package) opens the room via app/+native-intent.tsx;
 *   → an old app (no matching filter) or no app → Chrome follows the fallback to
 *     Google Play, which offers «تحديث» / «تثبيت».
 * It never uses riwaqalilm:// — an old app owns that scheme too and would open
 * on a route it doesn't have. Chrome only follows intents from a user tap, so
 * there is NO automatic store redirect: it would carry a current-app user off
 * to Play, whose «فتح» opens the app's home, not the room. A plain Google Play
 * button («حدّث التطبيق أو ثبّته») stays for browsers that ignore intent://.
 *
 * iOS (out of scope this round) / desktop: a short note + Google Play (the App
 * Store instead on iOS once config.js carries appStoreUrl).
 *
 * The card: get_live_by_code (anon key from /config.js) → live / scheduled /
 * ended; a gender-restricted session (restricted:true) shows only its status.
 * Text is only ever set with textContent (titles come from the database).
 *
 * The pure helpers are exported under CommonJS for tests/go-site (no build step:
 * in the browser `module` is undefined and the page boots instead).
 */
(function () {
  'use strict';

  var PACKAGE = 'com.riwaqalilm.app';
  var HOST = 'go.almahajja.app';
  var PLAY_URL = 'https://play.google.com/store/apps/details?id=' + PACKAGE;
  var CODE_RE = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/;

  var COPY = {
    open: 'افتح البث في التطبيق',
    openHint: 'إن لم يكن التطبيق على جهازك، أو كان إصداره قديماً، ينقلك هذا الزر إلى Google Play.',
    update: 'حدّث التطبيق أو ثبّته من Google Play',
    play: 'حمّل التطبيق من Google Play',
    explainAndroid: 'البث المباشر يحتاج الإصدار ١٫١٫٣ أو أحدث من التطبيق. بعد التحديث افتح الرابط من جديد.',
    explainIos: 'تطبيق المحجّة البيضاء متاح الآن على أجهزة أندرويد من Google Play.',
    explainIosStore: 'حمّل التطبيق، ثم افتح هذا الرابط من جديد.',
    explainOther: 'افتح هذا الرابط من هاتف أندرويد عليه تطبيق المحجّة البيضاء، أو حمّل التطبيق من Google Play.',
  };

  // ── Pure helpers ────────────────────────────────────────────────────────────

  /** «abc-234» / « ABC234 » → «ABC234»; null when it can't be a share code. */
  function normalizeCode(raw) {
    var c = String(raw == null ? '' : raw).replace(/[\s-]/g, '').toUpperCase();
    return CODE_RE.test(c) ? c : null;
  }

  /** /live/ABC234 (one trailing slash is fine) → «ABC234»; anything else → null. */
  function codeFromPath(pathname) {
    var m = /^\/live\/([^/?#]+)\/?$/.exec(pathname || '');
    if (!m) return null;
    var raw;
    try { raw = decodeURIComponent(m[1]); } catch (e) { return null; }
    return normalizeCode(raw);
  }

  function platformOf(ua, maxTouchPoints) {
    var s = ua || '';
    if (/android/i.test(s)) return 'android';
    // iPadOS 13+ reports a Mac user agent with touch.
    if (/iPhone|iPad|iPod/i.test(s) || (/Macintosh/.test(s) && maxTouchPoints > 1)) return 'ios';
    return 'other';
  }

  /** The Android button: the same https link, aimed at our package, Play as the fallback. */
  function androidIntentUrl(code) {
    return 'intent://' + HOST + '/live/' + code +
      '#Intent;scheme=https;package=' + PACKAGE +
      ';S.browser_fallback_url=' + encodeURIComponent(PLAY_URL) + ';end';
  }

  function isAppStoreUrl(url) {
    return typeof url === 'string' && /^https:\/\/apps\.apple\.com\//.test(url);
  }

  /**
   * What the page offers on a platform. Empty strings = hidden.
   *   open     — the primary button's href (Android + a valid code only)
   *   hint     — the line under it
   *   play     — the Google Play button's href, playLabel its text
   *   appStore — the App Store button's href (iOS, when configured)
   *   explain  — the closing note
   */
  function pageFor(os, code, appStoreUrl) {
    if (os === 'android') {
      return {
        open: code ? androidIntentUrl(code) : '',
        hint: code ? COPY.openHint : '',
        play: PLAY_URL,
        playLabel: COPY.update,
        appStore: '',
        explain: COPY.explainAndroid,
      };
    }
    var appStore = os === 'ios' && isAppStoreUrl(appStoreUrl) ? appStoreUrl : '';
    return {
      open: '',
      hint: '',
      play: appStore ? '' : PLAY_URL,
      playLabel: COPY.play,
      appStore: appStore,
      explain: os === 'ios' ? (appStore ? COPY.explainIosStore : COPY.explainIos) : COPY.explainOther,
    };
  }

  var api = {
    PACKAGE: PACKAGE,
    HOST: HOST,
    PLAY_URL: PLAY_URL,
    COPY: COPY,
    normalizeCode: normalizeCode,
    codeFromPath: codeFromPath,
    platformOf: platformOf,
    androidIntentUrl: androidIntentUrl,
    pageFor: pageFor,
  };
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  if (typeof document === 'undefined' || typeof window === 'undefined') return;

  // ── The page ────────────────────────────────────────────────────────────────

  var cfg = window.GO_CONFIG || {};

  function $(id) { return document.getElementById(id); }
  function show(el, on) { if (el) el.hidden = !on; }
  function setText(id, text) {
    var el = $(id);
    if (!el) return;
    el.textContent = text || '';
    show(el, !!text);
  }
  function setLink(id, href, label) {
    var el = $(id);
    if (!el) return;
    if (href) el.href = href;
    if (label) el.textContent = label;
    show(el, !!href);
  }

  // ── Arabic formatting ───────────────────────────────────────────────────────
  var arNum = (function () {
    try {
      var f = new Intl.NumberFormat('ar-EG');
      return function (n) { return f.format(n); };
    } catch (e) {
      return function (n) { return String(n); };
    }
  })();

  function arWhen(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    try {
      return new Intl.DateTimeFormat('ar-EG', {
        weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit',
      }).format(d);
    } catch (e) {
      return d.toLocaleString();
    }
  }

  function startedAgo(iso) {
    var t = Date.parse(iso);
    if (!isFinite(t)) return '';
    var n = Math.max(1, Math.floor((Date.now() - t) / 60000));
    return 'بدأ منذ ' + arNum(n) + ' دقيقة';
  }

  // ── Card ────────────────────────────────────────────────────────────────────
  function badge(kind) {
    var el = $('badge');
    var text = kind === 'live' ? 'مباشر الآن' : kind === 'scheduled' ? 'مجلس قادم' : 'انتهى المجلس';
    $('badge-text').textContent = text;
    el.className = 'badge' + (kind === 'live' ? ' live' : '');
    show(el, true);
  }

  function render(data) {
    if (!data) {
      setText('title', 'لم نجد هذا المجلس');
      setText('sub', 'ربما انتهى، أو أن الرابط غير صحيح.');
      setText('when', '');
      return;
    }
    var status = data.status === 'live' || data.status === 'scheduled' ? data.status : 'ended';
    badge(status);
    if (data.restricted) {
      // Gender-scoped section: the anon key never learns its title (0138).
      setText('title', 'مجلس علم في المحجّة البيضاء');
      setText('sub', 'تفاصيل هذا المجلس متاحة داخل التطبيق.');
      setText('when', '');
      return;
    }
    var title = data.title || 'مجلس علم';
    document.title = title + ' · المحجّة البيضاء';
    setText('title', title);
    var parts = [];
    if (data.section_title) parts.push(data.section_title);
    if (data.sheikh_name) parts.push(data.sheikh_name);
    setText('sub', parts.join(' · '));
    if (status === 'live') {
      setText('when', data.started_at ? startedAgo(data.started_at) : '');
    } else if (status === 'scheduled') {
      setText('when', data.scheduled_at ? 'موعده ' + arWhen(data.scheduled_at) : '');
    } else {
      setText('when', 'انتهى هذا المجلس، وستجد تسجيله في التطبيق حين يُنشر بإذن الله.');
    }
  }

  function fetchSession(code) {
    if (!cfg.supabaseUrl || !cfg.anonKey || !window.fetch) return Promise.reject(new Error('config'));
    var url = String(cfg.supabaseUrl).replace(/\/+$/, '') + '/rest/v1/rpc/get_live_by_code';
    return fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: cfg.anonKey,
        Authorization: 'Bearer ' + cfg.anonKey,
      },
      body: JSON.stringify({ p_code: code }),
      cache: 'no-store',
    }).then(function (res) {
      if (!res.ok) throw new Error('http ' + res.status);
      return res.json();
    });
  }

  function start() {
    if (!$('title')) return;
    var code = codeFromPath(window.location.pathname);
    var page = pageFor(platformOf(navigator.userAgent, navigator.maxTouchPoints), code, cfg.appStoreUrl);

    setLink('open', page.open, COPY.open);
    setText('hint', page.hint);
    setLink('play', page.play, page.playLabel);
    setLink('appstore', page.appStore);
    setText('explain', page.explain);

    if (!code) {
      render(null);
      return;
    }
    fetchSession(code).then(render, function () {
      setText('title', 'مجلس علم مباشر');
      setText('sub', 'تعذّر جلب تفاصيل المجلس الآن، وتستطيع فتحه من التطبيق.');
      setText('when', '');
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
