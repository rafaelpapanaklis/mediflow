/* ============================================================
   estados.html — galería de estados (light + dark + móvil)
   Render helpers que reutilizan los mismos componentes.
   ============================================================ */
(function () {
  "use strict";
  function svg(id, cls) { return '<svg class="' + (cls || 'ic') + '"><use href="#' + id + '"/></svg>'; }
  function logo(c, t, sz) {
    var s = 'background:' + c; if (sz) s += ';width:' + sz + 'px;height:' + sz + 'px';
    return '<div class="logo" style="' + s + '">' + t + '</div>';
  }

  var SOURCES = [
    ['Dentalink', '#0ea5e9', 'Perfil listo'], ['Medilink', '#14b8a6', 'Perfil listo'],
    ['iDentalSoft', '#f97316', 'Perfil listo'], ['Open Dental', '#16a34a', 'Perfil listo'],
    ['Dentrix', '#2563eb', 'Perfil listo'], ['Eaglesoft', '#7c3aed', 'Perfil listo'],
    ['Gesden', '#dc2626', 'Perfil listo'], ['Dentidesk', '#0891b2', 'Perfil listo'],
    ['DentalCore', '#db2777', 'Perfil listo'], ['Mi Excel', '#15803d', 'Mapeo manual', 'XLS'],
    ['Otro', '#6b7280', 'Mapeo manual', '?']
  ];

  // ---------- COMPONENTES ----------
  var C = {};

  C.stepbar = function (cur) {
    var steps = ['Origen', 'Exportar', 'Qué importar', 'Subir', 'Mapear', 'Revisar'];
    var h = '<nav class="stepbar">';
    steps.forEach(function (l, i) {
      var n = i + 1, cls = 'step';
      if (n < cur) cls += ' is-done'; else if (n === cur) cls += ' is-current';
      h += '<div class="' + cls + '"><div class="num">' + (n < cur ? svg('i-check') : n) + '</div><div class="lbl">' + l + '</div></div>';
      if (i < 5) h += '<div class="step-line"></div>';
    });
    return h + '</nav>';
  };

  C.empty = function () {
    return '<div class="empty"><div class="glyph">' + svg('i-users') + '</div>' +
      '<h2>Trae los datos de tu sistema actual</h2>' +
      '<p>Si ya usas Dentalink, Open Dental, otro sistema o tu propio Excel, el asistente te guía paso a paso.</p>' +
      '<div class="empty-cta"><button class="btn btn--brand btn--lg">' + svg('i-import') + ' Importar mi clínica</button>' +
      '<button class="btn btn--lg">Migración asistida</button></div></div>';
  };

  C.step1 = function (selIdx) {
    var grid = '<div class="src-grid">' + SOURCES.map(function (s, i) {
      var on = i === selIdx;
      return '<button class="src-card" aria-pressed="' + on + '">' +
        '<div class="check">' + svg('i-check') + '</div>' + logo(s[1], s[3] || s[0].charAt(0)) +
        '<div><div class="nm">' + s[0] + '</div></div><div class="meta">' + s[2] + '</div></button>';
    }).join('') + '</div>';
    return '<h2 class="wz-title">¿De dónde vienen tus datos?</h2>' +
      '<p class="wz-sub">Elige tu sistema actual. Adaptaremos las instrucciones y el mapeo a tu elección.</p>' + grid +
      '<div class="callout"><div class="ic-wrap">' + svg('i-spark') + '</div>' +
      '<div class="txt"><b>¿Prefieres que lo hagamos por ti?</b><p>Migración asistida gratis: súbenos tu respaldo y lo dejamos listo.</p></div>' +
      '<button class="btn btn--soft">Migración asistida</button></div>';
  };

  C.step2Dentalink = function () {
    var steps = [
      ['Entra a Dentalink', 'Inicia sesión y abre <code>Configuración</code> en la esquina superior derecha.'],
      ['Ve a Exportar datos', 'En <code>Datos &amp; Respaldos</code> elige <code>Exportar pacientes</code>.'],
      ['Selecciona el rango', 'Marca «Todos los pacientes» y el formato <code>Excel (.xlsx)</code>.'],
      ['Descarga el archivo', 'Pulsa <code>Generar</code> y guarda el archivo. Lo subirás en el siguiente paso.']
    ];
    return '<h2 class="wz-title">Exporta tus datos</h2><p class="wz-sub">Sigue estos pasos para obtener el archivo desde Dentalink.</p>' +
      '<div class="src-pill">' + logo('#0ea5e9', 'D', 26) + '<span class="nm">Dentalink</span></div>' +
      '<div class="steps-list">' + steps.map(function (s, i) {
        return '<div class="step-row"><div class="idx">' + (i + 1) + '</div><div class="body"><h4>' + s[0] + '</h4><p>' + s[1] + '</p></div></div>';
      }).join('') + '</div>';
  };

  C.step2Excel = function () {
    return '<h2 class="wz-title">Exporta tus datos</h2><p class="wz-sub">Usa nuestra plantilla para acomodar tus datos.</p>' +
      '<div class="src-pill">' + logo('#15803d', 'XLS', 26) + '<span class="nm">Mi Excel</span></div>' +
      '<div class="dl-card"><div class="ic-wrap">' + svg('i-download') + '</div>' +
      '<div class="body"><b>Plantilla de DaleControl (.xlsx)</b><p>Tres pestañas: Pacientes, Saldos y Citas.</p></div>' +
      '<button class="btn btn--brand">' + svg('i-download') + ' Descargar plantilla</button></div>' +
      '<div class="note" style="margin-top:16px">' + svg('i-file') + '<p>¿Ya tienes tu propio archivo? También funciona. Solo asegúrate de que la primera fila tenga los nombres de las columnas.</p></div>';
  };

  C.step3 = function () {
    var rows = [
      ['Pacientes', 'i-users', 'Nombre, contacto, fecha de nacimiento', '<span class="badge badge--brand">Recomendado</span>', 1],
      ['Saldos', 'i-money', 'Adeudos y pagos a favor por paciente', '<span class="badge badge--ok"><span class="dot"></span>Fácil</span>', 1],
      ['Citas próximas', 'i-calendar', 'Agenda futura para no perder ninguna', '<span class="badge badge--ok"><span class="dot"></span>Fácil</span>', 1],
      ['Tratamientos', 'i-stack', 'Planes y procedimientos por paciente', '<span class="badge badge--warn">Avanzado</span>', 0],
      ['Historial clínico', 'i-file', 'Notas y evolución (requiere más mapeo)', '<span class="badge badge--warn">Avanzado</span>', 0]
    ];
    return '<h2 class="wz-title">¿Qué quieres traer?</h2><p class="wz-sub">Te recomendamos empezar por lo esencial.</p>' +
      '<div class="opt-list">' + rows.map(function (r) {
        return '<label class="opt' + (r[4] ? ' is-on' : '') + '"><span class="box">' + svg('i-check') + '</span>' +
          '<span class="opt-ic">' + svg(r[1]) + '</span><span class="info"><span class="nm">' + r[0] + ' ' + r[3] + '</span>' +
          '<span class="meta">' + r[2] + '</span></span></label>';
      }).join('') + '</div>';
  };

  C.dropzone = function (st) {
    if (st === 'loaded') {
      return '<div class="file-row"><div class="f-ic">' + svg('i-file') + '</div>' +
        '<div class="f-body"><div class="nm">pacientes_dentalink.xlsx</div><div class="meta">2.4 MB · 1,265 filas detectadas</div>' +
        '<div class="bar"><i style="width:100%"></i></div></div><button class="btn btn--sm">Quitar</button></div>' +
        '<div class="inline-error" style="color:var(--ok)">' + svg('i-check') + ' Archivo válido. Continúa al mapeo.</div>';
    }
    if (st === 'error') {
      return '<div class="dropzone is-error"><div class="dz-ic">' + svg('i-alert') + '</div>' +
        '<h4>No pudimos usar ese archivo</h4><p>Debe ser .xlsx o .csv y pesar menos de 5&nbsp;MB.</p>' +
        '<p class="formats">Vuelve a intentarlo con el archivo correcto.</p></div>' +
        '<div class="inline-error">' + svg('i-alert') + ' El archivo «historial.pdf» (8.2 MB) no es compatible.</div>';
    }
    var drag = st === 'drag';
    return '<div class="dropzone' + (drag ? ' is-drag' : '') + '"><div class="dz-ic">' + svg('i-cloud') + '</div>' +
      '<h4>' + (drag ? 'Suelta para subir' : 'Arrastra tu archivo aquí') + '</h4>' +
      '<p>' + (drag ? 'Detectamos un archivo' : 'o haz clic para buscarlo en tu equipo') + '</p>' +
      '<p class="formats">Formatos: .xlsx o .csv · máx. 5&nbsp;MB</p></div>';
  };

  C.step5 = function (mode) {
    var auto = mode === 'auto';
    var FIELDS = [['', '— Sin importar —'], ['nombre', 'Nombre completo'], ['telefono', 'Teléfono'], ['email', 'Correo electrónico'], ['nacimiento', 'Fecha de nacimiento'], ['saldo', 'Saldo']];
    var rows = [
      ['Nombre del paciente', 'María González R.', 'nombre'],
      ['Celular', '55 1234 5678', 'telefono'],
      ['Correo', 'maria@correo.com', 'email'],
      ['F. Nacimiento', '14/03/1988', 'nacimiento'],
      ['Saldo $', '1,250.00', 'saldo'],
      ['Notas internas', 'Alérgica a penicilina', '']
    ];
    var banner = auto
      ? '<div class="callout" style="margin-top:0"><div class="ic-wrap" style="background:var(--ok-soft);color:var(--ok)">' + svg('i-spark') + '</div><div class="txt"><b>Mapeo automático aplicado</b><p>5 de 6 columnas se emparejaron solas gracias al perfil de Dentalink.</p></div></div>'
      : '<div class="callout" style="margin-top:0;border-color:var(--warn-border);background:var(--warn-soft)"><div class="ic-wrap" style="background:var(--warn-soft);color:var(--warn)">' + svg('i-alert') + '</div><div class="txt"><b>Mapeo manual</b><p>Como tu origen es «Otro», elige a mano el campo de cada columna.</p></div></div>';
    var body = rows.map(function (r) {
      var sel = auto ? r[2] : '';
      var unmapped = !sel;
      var opts = FIELDS.map(function (f) { return '<option' + (f[0] === sel ? ' selected' : '') + '>' + f[1] + '</option>'; }).join('');
      var stat = (auto && sel) ? '<span class="map-status auto">' + svg('i-spark') + 'Automático</span>'
        : (unmapped ? '<span class="map-status skip">' + svg('i-x') + 'Sin mapear</span>' : '<span class="map-status manual">' + svg('i-check') + 'Manual</span>');
      return '<tr><td><div style="font-weight:500">' + r[0] + '</div><div class="sample">Ej. ' + r[1] + '</div></td>' +
        '<td class="col-arrow">' + svg('i-arrow-r') + '</td>' +
        '<td><div class="select' + (unmapped ? ' is-unmapped' : '') + '"><select aria-label="Campo para ' + r[0] + '">' + opts + '</select></div></td>' +
        '<td>' + stat + '</td></tr>';
    }).join('');
    return '<h2 class="wz-title">Empareja las columnas</h2><p class="wz-sub">' +
      (auto ? 'Reconocimos el formato de Dentalink y emparejamos las columnas automáticamente.' : 'Empareja manualmente cada columna con un campo de DaleControl.') + '</p>' +
      banner + '<div class="table-wrap" style="margin-top:14px"><div class="table-scroll"><table class="table">' +
      '<thead><tr><th>Tu columna</th><th class="col-arrow"></th><th>Campo de DaleControl</th><th>Estado</th></tr></thead><tbody>' + body + '</tbody></table></div></div>';
  };

  C.step6 = function () {
    var rows = [
      [1, 'María González Ramírez', '55 1234 5678', '$1,250', 'ok'],
      [3, 'Ana Patricia Ruiz', '—', '$3,400', 'err', 'Teléfono vacío'],
      [5, 'María González Ramírez', '55 1234 5678', '$1,250', 'dup', 'Ya existe (fila 1)'],
      [6, 'Carlos S.', 'abc-123', '$0', 'err', 'Teléfono inválido'],
      [7, 'Diana Flores', '55 9090 8080', '$2,100', 'ok']
    ];
    function badge(st) {
      if (st === 'ok') return '<span class="badge badge--ok"><span class="dot"></span>OK</span>';
      if (st === 'err') return '<span class="badge badge--err">Error</span>';
      return '<span class="badge badge--warn">Duplicado</span>';
    }
    var body = rows.map(function (r) {
      var cls = r[4] === 'err' ? 'row-err' : (r[4] === 'dup' ? 'row-dup' : '');
      var b = r[5] ? '<span class="tip" tabindex="0">' + badge(r[4]) + '<span class="tip-bubble">' + r[5] + '</span></span>' : badge(r[4]);
      return '<tr class="' + cls + '"><td class="tnum">' + r[0] + '</td><td>' + r[1] + '</td><td class="tnum">' + r[2] + '</td><td class="tnum">' + r[3] + '</td><td>' + b + '</td></tr>';
    }).join('');
    return '<h2 class="wz-title">Revisa antes de importar</h2><p class="wz-sub">Validamos cada fila. Corrige los errores ahora o impórtalos y arréglalos después.</p>' +
      '<div class="stat-grid">' +
      '<div class="stat-card ok"><div class="top"><div class="s-ic">' + svg('i-check') + '</div><span class="s-lbl">Válidos</span></div><div class="s-val tnum">1,240</div></div>' +
      '<div class="stat-card err"><div class="top"><div class="s-ic">' + svg('i-alert') + '</div><span class="s-lbl">Con errores</span></div><div class="s-val tnum">18</div></div>' +
      '<div class="stat-card warn"><div class="top"><div class="s-ic">' + svg('i-copy') + '</div><span class="s-lbl">Duplicados</span></div><div class="s-val tnum">7</div></div></div>' +
      '<div class="toolbar"><label class="switch is-on"><span class="track"></span><span>Omitir duplicados</span></label><div class="spacer"></div><span class="muted-3" style="font-size:13px">Pasa el cursor sobre un error para ver el motivo</span></div>' +
      '<div class="table-wrap"><div class="table-scroll"><table class="table"><thead><tr><th>Fila</th><th>Nombre</th><th>Teléfono</th><th>Saldo</th><th>Estado</th></tr></thead><tbody>' + body + '</tbody></table></div></div>';
  };

  C.importing = function () {
    return '<div class="importing"><div class="spin"></div><h3>Importando tus datos…</h3>' +
      '<p>No cierres esta ventana. Tardará menos de un minuto.</p>' +
      '<div class="progress"><i style="width:62%"></i></div>' +
      '<div class="progress-meta"><span>Importando saldos…</span><span class="tnum">62%</span></div></div>';
  };

  C.result = function () {
    return '<div class="result"><div class="seal">' + svg('i-check') + '</div>' +
      '<h2>¡Listo! Tu clínica está en DaleControl</h2>' +
      '<p class="lead">Importamos tus datos correctamente. Los 18 registros con error no se importaron; puedes corregirlos y volver a subirlos.</p>' +
      '<div class="summary-row"><div class="summary-pill"><span class="v tnum">1,240</span><span class="k">pacientes</span></div>' +
      '<div class="summary-pill"><span class="v tnum">$340,000</span><span class="k">en saldos</span></div>' +
      '<div class="summary-pill"><span class="v tnum">85</span><span class="k">citas próximas</span></div></div>' +
      '<div class="report-line">' + svg('i-alert') + '<span>18 filas con error no se importaron.</span><div class="spacer"></div>' +
      '<a class="btn-link" href="#">' + svg('i-download') + ' Descargar reporte</a></div>' +
      '<div class="ctas"><button class="btn btn--brand">' + svg('i-users') + ' Ver pacientes</button>' +
      '<button class="btn">' + svg('i-import') + ' Importar otra cosa</button></div></div>';
  };

  C.assistedForm = function () {
    return '<h2 class="wz-title">Migración asistida · gratis</h2>' +
      '<p class="wz-sub">Súbenos un respaldo o exportación de tu sistema y nuestro equipo deja todo listo por ti.</p>' +
      '<div class="dropzone"><div class="dz-ic">' + svg('i-cloud') + '</div><h4>Arrastra tu respaldo o exportación</h4>' +
      '<p>Aceptamos cualquier formato: Excel, CSV, .zip de respaldo, etc.</p><p class="formats">Hasta 50 MB</p></div>' +
      '<div class="field" style="margin-top:18px"><label>¿Algo que debamos saber? (opcional)</label>' +
      '<textarea class="text-input" placeholder="Ej. uso Dentalink desde 2019, tengo 2 sucursales…"></textarea></div>' +
      '<div class="note">' + svg('i-shield') + '<p>Tus datos se transmiten cifrados y solo el equipo de migración los consulta. Los eliminamos al terminar. Cumplimos con la LFPDPPP.</p></div>';
  };

  C.assistedSent = function () {
    return '<div class="result"><div class="seal" style="background:var(--brand-soft);color:var(--brand)">' + svg('i-clock') + '</div>' +
      '<h2>Recibimos tu archivo</h2><p class="lead">Tu migración está en revisión por el equipo. Te avisaremos por correo y dentro del panel cuando esté lista.</p>' +
      '<div class="review-strip"><div class="ic-wrap">' + svg('i-clock') + '</div><div><b>En revisión por el equipo</b>' +
      '<p>Tiempo estimado: 48 horas hábiles. No necesitas hacer nada más.</p></div></div></div>';
  };

  // ---------- LAYOUT HELPERS ----------
  // marco con cromo de modal (encabezado + opcional stepbar)
  function modalChrome(sub, inner, stepN) {
    return '<div class="modal-head"><div class="ttl">Importar mi clínica<small>' + sub + '</small></div>' +
      '<div class="spacer"></div><button class="icon-btn">' + svg('i-x') + '</button></div>' +
      (stepN ? C.stepbar(stepN) : '') +
      '<div class="modal-body" style="max-height:none">' + inner + '</div>';
  }

  function pair(title, tag, lightHTML, darkHTML, opts) {
    opts = opts || {};
    var pad = opts.pad !== false;
    return '<div class="sect-title"><h2>' + title + '</h2>' + (tag ? '<span class="tag">' + tag + '</span>' : '') + '</div>' +
      '<div class="pair">' +
        frame('Light', '#F8F7FC', 'light', lightHTML, pad) +
        frame('Dark', '#0B0815', 'dark', darkHTML, pad) +
      '</div>';
  }
  function frame(cap, sw, theme, html, pad) {
    var inner = pad ? html : html;
    return '<div class="frame"><div class="cap"><span class="swatch" style="background:' + sw + '"></span>' + cap + '</div>' +
      '<div class="stage ' + theme + '" style="' + (pad ? '' : 'padding:0') + '">' + html + '</div></div>';
  }

  // wrapper "modal" para encajar componentes con cromo
  function modalCard(theme, html) {
    return '<div class="' + (theme === 'dark' ? 'dark ' : '') + '" style="border-radius:14px;overflow:hidden;border:1px solid var(--border-soft);background:var(--bg-elev)">' + html + '</div>';
  }

  // ---------- ENSAMBLADO ----------
  function build() {
    var out = [];

    // A. Lanzador
    var launcher = function () {
      return '<div style="background:var(--bg);padding:22px;border-radius:14px;border:1px solid var(--border-soft)">' +
        '<div class="page-head"><div class="titles"><h1 style="font-size:21px">Pacientes</h1><p class="sub">Aún no tienes pacientes registrados.</p></div>' +
        '<div class="actions"><button class="btn btn--brand">' + svg('i-import') + ' Importar mi clínica</button></div></div>' + C.empty() + '</div>';
    };
    out.push('<div class="sect-title"><h2>A · Lanzador y estado vacío</h2><span class="tag">Pantalla A</span></div>' +
      '<div class="pair">' +
      '<div class="frame"><div class="cap"><span class="swatch" style="background:#F8F7FC"></span>Light</div><div class="stage light">' + launcher() + '</div></div>' +
      '<div class="frame"><div class="cap"><span class="swatch" style="background:#0B0815"></span>Dark</div><div class="stage dark"><div class="dark">' + launcher() + '</div></div></div>' +
      '</div>');

    // B. Paso 1
    out.push(pairModal('B · Paso 1 · Origen', 'Pantalla B', null, 1, function () { return C.step1(0); }));

    // C. Paso 2 variantes (no es pair light/dark, son 2 variantes; mostramos cada una en light+dark)
    out.push(pairModal('C · Paso 2 · Cómo exportar — Dentalink', 'Pantalla C.1', null, 2, function () { return C.step2Dentalink(); }));
    out.push(pairModal('C · Paso 2 · Cómo exportar — Mi Excel', 'Pantalla C.2', null, 2, function () { return C.step2Excel(); }));

    // D. Paso 3
    out.push(pairModal('D · Paso 3 · Qué importar', 'Pantalla D', null, 3, function () { return C.step3(); }));

    // E. Paso 4 dropzone — 4 estados, en grid propio (cada estado light+dark)
    out.push('<div class="sect-title"><h2>E · Paso 4 · Subir — 4 estados</h2><span class="tag">Pantalla E</span></div>');
    ['empty', 'drag', 'loaded', 'error'].forEach(function (st) {
      var nm = { empty: 'Vacío', drag: 'Arrastrando', loaded: 'Archivo cargado', error: 'Error' }[st];
      out.push('<div style="margin:6px 0 18px"><div class="cap" style="margin-bottom:8px;color:var(--text-3);font-size:12.5px">' + nm + '</div><div class="pair">' +
        frame('Light', '#F8F7FC', 'light', C.dropzone(st), true) +
        frame('Dark', '#0B0815', 'dark', C.dropzone(st), true) + '</div></div>');
    });

    // F. Paso 5 — auto + manual
    out.push(pairModal('F · Paso 5 · Mapear (automático, perfil Dentalink)', 'Pantalla F.1', null, 5, function () { return C.step5('auto'); }));
    out.push(pairModal('F · Paso 5 · Mapear (manual, origen «Otro»)', 'Pantalla F.2', null, 5, function () { return C.step5('manual'); }));

    // G. Paso 6
    out.push(pairModal('G · Paso 6 · Revisar', 'Pantalla G', null, 6, function () { return C.step6(); }));

    // H. Importando
    out.push(pairModal('H · Importando', 'Pantalla H', null, null, function () { return C.importing(); }));

    // I. Resultado
    out.push(pairModal('I · Resultado', 'Pantalla I', null, null, function () { return C.result(); }));

    // J. Migración asistida
    out.push(pairModal('J · Migración asistida (formulario)', 'Pantalla J.1', null, null, function () { return C.assistedForm(); }));
    out.push(pairModal('J · Migración asistida (en revisión, 48 h)', 'Pantalla J.2', null, null, function () { return C.assistedSent(); }));

    // K. Responsive móvil
    out.push('<div class="sect-title"><h2>K · Responsive móvil</h2><span class="tag">Pantalla K · pasos 1, 5 y 6</span></div>');
    out.push('<div class="phones">' +
      phone('Paso 1 · Origen (light)', 'light', modalChrome('Paso 1 de 6', C.step1(0), 1)) +
      phone('Paso 5 · Mapear (dark)', 'dark', modalChrome('Paso 5 de 6', C.step5('auto'), 5)) +
      phone('Paso 6 · Revisar (light)', 'light', modalChrome('Paso 6 de 6', C.step6(), 6)) +
      '</div>');

    document.getElementById('gallery-body').innerHTML = out.join('');
  }

  // pareja light/dark con cromo de modal
  function pairModal(title, tag, _x, stepN, contentFn) {
    var sub = stepN ? ('Paso ' + stepN + ' de 6') : 'Asistente de migración';
    var light = '<div style="border-radius:14px;overflow:hidden;border:1px solid var(--border-soft)">' + modalChrome(sub, contentFn('light'), stepN) + '</div>';
    var dark = '<div class="dark" style="border-radius:14px;overflow:hidden;border:1px solid var(--border-soft);background:var(--bg-elev)">' + modalChrome(sub, contentFn('dark'), stepN) + '</div>';
    return '<div class="sect-title"><h2>' + title + '</h2><span class="tag">' + tag + '</span></div>' +
      '<div class="pair">' +
      '<div class="frame"><div class="cap"><span class="swatch" style="background:#F8F7FC"></span>Light</div><div class="stage light" style="padding:14px">' + light + '</div></div>' +
      '<div class="frame"><div class="cap"><span class="swatch" style="background:#0B0815"></span>Dark</div><div class="stage dark" style="padding:14px">' + dark + '</div></div>' +
      '</div>';
  }

  function phone(cap, theme, inner) {
    return '<div class="phone"><div class="cap"><span class="swatch" style="background:' + (theme === 'dark' ? '#0B0815' : '#F8F7FC') + '"></span>' + cap + '</div>' +
      '<div class="device"><div class="screen-scroll ' + (theme === 'dark' ? 'dark' : '') + '" style="background:var(--bg-elev)">' + inner + '</div></div></div>';
  }

  build();
})();
