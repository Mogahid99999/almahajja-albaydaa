"""One-off: converts the approved Classical Islamic artboard into server template v1.
Usage: python build-template-v1.py <Main.dc.html> <out.html>
"""
import re
import sys

src, out = sys.argv[1], sys.argv[2]
s = open(src, encoding='utf8', newline='').read().replace('\r\n', '\n')

start = s.index('<div dir="rtl" lang="ar" style="position: relative; width: 1123px')
end = s.index('</x-dc>')
body = s[start:end]


def sub(old, new, count=1):
    global body
    assert body.count(old) >= 1, old
    body = body.replace(old, new) if count == 0 else body.replace(old, new, count)


body = body.replace('{{titleFont}}', "'Amiri Quran', serif")
sub('تشهد المَحجّة البَيْضَاء بأن', 'تشهد المَحجّة البَيْضَاء بأن {{#is_female}}الطالبة{{/is_female}}{{^is_female}}الطالب{{/is_female}}')
sub('>أحمد محمد عبدالله<', '>{{student_name}}<')
sub('<div data-slot="student" style="height: 74px;', '<div data-slot="student" style="margin-top: 8px; height: 74px;')
sub('height: 200px; display: flex', 'height: 192px; display: flex')
sub('قد أتمّ بحمد الله دراسة', 'قد {{#is_female}}أتمّت{{/is_female}}{{^is_female}}أتمّ{{/is_female}} بحمد الله دراسة')
sub('>كِتَابُ التَّوْحِيدِ<', '>{{title}}<')

author = re.search(r'( *)<div data-slot="author"[^\n]*\n', body)
line = author.group(0).replace('للإمام محمد بن عبد الوهاب رحمه الله', '{{author_line}}')
body = body.replace(author.group(0), '{{#author_line}}\n' + line + '{{/author_line}}\n')
presenter = re.search(r'( *)<div data-slot="presenter"[^\n]*\n', body)
line = presenter.group(0).replace('بشرح فضيلة الشيخ النذير محمد فرح', '{{presenter_line}}')
body = body.replace(presenter.group(0), '{{#presenter_line}}\n' + line + '{{/presenter_line}}\n')

closing = re.search(
    r'<div style="font-size: 18px; line-height: 1.4; color: #5c5343">واستوفى[^\n]*\n\s*<div style="font-size: 20px; line-height: 1.4; color: #2c6157">سائلين[^\n]*\n',
    body)
default = closing.group(0)
default = default.replace('واستوفى', '{{#is_female}}واستوفت{{/is_female}}{{^is_female}}واستوفى{{/is_female}}')
default = default.replace('أن ينفعه بما تعلّم، وأن يزيده علمًا وهدًى',
                          'أن {{#is_female}}ينفعها بما تعلّمت، وأن يزيدها{{/is_female}}{{^is_female}}ينفعه بما تعلّم، وأن يزيده{{/is_female}} علمًا وهدًى')
body = body.replace(closing.group(0),
                    '{{^custom_text}}' + default + '{{/custom_text}}{{#custom_text}}<div data-slot="custom" style="max-width: 800px; white-space: normal; text-align: center; font-size: 19px; line-height: 1.5; color: #2c6157">{{custom_text}}</div>{{/custom_text}}\n')
sub('white-space: nowrap">\n      {{^custom_text}}', 'white-space: nowrap">\n      {{^custom_text}}') if False else None

sub('٢٨ جمادى الأولى ١٤٤٨هـ', '{{issue_date_text}}')
sub('>MAH-1448-00127<', '>{{certificate_id}}<')
url = re.search(r'<div dir="ltr" style="([^"]*border-bottom: 1px solid #cbb98e)">almahajja\.app/c/MAH-1448-00127</div>', body)
body = body.replace(url.group(0), '<a data-slot="verify" dir="ltr" href="{{verification_url}}" style="display: block; text-decoration: none; ' + url.group(1) + '">{{verification_url_display}}</a>')
qr = re.search(r'<svg role="img" aria-label="مكان رمز QR تجريبي".*?</svg>', body, re.S)
body = body.replace(qr.group(0), '<div class="qr" role="img" aria-label="رمز التحقق من الشهادة">{{{qr_svg}}}</div>')

# flank rules get names so the fit script can hide or re-seat them
body = body.replace('margin-top: 92px">', 'margin-top: 92px" data-flank>')
# the book slot gets a name
m = re.search(r'<div style="(height: \d+px; display: flex; flex-direction: row; align-items: flex-start; justify-content: center; gap: 22px)">', body)
body = body.replace(m.group(0), f'<div data-slot="book-slot" style="{m.group(1)}">')

