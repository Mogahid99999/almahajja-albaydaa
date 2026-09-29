/*
 * go.almahajja.app/live/{code} — the share-link fallback (PLAN_LIVE_V23 §9.3, D8).
 *
 * Reached only when the app did NOT take the link (not installed, or an in-app
 * browser that ignores App Links / Universal Links):
 *   1. reads the share code from the path;
 *   2. asks Supabase get_live_by_code (anon key from /config.js) → live /
 *      scheduled / ended card — a gender-restricted session (restricted:true)
 *      shows only its status, never its title;
 *   3. «لديّ التطبيق · افتح البث» → riwaqalilm://live/code/{code};
 *   4. Android / iOS: after 1.5 s, on to Google Play / the App Store
 *      («ابقَ هنا» cancels; so does opening the app or leaving the page).
 * Text is only ever set with textContent (titles come from the database).
 */
(function () {
  'use strict';

  var cfg = window.GO_CONFIG || {};
  var PLAY_URL = 'https://play.google.com/store/apps/details?id=com.riwaqalilm.app';
  var APP_STORE_URL = typeof cfg.appStoreUrl === 'string' ? cfg.appStoreUrl : '';
  var REDIRECT_MS = 1500;
  var CODE_RE = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/;

  function $(id) { return document.getElementById(id); }
  function show(el, on) { if (el) el.hidden = !on; }
  function setText(id, text) {
    var el = $(id);
    if (!el) return;
    el.textContent = text || '';
    show(el, !!text);
  }

  // ── The code: /live/ABC234 (a trailing slash / query is fine) ─────────────
  function readCode() {
    var m = /^\/live\/([^/?#]+)\/?$/.exec(window.location.pathname || '');
    if (!m) return null;
    var raw;
    try { raw = decodeURIComponent(m[1]); } catch (e) { return null; }
    var c = raw.replace(/[\s-]/g, '').toUpperCase();
    return CODE_RE.test(c) ? c : null;
  }

  // ── Platform ────────────────────────────────────────────────────────────────
  function platform() {
    var ua = navigator.userAgent || '';
    if (/android/i.test(ua)) return 'android';
    // iPadOS 13+ reports a Mac user agent with touch.
    if (/iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'ios';
    return 'other';
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

  // ── Store redirect (1.5 s) ──────────────────────────────────────────────────
  var timer = null;
  function cancelRedirect() {
    if (timer) clearTimeout(timer);
    timer = null;
    show($('redirect'), false);
  }

  function start() {
    var code = readCode();
    var os = platform();
    var storeUrl = os === 'android' ? PLAY_URL : os === 'ios' ? APP_STORE_URL : '';

    var open = $('open');
    open.href = code ? 'riwaqalilm://live/code/' + code : 'riwaqalilm://';
    open.addEventListener('click', cancelRedirect);

    var play = $('play');
    var appstore = $('appstore');
    if (APP_STORE_URL) appstore.href = APP_STORE_URL;
    play.href = PLAY_URL;
    show(play, os !== 'ios');
    show(appstore, !!APP_STORE_URL && os !== 'android');

    $('stay').addEventListener('click', cancelRedirect);
    // The app took over (or the user left): never yank them to the store later.
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) cancelRedirect();
    });
    window.addEventListener('pagehide', cancelRedirect);

    if (storeUrl) {
      show($('redirect'), true);
      timer = setTimeout(function () {
        timer = null;
        show($('redirect'), false);
        window.location.href = storeUrl;
      }, REDIRECT_MS);
    }

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
