/* ADMIN_APP_V1 (2026-09-07)
   App-shell behaviour for the admin views. Loaded with <script defer>
   after each page's inline scripts, so page globals (render, all,
   activeFilters, computeStage, switchTab ...) already exist when this
   runs. Everything is feature-detected: a page that lacks a hook is
   simply left alone. No server routes are touched. */
(function () {
  'use strict';
  var P = location.pathname;
  var IS_PUBLIC = P.indexOf('/company-report/') === 0;   // client-facing tokenised report: no admin chrome
  var MQ = window.matchMedia ? window.matchMedia('(max-width: 900px)') : { matches: false };
  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  var ss = { get: function (k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } },
             set: function (k, v) { try { sessionStorage.setItem(k, v); } catch (e) {} } };

  var ICONS = {
    list: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    suivi: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
    relance: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16v12H7l-3 3z"/></svg>',
    client: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18"/><path d="M5 21V7l8-4v18"/><path d="M19 21V11l-6-4"/></svg>',
    biz: '<svg viewBox="0 0 24 24" fill="none" stroke="#185FA5" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>',
    legal: '<svg viewBox="0 0 24 24" fill="none" stroke="#993C1D" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v18"/><path d="M5 7l-3 6a3 3 0 0 0 6 0l-3-6"/><path d="M19 7l-3 6a3 3 0 0 0 6 0l-3-6"/><path d="M5 7h14"/><path d="M9 21h6"/></svg>',
    mail: '<svg viewBox="0 0 24 24" fill="none" stroke="#0F6E56" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 6l-10 7L2 6"/></svg>',
    renew: '<svg viewBox="0 0 24 24" fill="none" stroke="#534AB7" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>',
    caja: '<svg viewBox="0 0 24 24" fill="none" stroke="#B7791F" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v18"/><path d="M5 7l-3 6a3 3 0 0 0 6 0l-3-6"/><path d="M19 7l-3 6a3 3 0 0 0 6 0l-3-6"/><path d="M5 7h14"/><path d="M9 21h6"/><circle cx="12" cy="3" r="2"/></svg>'
  };

  /* ── 1. Bottom navigation ─────────────────────────────────────── */
  function buildNav() {
    if (IS_PUBLIC || $('.aa-nav')) return;
    var items = [
      { href: '/candidates', label: 'Candidats', icon: 'list', match: function (p) { return p === '/candidates' || /^\/candidates\/(?!suivi|relances|company-report)/.test(p); } },
      { href: '/candidates/suivi', label: 'Suivi', icon: 'suivi', match: function (p) { return p.indexOf('/candidates/suivi') === 0; } },
      { href: '/candidates/relances', label: 'Relances', icon: 'relance', match: function (p) { return p.indexOf('/candidates/relances') === 0; } },
      { href: '/candidates/company-report', label: 'Clients', icon: 'client', match: function (p) { return p.indexOf('/candidates/company-report') === 0; } }
    ];
    var nav = document.createElement('nav');
    nav.className = 'aa-nav';
    nav.setAttribute('aria-label', 'Navigation');
    nav.innerHTML = items.map(function (it) {
      return '<a href="' + it.href + '"' + (it.match(P) ? ' class="active"' : '') + '>' + ICONS[it.icon] + '<span>' + it.label + '</span></a>';
    }).join('');
    document.body.appendChild(nav);
    // suivi / company_report use .header as their top bar: tag it for CSS
    var h = $('body > .header');
    if (h && $('h1', h)) h.classList.add('aa-page-header');
  }

  /* ── 2. Tables → cards: label every td from its column header ───── */
  function labelTable(table) {
    var ths = $$('thead th', table);
    if (!ths.length) return;
    var labels = ths.map(function (th) { return (th.textContent || '').replace(/[\u25be\u2195\u21d5\u2191\u2193]/g, '').replace(/\s+/g, ' ').trim(); });
    if (table.tBodies[0] && table.tBodies[0].id === 'candidateList') {
      // name / actions / checkbox carry no label on the card; stage is self-describing
      labels = labels.map(function (l, i) { return (i === 0 || i === 1 || i === 5 || i === 7) ? '' : l; });
    }
    var apply = function () {
      $$('tbody tr', table).forEach(function (tr) {
        var tds = tr.children;
        for (var i = 0; i < tds.length; i++) {
          var td = tds[i];
          if (td.tagName !== 'TD') continue;
          if (td.colSpan > 1) { td.removeAttribute('data-label'); continue; }
          var l = labels[i] || '';
          if (td.getAttribute('data-label') !== l) td.setAttribute('data-label', l);
        }
      });
    };
    table.classList.add('aa-cards');
    apply();
    var tb = table.tBodies[0];
    if (tb && window.MutationObserver) new MutationObserver(apply).observe(tb, { childList: true });
  }
  function buildCards() {
    $$('table').forEach(function (t) { if (t.tHead) labelTable(t); });
  }

  /* ── 3. Candidates list ───────────────────────────────────────── */
  function candidatesList() {
    var tbody = document.getElementById('candidateList');
    if (!tbody || typeof window.render !== 'function' || typeof window.computeStage !== 'function') return;
    var card = tbody.closest('.card'); if (card) card.classList.add('aa-cardbox');
    var distBar = document.getElementById('stageDistBar'); if (distBar && distBar.parentNode) distBar.parentNode.classList.add('aa-dist');

    // sticky wrapper around search row + tabs (display:contents on desktop → no layout change)
    var header = $('.container > .header');
    var tabsDiv = document.getElementById('tabActiveBtn') && document.getElementById('tabActiveBtn').parentNode;
    if (header && tabsDiv && header.parentNode === tabsDiv.parentNode) {
      var wrap = document.createElement('div'); wrap.className = 'aa-sticky';
      header.parentNode.insertBefore(wrap, header);
      wrap.appendChild(header);
      tabsDiv.classList.add('aa-tabs');
      wrap.appendChild(tabsDiv);
      var sb = document.getElementById('searchBox');
      if (sb) { sb.setAttribute('type', 'search'); sb.setAttribute('autocomplete', 'off'); sb.setAttribute('placeholder', 'Rechercher un candidat, une entreprise\u2026'); }

      // one-tap stage chips (mobile) — drive the existing status column filter
      var STAGE_LABELS = window.STAGE_LABELS, stageBucket = window.stageBucket, BUCKET_LABELS = window.BUCKET_LABELS, BUCKET_COLORS = window.BUCKET_COLORS;
      if (STAGE_LABELS && stageBucket && BUCKET_LABELS && BUCKET_COLORS && window.activeFilters) {
        var bucketLabels = [[], [], []];
        for (var i = 1; i < STAGE_LABELS.length; i++) bucketLabels[stageBucket(i)].push(STAGE_LABELS[i]);
        bucketLabels[stageBucket(6)].push('Proposition cr\u00e9\u00e9e (non envoy\u00e9e)');
        var chips = document.createElement('div'); chips.className = 'aa-chips';
        chips.innerHTML = '<button type="button" class="aa-chip" data-b="all">Tous</button>' + BUCKET_LABELS.map(function (l, b) {
          return '<button type="button" class="aa-chip" data-b="' + b + '"><span class="dot" style="background:' + BUCKET_COLORS[b] + '"></span>' + l + '</button>';
        }).join('');
        wrap.appendChild(chips);
        var sameSet = function (set, arr) { if (!set || set.size !== arr.length) return false; for (var k = 0; k < arr.length; k++) if (!set.has(arr[k])) return false; return true; };
        var syncChips = function () {
          var cur = window.activeFilters.status, act = 'all';
          for (var b = 0; b < 3; b++) if (sameSet(cur, bucketLabels[b])) act = String(b);
          if (act === 'all' && cur && cur.size) act = null; // a custom dropdown selection: no chip lit
          $$('.aa-chip', chips).forEach(function (c) { c.classList.toggle('active', c.getAttribute('data-b') === act); });
        };
        chips.addEventListener('click', function (e) {
          var c = e.target.closest('.aa-chip'); if (!c) return;
          var b = c.getAttribute('data-b'), btn = document.getElementById('cfb-status');
          if (b === 'all' || c.classList.contains('active')) { delete window.activeFilters.status; if (btn) btn.classList.remove('active'); }
          else { window.activeFilters.status = new Set(bucketLabels[+b]); if (btn) btn.classList.add('active'); }
          window.render();
          syncChips();
        });
        chips._sync = syncChips;
      }
    }

    // floating "+" → action sheet (mobile)
    var fab = document.createElement('button'); fab.type = 'button'; fab.className = 'aa-fab'; fab.setAttribute('aria-label', 'Nouveau'); fab.textContent = '+';
    var sheet = document.createElement('div'); sheet.className = 'aa-sheet';
    sheet.innerHTML = '<div class="aa-sheet-panel"><div class="aa-sheet-grip"></div>'
      + '<a href="/candidates/new">' + ICONS.biz + 'Business English</a>'
      + '<a href="/candidates/new-legal">' + ICONS.legal + 'Legal English</a>'
      + '<button type="button" data-act="invite">' + ICONS.mail + 'Invite candidate</button>'
      + '<a href="/candidates/new-renewal">' + ICONS.renew + 'Renewal</a>'
      + '<a href="/candidates/new-renewal-caja">' + ICONS.caja + 'Renouvellement CAJA</a>'
      + '<button type="button" class="aa-sheet-cancel">Annuler</button></div>';
    document.body.appendChild(fab); document.body.appendChild(sheet);
    fab.addEventListener('click', function () { sheet.classList.add('open'); });
    sheet.addEventListener('click', function (e) {
      if (e.target === sheet || e.target.closest('.aa-sheet-cancel')) { sheet.classList.remove('open'); return; }
      var b = e.target.closest('[data-act="invite"]');
      if (b) { sheet.classList.remove('open'); if (typeof window.showInviteModal === 'function') window.showInviteModal(); }
    });

    // whole card tappable on phones; remember scroll position for the way back
    tbody.addEventListener('click', function (e) {
      if (e.target.closest('a')) { ss.set('aaListScroll', JSON.stringify({ y: window.scrollY, t: Date.now() })); return; }
      if (!MQ.matches || e.target.closest('button,input,label,select')) return;
      var tr = e.target.closest('tr'); var a = tr && $('a.name-link', tr);
      if (a) { ss.set('aaListScroll', JSON.stringify({ y: window.scrollY, t: Date.now() })); location.href = a.getAttribute('href'); }
    });
    var restored = false;
    var afterRender = function () {
      // bucket colour on each card
      if (window.all && window.stageBucket) {
        var byId = {}; window.all.forEach(function (x) { byId[x.id] = x; });
        $$('tr', tbody).forEach(function (tr) {
          var a = $('a.name-link', tr); var id = a && (a.getAttribute('href') || '').split('/').pop(); var x = id && byId[id];
          tr.classList.remove('aa-b0', 'aa-b1', 'aa-b2');
          if (x) tr.classList.add('aa-b' + window.stageBucket(window.computeStage(x).idx));
        });
      }
      var chips = $('.aa-chips'); if (chips && chips._sync) chips._sync();
      if (!restored && $('a.name-link', tbody)) {
        restored = true;
        try { var st = JSON.parse(ss.get('aaListScroll') || 'null'); if (st && Date.now() - st.t < 30 * 60 * 1000) window.scrollTo(0, st.y); } catch (e) {}
      }
    };
    if (window.MutationObserver) new MutationObserver(afterRender).observe(tbody, { childList: true });
    afterRender();

    // live refresh: every 60 s while visible, and on every return to the app
    var lastJson = null, busy = false;
    var refresh = function () {
      if (busy || document.visibilityState !== 'visible' || !window.all) return;
      if ($('.row-chk:checked', tbody)) return;          // don't wipe a bulk selection
      busy = true;
      fetch('/candidates/api/list', { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
        busy = false;
        if (!Array.isArray(d)) return;
        var j = JSON.stringify(d);
        if (lastJson === null) lastJson = JSON.stringify(window.all);
        if (j !== lastJson) { lastJson = j; window.all = d; window.render(); }
      }).catch(function () { busy = false; });
    };
    setInterval(refresh, 60000);
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') refresh(); });
  }

  /* ── 4. Candidate detail page ─────────────────────────────────── */
  function candidatePage() {
    var steps = $('.progress-steps');
    if (!steps || !document.getElementById('pstep0')) return;
    var TARGET = { pstep0: ['eval', 'stepsCompact'], pstep1: ['eval', 'stepsCompact'], pstep2: ['eval', 'stepsCompact'], pstep3: ['eval', 'stepsCompact'], pstep4: ['eval', 'stepsCompact'],
      pstep5: ['dossier', 'stage6'], pstep6: ['dossier', 'stage7'], pstep7: ['dossier', 'stage7'], pstep8: ['dossier', 'stage8'],
      pstep10: ['formation', 'stage11'], pstep9: ['formation', 'stage9'] };
    var tabBtn = function (name) { return $$('.tab-btn').filter(function (b) { return (b.getAttribute('onclick') || '').indexOf("'" + name + "'") !== -1; })[0] || null; };
    var goTo = function (name, anchorId) {
      if (typeof window.switchTab === 'function') window.switchTab(name, tabBtn(name));
      ss.set('aaTab:' + P, name);
      var el = document.getElementById(anchorId);
      if (el) setTimeout(function () { var y = el.getBoundingClientRect().top + window.scrollY - 64; window.scrollTo({ top: y, behavior: 'smooth' }); }, 30);
    };

    var strip = document.createElement('div'); strip.className = 'aa-stepstrip';
    $('.progress-card').parentNode.insertBefore(strip, $('.progress-card'));
    var build = function () {
      var all = $$('.progress-step', steps), total = all.length;
      var active = all.filter(function (s) { return s.classList.contains('active'); })[0];
      var dones = all.filter(function (s) { return s.classList.contains('done'); });
      var cur = active || dones[dones.length - 1] || all[0];
      var pos = all.indexOf(cur) + 1;
      var label = ($('.step-label', cur) || {}).textContent || '', sub = ($('.step-sublabel', cur) || {}).textContent || '';
      var finished = !active && dones.length === all.filter(function (s) { return !s.classList.contains('na'); }).length;
      strip.innerHTML = '<div class="aa-dots">' + all.map(function (s) {
        return '<span class="' + (s.classList.contains('done') ? 'done' : s.classList.contains('active') ? 'active' : s.classList.contains('na') ? 'na' : '') + '"></span>';
      }).join('') + '</div><div class="aa-row"><div><div class="aa-k">' + (active ? '\u00c9tape en cours' : finished ? 'Parcours termin\u00e9' : 'Derni\u00e8re \u00e9tape') + ' \u00b7 ' + pos + '/' + total + '</div>'
        + '<div class="aa-t">' + label + '</div><div class="aa-s">' + sub + '</div></div>'
        + '<button type="button" class="aa-go' + (active ? '' : ' done') + '" data-step="' + cur.id + '">' + (active ? 'Y aller \u2192' : 'Voir') + '</button></div>';
    };
    strip.addEventListener('click', function (e) {
      var b = e.target.closest('.aa-go'); if (!b) return;
      var t = TARGET[b.getAttribute('data-step')]; if (t) goTo(t[0], t[1]);
    });
    build();
    if (window.MutationObserver) new MutationObserver(build).observe(steps, { attributes: true, subtree: true, attributeFilter: ['class'] });

    // remember the last tab per candidate (session-scoped)
    document.addEventListener('click', function (e) {
      var b = e.target.closest('.tab-btn'); if (!b) return;
      var m = /switchTab\('([^']+)'/.exec(b.getAttribute('onclick') || '');
      if (m) ss.set('aaTab:' + P, m[1]);
    });
    var saved = ss.get('aaTab:' + P);
    if (saved && typeof window.switchTab === 'function' && document.getElementById('tab-' + saved)) window.switchTab(saved, tabBtn(saved));
  }

  function init() {
    buildNav();
    buildCards();
    candidatesList();
    candidatePage();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