head = '''<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<title>شهادة إتمام — {{certificate_id}}</title>
<style>
@font-face{font-family:Amiri;font-weight:400;src:url(/fonts/amiri/amiri-arabic-400-normal.woff2) format("woff2")}
@font-face{font-family:Amiri;font-weight:700;src:url(/fonts/amiri/amiri-arabic-700-normal.woff2) format("woff2")}
@font-face{font-family:Amiri;font-weight:400;unicode-range:U+0000-00FF;src:url(/fonts/amiri/amiri-latin-400-normal.woff2) format("woff2")}
@font-face{font-family:Amiri;font-weight:700;unicode-range:U+0000-00FF;src:url(/fonts/amiri/amiri-latin-700-normal.woff2) format("woff2")}
@font-face{font-family:"Amiri Quran";font-weight:400;src:url(/fonts/amiri-quran/amiri-quran-arabic-400-normal.woff2) format("woff2")}
@font-face{font-family:"IBM Plex Sans Arabic";font-weight:400;src:url(/fonts/ibm-plex-sans-arabic/ibm-plex-sans-arabic-arabic-400-normal.woff2) format("woff2")}
@font-face{font-family:"IBM Plex Sans Arabic";font-weight:500;src:url(/fonts/ibm-plex-sans-arabic/ibm-plex-sans-arabic-arabic-500-normal.woff2) format("woff2")}
@font-face{font-family:"IBM Plex Sans Arabic";font-weight:400;unicode-range:U+0000-00FF;src:url(/fonts/ibm-plex-sans-arabic/ibm-plex-sans-arabic-latin-400-normal.woff2) format("woff2")}
@font-face{font-family:"IBM Plex Sans Arabic";font-weight:500;unicode-range:U+0000-00FF;src:url(/fonts/ibm-plex-sans-arabic/ibm-plex-sans-arabic-latin-500-normal.woff2) format("woff2")}
@page{size:1123px 794px;margin:0}
html,body{margin:0;padding:0;width:1123px;height:794px;overflow:hidden}
*{-webkit-print-color-adjust:exact;print-color-adjust:exact}
.qr,.qr svg{display:block;width:60px;height:60px}
</style>
</head>
<body>
'''

