// /s/{id}?sig=…: opened from the certificate email. Shows the certificate image and hands it to
// the phone's share sheet as an image file (not a link), like «مشاركة الشهادة» in the app.
// The only script is /assets/share.js (CSP script-src 'self').
import Mustache from 'mustache';

const PAGE = `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>مشاركة الشهادة — المَحجّة البَيْضَاء</title>
<style>
@font-face{font-family:Amiri;font-weight:700;src:url(/fonts/amiri/amiri-arabic-700-normal.woff2) format("woff2");font-display:swap}
@font-face{font-family:Plex;font-weight:400;src:url(/fonts/ibm-plex-sans-arabic/ibm-plex-sans-arabic-arabic-400-normal.woff2) format("woff2");font-display:swap}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;background:#f3ecdd;color:#2b2723;font-family:Plex,system-ui,sans-serif;display:flex;align-items:center;justify-content:center;padding:24px 16px}
main{width:100%;max-width:640px;background:#fbf7ed;border:1px solid #cbb98e;border-radius:16px;padding:28px 20px;text-align:center}
.brand{font-family:Amiri,serif;font-weight:700;font-size:24px;color:#1f4a42;margin:0;line-height:1.5}
h1{font-family:Amiri,serif;font-size:24px;line-height:1.6;margin:10px 0 0}
img.cert{display:block;width:100%;height:auto;margin:18px 0 0;border:1px solid #e3d8bf;border-radius:10px}
.actions{display:flex;flex-direction:column;gap:10px;margin-top:20px}
.btn{display:block;width:100%;font:inherit;font-size:17px;padding:14px 18px;border-radius:12px;cursor:pointer;text-decoration:none}
.primary{background:#1f4a42;color:#fbf7ed;border:1px solid #1f4a42}
.secondary{background:transparent;color:#1f4a42;border:1px solid #1f4a42}
.btn:focus-visible{outline:2px solid #b0894f;outline-offset:2px}
p.hint{color:#5c5343;font-size:14px;line-height:1.9;margin:14px 0 0}
[hidden]{display:none!important}
</style>
</head>
<body>
<main>
  <div class="brand">المَحجّة البَيْضَاء</div>
  <h1>«{{title}}»</h1>
  <img class="cert" src="{{image_path}}" width="2246" height="1588" alt="شهادة إتمام «{{title}}»">
  <div class="actions" id="actions" data-image="{{image_path}}" data-caption="{{caption}}" data-file="{{file_name}}">
    <button class="btn primary" id="share" type="button" hidden>مشاركة الصورة</button>
    <a class="btn secondary" id="save" href="{{download_path}}">حفظ الصورة</a>
  </div>
  <p class="hint" id="hint">اختر واتساب أو فيسبوك أو أي تطبيق من القائمة، فتصل الشهادة صورةً.</p>
</main>
<script src="/assets/share.js"></script>
</body>
</html>`;

// Runs in the student's browser. Feature-detected: without file sharing (most desktops) only «حفظ الصورة» shows.
export const SHARE_JS = `(function(){
var box=document.getElementById('actions'),btn=document.getElementById('share'),hint=document.getElementById('hint');
if(!navigator.canShare||!window.File){hint.hidden=true;return}
var probe=new File([new Blob([''],{type:'image/jpeg'})],'x.jpg',{type:'image/jpeg'});
if(!navigator.canShare({files:[probe]})){hint.hidden=true;return}
var file=null;
fetch(box.dataset.image).then(function(r){if(!r.ok)throw 0;return r.blob()}).then(function(b){
  file=new File([b],box.dataset.file,{type:'image/jpeg'});btn.hidden=false;
}).catch(function(){hint.hidden=true});
btn.addEventListener('click',function(){
  if(!file)return;
  navigator.share({files:[file],text:box.dataset.caption}).catch(function(){});
});
})();`;

export function sharePage({ id, sig, title, caption }) {
  const q = `sig=${sig}`;
  return Mustache.render(PAGE, {
    title,
    caption,
    image_path: `/s/${id}/image?${q}`,
    download_path: `/s/${id}/image?${q}&save=1`,
    file_name: `certificate-${id}.jpg`,
  });
}
