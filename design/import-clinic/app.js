/* ============================================================
   DaleControl · Importar mi clínica — lógica del prototipo
   Vanilla JS, sin dependencias. Solo navegación + estados de UI.
   ============================================================ */
(function () {
  "use strict";

  // ---------- THEME ----------
  var root = document.documentElement;
  var themeBtn = document.getElementById('themeBtn');
  function applyTheme(dark) {
    root.classList.toggle('dark', dark);
    document.getElementById('themeIc').firstElementChild.setAttribute('href', dark ? '#i-sun' : '#i-moon');
    document.getElementById('themeLbl').textContent = dark ? 'Claro' : 'Oscuro';
    try { localStorage.setItem('dc-theme', dark ? 'dark' : 'light'); } catch (e) {}
  }
  var saved;
  try { saved = localStorage.getItem('dc-theme'); } catch (e) {}
  applyTheme(saved ? saved === 'dark' : false);
  themeBtn.addEventListener('click', function () { applyTheme(!root.classList.contains('dark')); });

  // ---------- DATA: orígenes ----------
  var SOURCES = [
    { id: 'dentalink',    nm: 'Dentalink',    c: '#0ea5e9', profile: true,  meta: 'Perfil listo' },
    { id: 'medilink',     nm: 'Medilink',     c: '#14b8a6', profile: true,  meta: 'Perfil listo' },
    { id: 'identalsoft',  nm: 'iDentalSoft',  c: '#f97316', profile: true,  meta: 'Perfil listo' },
    { id: 'opendental',   nm: 'Open Dental',  c: '#16a34a', profile: true,  meta: 'Perfil listo' },
    { id: 'dentrix',      nm: 'Dentrix',      c: '#2563eb', profile: true,  meta: 'Perfil listo' },
    { id: 'eaglesoft',    nm: 'Eaglesoft',    c: '#7c3aed', profile: true,  meta: 'Perfil listo' },
    { id: 'gesden',       nm: 'Gesden',       c: '#dc2626', profile: true,  meta: 'Perfil listo' },
    { id: 'dentidesk',    nm: 'Dentidesk',    c: '#0891b2', profile: true,  meta: 'Perfil listo' },
    { id: 'dentalcore',   nm: 'DentalCore',   c: '#db2777', profile: true,  meta: 'Perfil listo' },
    { id: 'excel',        nm: 'Mi Excel',     c: '#15803d', profile: false, meta: 'Mapeo manual', glyph: 'XLS' },
    { id: 'otro',         nm: 'Otro',         c: '#6b7280', profile: false, meta: 'Mapeo manual', glyph: '?' }
  ];

  // ---------- ESTADO ----------
  var state = {
    step: 1,
    flow: 'wizard',         // 'wizard' | 'assisted'
    origin: null,
    skipDup: true
  };
  var STEPS = [
    { n: 1, lbl: 'Origen' },
    { n: 2, lbl: 'Exportar' },
    { n: 3, lbl: 'Qué importar' },
    { n: 4, lbl: 'Subir' },
    { n: 5, lbl: 'Mapear' },
    { n: 6, lbl: 'Revisar' }
  ];

  // ---------- REFS ----------
  var scrim = document.getElementById('scrim');
  var stepbar = document.getElementById('stepbar');
  var panels = document.querySelectorAll('.wz-panel');
  var btnBack = document.getElementById('btnBack');
  var btnNext = document.getElementById('btnNext');
  var footHint = document.getElementById('footHint');
  var wzFoot = document.getElementById('wzFoot');
  var wzHeadSub = document.getElementById('wzHeadSub');

  function svg(id, cls) { return '<svg class="' + (cls || 'ic') + '"><use href="#' + id + '"/></svg>'; }
  function sourceById(id) { for (var i = 0; i < SOURCES.length; i++) if (SOURCES[i].id === id) return SOURCES[i]; return null; }
  function logoHtml(s, size) {
    var st = 'background:' + s.c;
    if (size) st += ';width:' + size + 'px;height:' + size + 'px';
    return '<div class="logo" style="' + st + '">' + (s.glyph || s.nm.charAt(0)) + '</div>';
  }

  // ---------- PASO 1: grid de orígenes ----------
  var srcGrid = document.getElementById('srcGrid');
  function renderSources() {
    srcGrid.innerHTML = SOURCES.map(function (s) {
      return '<button class="src-card" type="button" role="button" aria-pressed="false" data-src="' + s.id + '">' +
        '<div class="check">' + svg('i-check') + '</div>' +
        logoHtml(s) +
        '<div><div class="nm">' + s.nm + '</div></div>' +
        '<div class="meta">' + s.meta + '</div>' +
      '</button>';
    }).join('');
    srcGrid.querySelectorAll('.src-card').forEach(function (el) {
      el.addEventListener('click', function () { selectSource(el.getAttribute('data-src')); });
    });
  }
  function selectSource(id) {
    state.origin = id;
    srcGrid.querySelectorAll('.src-card').forEach(function (el) {
      el.setAttribute('aria-pressed', el.getAttribute('data-src') === id ? 'true' : 'false');
    });
    updateFooter();
  }

  // ---------- PASO 2: instrucciones por origen ----------
  var INSTRUCTIONS = {
    dentalink: [
      { h: 'Entra a Dentalink', p: 'Inicia sesión y abre el menú <code>Configuración</code> en la esquina superior derecha.' },
      { h: 'Ve a Exportar datos', p: 'En la sección <code>Datos &amp; Respaldos</code> elige <code>Exportar pacientes</code>.' },
      { h: 'Selecciona el rango', p: 'Marca «Todos los pacientes» y el formato <code>Excel (.xlsx)</code>.' },
      { h: 'Descarga el archivo', p: 'Pulsa <code>Generar</code> y guarda el archivo en tu computadora. Lo subirás en el siguiente paso.' }
    ]
  };
  var GENERIC_INSTR = [
    { h: 'Abre tu sistema', p: 'Entra a la sección de pacientes o reportes de tu software actual.' },
    { h: 'Busca «Exportar»', p: 'La mayoría de los sistemas permiten exportar a <code>Excel (.xlsx)</code> o <code>CSV</code>.' },
    { h: 'Exporta todos los registros', p: 'Selecciona el rango completo y descarga el archivo.' },
    { h: 'Guárdalo a la mano', p: 'Lo subirás en el siguiente paso. Si tu archivo no tiene encabezados claros, no te preocupes: te ayudamos a mapearlo.' }
  ];
  function renderExport() {
    var s = sourceById(state.origin);
    var c = document.getElementById('exportContent');
    var sub = document.getElementById('expSub');
    if (!s) { c.innerHTML = ''; return; }

    if (s.id === 'excel' || s.id === 'otro') {
      sub.textContent = 'Usa nuestra plantilla para acomodar tus datos. Así el mapeo será más rápido.';
      c.innerHTML =
        '<div class="src-pill">' + logoHtml(s) + '<span class="nm">' + s.nm + '</span></div>' +
        '<div class="dl-card">' +
          '<div class="ic-wrap">' + svg('i-download', 'ic') + '</div>' +
          '<div class="body"><b>Plantilla de DaleControl (.xlsx)</b>' +
          '<p>Tres pestañas: Pacientes, Saldos y Citas. Copia y pega tus datos en las columnas indicadas.</p></div>' +
          '<button class="btn btn--brand">' + svg('i-download') + ' Descargar plantilla</button>' +
        '</div>' +
        '<div class="note" style="margin-top:16px">' + svg('i-file') +
          '<p>¿Ya tienes tu propio archivo? También funciona. Solo asegúrate de que la primera fila tenga los nombres de las columnas.</p></div>';
    } else {
      sub.textContent = 'Sigue estos pasos para obtener el archivo desde ' + s.nm + '.';
      var steps = INSTRUCTIONS[s.id] || GENERIC_INSTR;
      c.innerHTML =
        '<div class="src-pill">' + logoHtml(s) + '<span class="nm">' + s.nm + '</span></div>' +
        '<div class="steps-list">' + steps.map(function (it, i) {
          return '<div class="step-row"><div class="idx">' + (i + 1) + '</div>' +
            '<div class="body"><h4>' + it.h + '</h4><p>' + it.p + '</p></div></div>';
        }).join('') + '</div>';
    }
  }

  // ---------- PASO 3: qué importar ----------
  var DATATYPES = [
    { id: 'pacientes', nm: 'Pacientes', ic: 'i-users', meta: 'Nombre, contacto, fecha de nacimiento', badge: 'rec', on: true },
    { id: 'saldos',    nm: 'Saldos',    ic: 'i-money', meta: 'Adeudos y pagos a favor por paciente', badge: 'easy', on: true },
    { id: 'citas',     nm: 'Citas próximas', ic: 'i-calendar', meta: 'Agenda futura para no perder ninguna', badge: 'easy', on: true },
    { id: 'tratamientos', nm: 'Tratamientos', ic: 'i-stack', meta: 'Planes y procedimientos por paciente', badge: 'adv', on: false },
    { id: 'historial', nm: 'Historial clínico', ic: 'i-file', meta: 'Notas y evolución (requiere más mapeo)', badge: 'adv', on: false }
  ];
  function badgeHtml(b) {
    if (b === 'rec')  return '<span class="badge badge--brand">Recomendado</span>';
    if (b === 'easy') return '<span class="badge badge--ok"><span class="dot"></span>Fácil</span>';
    if (b === 'adv')  return '<span class="badge badge--warn">Avanzado</span>';
    return '';
  }
  var optList = document.getElementById('optList');
  function renderOpts() {
    optList.innerHTML = DATATYPES.map(function (d) {
      return '<label class="opt' + (d.on ? ' is-on' : '') + '" data-opt="' + d.id + '">' +
        '<span class="box">' + svg('i-check') + '</span>' +
        '<span class="opt-ic">' + svg(d.ic) + '</span>' +
        '<span class="info"><span class="nm">' + d.nm + ' ' + badgeHtml(d.badge) + '</span>' +
        '<span class="meta">' + d.meta + '</span></span>' +
        '<input type="checkbox" ' + (d.on ? 'checked' : '') + '>' +
      '</label>';
    }).join('');
    optList.querySelectorAll('.opt').forEach(function (el) {
      var input = el.querySelector('input');
      el.addEventListener('click', function (e) {
        if (e.target !== input) input.checked = !input.checked;
        el.classList.toggle('is-on', input.checked);
        var d = DATATYPES.filter(function (x) { return x.id === el.getAttribute('data-opt'); })[0];
        if (d) d.on = input.checked;
      });
    });
  }

  // ---------- PASO 4: dropzone ----------
  var uploadArea = document.getElementById('uploadArea');
  var fileInput = document.getElementById('fileInput');
  var uploadState = 'empty'; // empty | loaded | error
  function emptyDropzone(msg) {
    return '<div class="dropzone" id="dz" tabindex="0" role="button" aria-label="Subir archivo">' +
      '<div class="dz-ic">' + svg('i-cloud', 'ic') + '</div>' +
      '<h4>Arrastra tu archivo aquí</h4>' +
      '<p>o haz clic para buscarlo en tu equipo</p>' +
      '<p class="formats">Formatos: .xlsx o .csv · máx. 5&nbsp;MB</p>' +
      '</div>' + (msg || '');
  }
  function loadedFile() {
    return '<div class="file-row">' +
      '<div class="f-ic">' + svg('i-file', 'ic') + '</div>' +
      '<div class="f-body"><div class="nm">pacientes_dentalink.xlsx</div>' +
      '<div class="meta">2.4 MB · 1,265 filas detectadas</div>' +
      '<div class="bar"><i style="width:100%"></i></div></div>' +
      '<button class="btn btn--sm" id="removeFile">Quitar</button>' +
      '</div>' +
      '<div class="inline-error" style="color:var(--ok)">' + svg('i-check') + ' Archivo válido. Continúa al mapeo.</div>';
  }
  function renderUpload() {
    if (uploadState === 'loaded') {
      uploadArea.innerHTML = loadedFile();
      document.getElementById('removeFile').addEventListener('click', function () { uploadState = 'empty'; renderUpload(); updateFooter(); });
    } else if (uploadState === 'error') {
      uploadArea.innerHTML =
        '<div class="dropzone is-error" id="dz" tabindex="0" role="button">' +
        '<div class="dz-ic">' + svg('i-alert', 'ic') + '</div>' +
        '<h4>No pudimos usar ese archivo</h4>' +
        '<p>Debe ser .xlsx o .csv y pesar menos de 5&nbsp;MB.</p>' +
        '<p class="formats">Vuelve a intentarlo con el archivo correcto.</p>' +
        '</div>' +
        '<div class="inline-error">' + svg('i-alert') + ' El archivo «historial.pdf» (8.2 MB) no es compatible.</div>';
      bindDz();
    } else {
      uploadArea.innerHTML = emptyDropzone();
      bindDz();
    }
    updateFooter();
  }
  function bindDz() {
    var dz = document.getElementById('dz');
    if (!dz) return;
    dz.addEventListener('click', function () { fileInput.click(); });
    dz.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } });
    dz.addEventListener('dragover', function (e) { e.preventDefault(); dz.classList.add('is-drag'); });
    dz.addEventListener('dragleave', function () { dz.classList.remove('is-drag'); });
    dz.addEventListener('drop', function (e) {
      e.preventDefault(); dz.classList.remove('is-drag');
      handleFile(e.dataTransfer.files && e.dataTransfer.files[0]);
    });
  }
  fileInput.addEventListener('change', function () { handleFile(fileInput.files[0]); });
  function handleFile(f) {
    if (!f) { uploadState = 'loaded'; renderUpload(); return; } // demo: si arrastran cualquier cosa, simulamos OK
    var name = f.name.toLowerCase();
    var okType = name.endsWith('.xlsx') || name.endsWith('.csv');
    var okSize = f.size <= 5 * 1024 * 1024;
    uploadState = (okType && okSize) ? 'loaded' : 'error';
    renderUpload();
  }

  // ---------- PASO 5: mapeo ----------
  var DC_FIELDS = [
    { v: '', t: '— Sin importar —' },
    { v: 'nombre', t: 'Nombre completo' },
    { v: 'telefono', t: 'Teléfono' },
    { v: 'email', t: 'Correo electrónico' },
    { v: 'nacimiento', t: 'Fecha de nacimiento' },
    { v: 'saldo', t: 'Saldo' },
    { v: 'rfc', t: 'RFC' },
    { v: 'direccion', t: 'Dirección' }
  ];
  // columnas detectadas del archivo + sugerencia (perfil) y muestra
  var MAP_ROWS = [
    { col: 'Nombre del paciente', sample: 'María González R.', auto: 'nombre' },
    { col: 'Celular',             sample: '55 1234 5678',      auto: 'telefono' },
    { col: 'Correo',              sample: 'maria@correo.com',  auto: 'email' },
    { col: 'F. Nacimiento',       sample: '14/03/1988',        auto: 'nacimiento' },
    { col: 'Saldo $',             sample: '1,250.00',          auto: 'saldo' },
    { col: 'Notas internas',      sample: 'Alérgica a penicilina', auto: '' }
  ];
  function renderMap() {
    var s = sourceById(state.origin);
    var isProfile = s && s.profile;
    var banner = document.getElementById('mapStatusBanner');
    var sub = document.getElementById('mapSub');
    if (isProfile) {
      sub.textContent = 'Reconocimos el formato de ' + s.nm + ' y emparejamos las columnas automáticamente. Revisa que todo cuadre.';
      banner.innerHTML = '<div class="callout" style="margin-top:0"><div class="ic-wrap" style="background:var(--ok-soft);color:var(--ok)">' + svg('i-spark', 'ic') + '</div>' +
        '<div class="txt"><b>Mapeo automático aplicado</b><p>5 de 6 columnas se emparejaron solas gracias al perfil de ' + s.nm + '.</p></div></div>';
    } else {
      sub.textContent = 'Empareja manualmente cada columna de tu archivo con un campo de DaleControl.';
      banner.innerHTML = '<div class="callout" style="margin-top:0;border-color:var(--warn-border);background:var(--warn-soft)"><div class="ic-wrap" style="background:var(--warn-soft);color:var(--warn)">' + svg('i-alert', 'ic') + '</div>' +
        '<div class="txt"><b>Mapeo manual</b><p>Como tu origen es «' + (s ? s.nm : 'Otro') + '», elige a mano el campo de cada columna.</p></div></div>';
    }

    var body = document.getElementById('mapBody');
    body.innerHTML = MAP_ROWS.map(function (r, i) {
      var selected = isProfile ? r.auto : '';
      var opts = DC_FIELDS.map(function (f) {
        return '<option value="' + f.v + '"' + (f.v === selected ? ' selected' : '') + '>' + f.t + '</option>';
      }).join('');
      var unmapped = !selected;
      return '<tr>' +
        '<td><div style="font-weight:500">' + r.col + '</div><div class="sample">Ej. ' + r.sample + '</div></td>' +
        '<td class="col-arrow">' + svg('i-arrow-r') + '</td>' +
        '<td><div class="select' + (unmapped ? ' is-unmapped' : '') + '"><label class="visually-hidden" for="map' + i + '"></label>' +
          '<select id="map' + i + '" data-row="' + i + '" aria-label="Campo para ' + r.col + '">' + opts + '</select></div></td>' +
        '<td><span class="map-status ' + (isProfile && selected ? 'auto' : (unmapped ? 'skip' : 'manual')) + '" data-stat="' + i + '">' +
          (isProfile && selected ? svg('i-spark') + 'Automático' : (unmapped ? svg('i-x') + 'Sin mapear' : svg('i-check') + 'Manual')) +
        '</span></td>' +
      '</tr>';
    }).join('');

    body.querySelectorAll('select').forEach(function (sel) {
      sel.addEventListener('change', function () {
        var i = sel.getAttribute('data-row');
        var wrap = sel.closest('.select');
        var stat = body.querySelector('[data-stat="' + i + '"]');
        if (sel.value) {
          wrap.classList.remove('is-unmapped');
          stat.className = 'map-status manual'; stat.innerHTML = svg('i-check') + 'Manual';
        } else {
          wrap.classList.add('is-unmapped');
          stat.className = 'map-status skip'; stat.innerHTML = svg('i-x') + 'Sin mapear';
        }
      });
    });
  }

  // ---------- PASO 6: revisar ----------
  var REVIEW_ROWS = [
    { f: 1,  nm: 'María González Ramírez', tel: '55 1234 5678', sal: '$1,250', st: 'ok' },
    { f: 2,  nm: 'Jorge Hernández L.',     tel: '55 8765 4321', sal: '$0',     st: 'ok' },
    { f: 3,  nm: 'Ana Patricia Ruiz',      tel: '—',            sal: '$3,400', st: 'err', why: 'Teléfono vacío' },
    { f: 4,  nm: 'Luis Martínez',          tel: '55 2222 1111', sal: '$890',   st: 'ok' },
    { f: 5,  nm: 'María González Ramírez', tel: '55 1234 5678', sal: '$1,250', st: 'dup', why: 'Ya existe (fila 1)' },
    { f: 6,  nm: 'Carlos S.',              tel: 'abc-123',      sal: '$0',     st: 'err', why: 'Teléfono inválido' },
    { f: 7,  nm: 'Diana Flores',           tel: '55 9090 8080', sal: '$2,100', st: 'ok' },
    { f: 8,  nm: 'Roberto Cruz',           tel: '55 3344 5566', sal: '—',      st: 'dup', why: 'Ya existe (fila 4)' }
  ];
  function stBadge(st) {
    if (st === 'ok')  return '<span class="badge badge--ok"><span class="dot"></span>OK</span>';
    if (st === 'err') return '<span class="badge badge--err">Error</span>';
    if (st === 'dup') return '<span class="badge badge--warn">Duplicado</span>';
    return '';
  }
  function renderReview() {
    var body = document.getElementById('reviewBody');
    body.innerHTML = REVIEW_ROWS.map(function (r) {
      var cls = r.st === 'err' ? 'row-err' : (r.st === 'dup' ? 'row-dup' : '');
      var badge = (r.why)
        ? '<span class="tip" tabindex="0">' + stBadge(r.st) + '<span class="tip-bubble">' + r.why + '</span></span>'
        : stBadge(r.st);
      return '<tr class="' + cls + '"><td class="tnum">' + r.f + '</td><td>' + r.nm + '</td><td class="tnum">' + r.tel + '</td><td class="tnum">' + r.sal + '</td><td>' + badge + '</td></tr>';
    }).join('');
  }
  // switch omitir duplicados
  var dupSwitch = document.getElementById('dupSwitch');
  dupSwitch.addEventListener('click', function (e) {
    var input = dupSwitch.querySelector('input');
    if (e.target !== input) input.checked = !input.checked;
    state.skipDup = input.checked;
    dupSwitch.classList.toggle('is-on', input.checked);
  });

  // ---------- STEP BAR ----------
  function renderStepbar() {
    if (state.flow === 'assisted' || state.step === 'importing' || state.step === 'result') {
      stepbar.style.display = 'none'; return;
    }
    stepbar.style.display = '';
    var html = '';
    STEPS.forEach(function (s, i) {
      var cls = 'step';
      if (s.n < state.step) cls += ' is-done';
      else if (s.n === state.step) cls += ' is-current';
      var inner = (s.n < state.step) ? svg('i-check') : s.n;
      html += '<div class="' + cls + '"><div class="num">' + inner + '</div><div class="lbl">' + s.lbl + '</div></div>';
      if (i < STEPS.length - 1) html += '<div class="step-line"></div>';
    });
    stepbar.innerHTML = html;
  }

  // ---------- NAVEGACIÓN / RENDER ----------
  function showPanel(key) {
    panels.forEach(function (p) {
      p.classList.toggle('is-active', p.getAttribute('data-panel') === String(key));
    });
    document.getElementById('wzBody').scrollTop = 0;
  }

  function render() {
    renderStepbar();
    if (state.flow === 'assisted') {
      wzHeadSub.textContent = 'Migración asistida';
      showPanel('assisted');
      wzFoot.style.display = '';
      btnBack.style.display = '';
      footHint.textContent = '';
      btnNext.innerHTML = 'Enviar para revisión ' + svg('i-arrow-r');
      btnNext.disabled = false;
      // si ya enviado, ocultar footer
      if (document.getElementById('assistedSent').style.display !== 'none') wzFoot.style.display = 'none';
      return;
    }

    if (state.step === 'importing') { showPanel('importing'); wzFoot.style.display = 'none'; return; }
    if (state.step === 'result')    { showPanel('result');    wzFoot.style.display = 'none'; return; }

    wzHeadSub.textContent = 'Paso ' + state.step + ' de 6';
    showPanel(state.step);
    wzFoot.style.display = '';
    btnBack.style.display = state.step === 1 ? 'none' : '';

    // contenido por paso
    if (state.step === 2) renderExport();
    if (state.step === 4) renderUpload();
    if (state.step === 5) renderMap();
    if (state.step === 6) renderReview();

    updateFooter();
  }

  function updateFooter() {
    if (state.flow === 'assisted' || state.step === 'importing' || state.step === 'result') return;
    var hint = '', nextLbl = 'Continuar', nextDisabled = false;
    switch (state.step) {
      case 1:
        nextDisabled = !state.origin;
        hint = state.origin ? '' : 'Elige tu sistema para continuar';
        break;
      case 4:
        nextDisabled = uploadState !== 'loaded';
        hint = uploadState === 'loaded' ? '' : 'Sube un archivo .xlsx o .csv';
        break;
      case 6:
        nextLbl = 'Importar 1,240 registros';
        break;
    }
    btnNext.disabled = nextDisabled;
    btnNext.innerHTML = nextLbl + ' ' + svg('i-arrow-r');
    footHint.textContent = hint;
  }

  // ---------- IMPORTANDO (simulado) ----------
  function runImport() {
    state.step = 'importing'; render();
    var bar = document.getElementById('progBar');
    var pct = document.getElementById('progPct');
    var lbl = document.getElementById('progLabel');
    var labels = [[15, 'Validando pacientes…'], [45, 'Importando saldos…'], [75, 'Agendando citas…'], [100, 'Finalizando…']];
    var p = 0;
    var t = setInterval(function () {
      p += Math.random() * 14 + 6;
      if (p >= 100) { p = 100; clearInterval(t); setTimeout(function () { state.step = 'result'; render(); }, 500); }
      bar.style.width = p + '%';
      pct.textContent = Math.round(p) + '%';
      for (var i = 0; i < labels.length; i++) { if (p <= labels[i][0]) { lbl.textContent = labels[i][1]; break; } }
    }, 380);
  }

  // ---------- BOTONES NAV ----------
  btnNext.addEventListener('click', function () {
    if (state.flow === 'assisted') { showAssistedSent(); return; }
    if (state.step === 6) { runImport(); return; }
    if (typeof state.step === 'number' && state.step < 6) { state.step++; render(); }
  });
  btnBack.addEventListener('click', function () {
    if (state.flow === 'assisted') { state.flow = 'wizard'; state.step = 1; render(); return; }
    if (typeof state.step === 'number' && state.step > 1) { state.step--; render(); }
  });

  // ---------- MIGRACIÓN ASISTIDA ----------
  var assistedDrop = document.getElementById('assistedDrop');
  function renderAssistedDrop() {
    assistedDrop.innerHTML = emptyDropzone();
    var dz = assistedDrop.querySelector('#dz');
    dz.id = 'dzA';
    dz.querySelector('h4').textContent = 'Arrastra tu respaldo o exportación';
    dz.querySelector('p').textContent = 'Aceptamos cualquier formato: Excel, CSV, .zip de respaldo, etc.';
    dz.querySelector('.formats').textContent = 'Hasta 50 MB';
    dz.addEventListener('click', function () { document.getElementById('assistedFileInput').click(); });
  }
  document.getElementById('assistedFileInput').addEventListener('change', function () {
    var f = this.files[0];
    if (f) {
      assistedDrop.innerHTML =
        '<div class="file-row"><div class="f-ic">' + svg('i-file', 'ic') + '</div>' +
        '<div class="f-body"><div class="nm">' + f.name + '</div><div class="meta">Listo para enviar</div></div>' +
        '<button class="btn btn--sm" id="rmA">Quitar</button></div>';
      document.getElementById('rmA').addEventListener('click', renderAssistedDrop);
    }
  });
  function openAssisted() {
    state.flow = 'assisted';
    document.getElementById('assistedForm').style.display = '';
    document.getElementById('assistedSent').style.display = 'none';
    renderAssistedDrop();
    openModal(); render();
  }
  function showAssistedSent() {
    document.getElementById('assistedForm').style.display = 'none';
    document.getElementById('assistedSent').style.display = '';
    wzFoot.style.display = 'none';
  }
  document.getElementById('assistedDone').addEventListener('click', closeModal);

  // ---------- ABRIR / CERRAR MODAL ----------
  function resetWizard() {
    state.flow = 'wizard'; state.step = 1; state.origin = null; state.skipDup = true;
    uploadState = 'empty';
    DATATYPES.forEach(function (d) { d.on = (d.badge !== 'adv'); });
    renderOpts();
  }
  function openModal() {
    scrim.classList.add('is-open');
    document.body.style.overflow = 'hidden';
    setTimeout(function () { btnNext.focus(); }, 50);
  }
  function closeModal() {
    scrim.classList.remove('is-open');
    document.body.style.overflow = '';
  }
  function startWizard() { resetWizard(); openModal(); render(); }

  document.getElementById('openWizard').addEventListener('click', startWizard);
  document.getElementById('openWizard2').addEventListener('click', startWizard);
  document.getElementById('openAssisted').addEventListener('click', openAssisted);
  document.getElementById('toAssisted').addEventListener('click', openAssisted);
  document.getElementById('closeWizard').addEventListener('click', closeModal);
  document.getElementById('goPatients').addEventListener('click', closeModal);
  document.getElementById('importAnother').addEventListener('click', startWizard);
  scrim.addEventListener('click', function (e) { if (e.target === scrim) closeModal(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && scrim.classList.contains('is-open')) closeModal(); });

  // ---------- INIT ----------
  renderSources();
  renderOpts();
})();