script = r'''
<script>
(async function () {
  await document.fonts.load("400 112px 'Amiri Quran'", "كتاب");
  await document.fonts.load("700 62px Amiri", "كتاب");
  await document.fonts.load("500 14px 'IBM Plex Sans Arabic'", "كتاب MAH");
  await document.fonts.ready;

  var MAX_W = 860;
  function shrink(el, start, min) {
    if (!el) return;
    var size = start;
    el.style.fontSize = size + 'px';
    while (el.getBoundingClientRect().width > MAX_W && size > min) {
      size -= 1;
      el.style.fontSize = size + 'px';
    }
  }
  shrink(document.querySelector('[data-slot=student]'), 62, 28);
  // The name's ink (tall ligatures above, tails below) must stay clear of the lines around it.
  (function () {
    var el = document.querySelector('[data-slot=student]');
    var c = document.createElement('canvas').getContext('2d');
    var size = parseFloat(el.style.fontSize), box = el.getBoundingClientRect();
    function clear() {
      c.font = '700 ' + size + 'px Amiri';
      var m = c.measureText(el.textContent);
      var p = document.createElement('span');
      p.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline';
      el.insertBefore(p, el.firstChild);
      var base = p.getBoundingClientRect().bottom;
      p.remove();
      return base - m.actualBoundingBoxAscent >= box.top - 13 && base + m.actualBoundingBoxDescent <= box.bottom + 4;
    }
    while (size > 28 && !clear()) { size -= 1; el.style.fontSize = size + 'px'; }
    window.__studentSize = size;
  })();
  shrink(document.querySelector('[data-slot=author]'), 24, 15);
  shrink(document.querySelector('[data-slot=presenter]'), 23, 15);

  // Ink bounds, not line boxes: Amiri Quran's marks fall about half an em below the baseline.
  var ctx = document.createElement('canvas').getContext('2d');
  function inkOf(text, size) {
    ctx.font = "400 " + size + "px 'Amiri Quran'";
    var m = ctx.measureText(text);
    return { asc: m.actualBoundingBoxAscent + 1.4, desc: m.actualBoundingBoxDescent + 1.4 };
  }

  var book = document.querySelector('[data-slot=book]');
  var slot = document.querySelector('[data-slot=book-slot]');
  var flanks = slot.querySelectorAll('[data-flank]');
  var slotH = slot.getBoundingClientRect().height;
  var size = 112, lines = 1;
  function set(s, wrap) {
    size = s;
    book.style.fontSize = s + 'px';
    book.style.lineHeight = wrap ? Math.round(s * 2) + 'px' : Math.round(s * 128 / 112) + 'px';
    book.style.whiteSpace = wrap ? 'normal' : 'nowrap';
    book.style.textWrap = wrap ? 'balance' : 'nowrap';
    book.style.textAlign = 'center';
    book.style.maxWidth = wrap ? MAX_W + 'px' : 'none';
  }
  var showFlanks = function (on) { flanks.forEach(function (f) { f.style.display = on ? 'flex' : 'none'; }); };

  set(112, false);
  while (size > 62 && book.getBoundingClientRect().width > 587) set(size - 2, false);
  showFlanks(book.getBoundingClientRect().width <= 587);
  if (book.getBoundingClientRect().width > 587) {
    showFlanks(false);
    while (size > 62 && book.getBoundingClientRect().width > MAX_W) set(size - 2, false);
  }
  // A title with deep descenders can overrun the seat at full size: reduce it too.
  function overruns() {
    var p = document.createElement('span');
    p.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline';
    book.insertBefore(p, book.firstChild);
    var base = p.getBoundingClientRect().bottom;
    p.remove();
    return base + inkOf(book.textContent, size).desc > slot.getBoundingClientRect().bottom;
  }
  while (size > 62 && overruns()) set(size - 2, false);
  if (book.getBoundingClientRect().width > MAX_W) {
    var s = 62;
    set(s, true);
    var tall = function () {
      var lh = parseFloat(book.style.lineHeight), n = Math.round(book.getBoundingClientRect().height / lh), k = inkOf(book.textContent, s);
      return (n - 1) * lh + k.asc + k.desc > slotH;
    };
    while (s > 30 && tall()) { s -= 2; set(s, true); }
    lines = Math.round(book.getBoundingClientRect().height / parseFloat(book.style.lineHeight));
  }

  var ink = inkOf(book.textContent, size);
  var inkH = ink.asc + ink.desc;
  if (size !== 112) {
    // centre the real ink inside the slot; the approved 112px seat is left as designed
    var probe = document.createElement('span');
    probe.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline';
    book.insertBefore(probe, book.firstChild);
    var firstBase = probe.getBoundingClientRect().bottom;
    probe.remove();
    var b = book.getBoundingClientRect(), st = slot.getBoundingClientRect();
    var lineH = parseFloat(book.style.lineHeight);
    var inkTop = firstBase - ink.asc;
    var inkBottom = firstBase + (lines - 1) * lineH + ink.desc;
    var delta = st.top + (st.height - (inkBottom - inkTop)) / 2 - inkTop;
    book.style.transform = 'translateY(' + delta.toFixed(1) + 'px)';
    flanks.forEach(function (f) { f.style.marginTop = Math.round(firstBase + delta - ink.asc * 0.35 - st.top) + 'px'; });
  }

  // Report overflow to the renderer: a certificate that does not fit is not delivered.
  var page = document.querySelector('[dir=rtl][lang=ar]');
  var column = slot.parentElement;
  var problems = [];
  document.querySelectorAll('[data-slot]').forEach(function (e) {
    var r = e.getBoundingClientRect();
    if (e.dataset.slot !== 'book-slot' && r.width > 880) problems.push(e.dataset.slot + ':wide');
  });
  if (column.scrollHeight > column.clientHeight + 1) problems.push('column:tall');
  var seat = document.createElement('span');
  seat.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline';
  book.insertBefore(seat, book.firstChild);
  var seatBase = seat.getBoundingClientRect().bottom;
  seat.remove();
  var slotBox = slot.getBoundingClientRect();
  if (seatBase + (lines - 1) * parseFloat(book.style.lineHeight) + ink.desc > slotBox.bottom + 2) problems.push('book:ink');
  window.__certificateLayout = { ok: problems.length === 0, problems: problems, bookSize: size, studentSize: window.__studentSize, lines: lines, inkH: Math.round(inkH) };
  window.__certificateReady = true;
})();
</script>
'''

open(out, 'w', encoding='utf8', newline='\n').write(head + body.rstrip() + script + '</body>\n</html>\n')
print('ok', len(head + body + script))
