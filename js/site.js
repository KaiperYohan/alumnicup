// Shared page behaviour for index.html and results/<year>.html:
// menu, language toggle, countdowns, photo lightbox, admin link, footer year.

function toggleMenu() {
  document.getElementById('navMenu').classList.toggle('active');
}

function closeMenu() {
  document.getElementById('navMenu').classList.remove('active');
}

function toggleLanguage() {
  document.body.classList.toggle('korean');
  document.documentElement.lang = document.body.classList.contains('korean') ? 'ko' : 'en';
  localStorage.setItem('language', document.body.classList.contains('korean') ? 'ko' : 'en');
}

// Remember language preference
if (localStorage.getItem('language') === 'ko') {
  document.body.classList.add('korean');
  document.documentElement.lang = 'ko';
}

// "D-36" countdowns. Filled in at load so the page never needs a rebuild
// just because a day passed; the build only writes the target date.
(function() {
  var today = new Date(); today.setHours(0, 0, 0, 0);
  document.querySelectorAll('[data-countdown]').forEach(function(el) {
    var p = el.getAttribute('data-countdown').split('-');
    var days = Math.round((new Date(+p[0], p[1] - 1, +p[2]) - today) / 86400000);
    var ko = !!el.closest('.lang-ko');
    if (days > 1) el.textContent = ko ? '· D-' + days : '· in ' + days + ' days';
    else if (days === 1) el.textContent = ko ? '· 내일' : '· tomorrow';
    else if (days === 0) el.textContent = ko ? '· 오늘!' : '· today!';
    else el.remove();
  });
})();

// Photo lightbox: tap any gallery photo to view it full size, then swipe or
// use the arrow keys through the rest of that year's photos.
(function() {
  var imgs = Array.prototype.slice.call(document.querySelectorAll('.photo-grid img'));
  if (!imgs.length) return;
  var box = document.createElement('div');
  box.className = 'lightbox';
  box.hidden = true;
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-label', 'Photo viewer');
  box.innerHTML = '<button type="button" class="lb-close" aria-label="Close">×</button>' +
    '<button type="button" class="lb-prev" aria-label="Previous photo">‹</button>' +
    '<figure><img alt=""><figcaption></figcaption></figure>' +
    '<button type="button" class="lb-next" aria-label="Next photo">›</button>';
  document.body.appendChild(box);
  var big = box.querySelector('img'), cap = box.querySelector('figcaption');
  var list = [], at = 0, opener = null;

  function show(n) {
    at = (n + list.length) % list.length;
    big.src = list[at].currentSrc || list[at].src;
    big.alt = list[at].alt;
    cap.textContent = list[at].alt + '  ·  ' + (at + 1) + ' / ' + list.length;
  }
  function open(img) {
    var scope = img.closest('.photo-gallery') || document;
    list = Array.prototype.slice.call(scope.querySelectorAll('.photo-grid img'));
    opener = img;
    show(list.indexOf(img));
    box.hidden = false;
    document.body.style.overflow = 'hidden';
    box.querySelector('.lb-close').focus();
  }
  function close() {
    box.hidden = true;
    document.body.style.overflow = '';
    big.removeAttribute('src');
    if (opener) opener.focus();
  }

  imgs.forEach(function(img) {
    img.tabIndex = 0;
    img.setAttribute('role', 'button');
    img.addEventListener('click', function() { open(img); });
    img.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(img); }
    });
  });
  box.querySelector('.lb-close').addEventListener('click', close);
  box.querySelector('.lb-prev').addEventListener('click', function() { show(at - 1); });
  box.querySelector('.lb-next').addEventListener('click', function() { show(at + 1); });
  box.addEventListener('click', function(e) { if (e.target === box || e.target.tagName === 'FIGURE') close(); });
  document.addEventListener('keydown', function(e) {
    if (box.hidden) return;
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowRight') show(at + 1);
    else if (e.key === 'ArrowLeft') show(at - 1);
    else if (e.key === 'Tab') {
      // Keep focus inside the viewer while it is open.
      var b = box.querySelectorAll('button'), first = b[0], last = b[b.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });
  var x0 = null;
  box.addEventListener('touchstart', function(e) { x0 = e.touches[0].clientX; }, { passive: true });
  box.addEventListener('touchend', function(e) {
    if (x0 === null) return;
    var dx = e.changedTouches[0].clientX - x0;
    if (Math.abs(dx) > 50) show(at + (dx < 0 ? 1 : -1));
    x0 = null;
  });

  document.querySelectorAll('.photo-more').forEach(function(btn) {
    btn.addEventListener('click', function() {
      btn.closest('.photo-gallery').querySelectorAll('.photo-category.more').forEach(function(c) { c.hidden = false; });
      btn.remove();
    });
  });
})();

// Show the Admin link only in a browser that has signed in to admin.html
// (Supabase keeps its session under an "sb-<project>-auth-token" key).
// The admin page itself checks who you are; this only saves a visitor
// from seeing a link that is useless to them.
(function() {
  try {
    for (var i = 0; i < localStorage.length; i++) {
      if (/^sb-.+-auth-token$/.test(localStorage.key(i))) {
        document.querySelector('.nav-admin').hidden = false;
        break;
      }
    }
  } catch (e) {}
})();

// Dynamic copyright year
(function() {
  var y = new Date().getFullYear();
  var txt = y > 2025 ? '2025-' + y : '2025';
  document.getElementById('yearEn').textContent = txt;
  document.getElementById('yearKo').textContent = txt;
})();

// Results pages: school filter chips above each individual table.
(function() {
  document.querySelectorAll('.chips[data-filter]').forEach(function(group) {
    var table = document.getElementById(group.getAttribute('data-filter'));
    if (!table) return;
    group.addEventListener('click', function(e) {
      var btn = e.target.closest('button');
      if (!btn) return;
      group.querySelectorAll('button').forEach(function(b) { b.setAttribute('aria-pressed', b === btn); });
      var school = btn.getAttribute('data-school');
      table.querySelectorAll('tbody tr[data-school]').forEach(function(tr) {
        tr.hidden = !!school && tr.getAttribute('data-school') !== school;
      });
    });
  });
})();
