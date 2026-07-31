// Mockups de /expediente-clinico-dental — réplica de 2-Expediente-odontograma.dc.html.

const UPPER = ["18", "17", "16", "15", "14", "13", "12", "11", "21", "22", "23", "24", "25", "26", "27", "28"];
const LOWER = ["48", "47", "46", "45", "44", "43", "42", "41", "31", "32", "33", "34", "35", "36", "37", "38"];
/** Estado por diente en el ejemplo: t-tx tratado · t-pl en plan · t-ca caries · t-ok sano */
const STATE: Record<string, string> = {
  "16": "t-tx", "26": "t-tx", "14": "t-pl", "34": "t-pl", "23": "t-ca", "43": "t-ca", "47": "t-ok",
};

function Arch({ teeth }: { teeth: string[] }) {
  return (
    <div className="pm-teeth" style={{ gridTemplateColumns: "repeat(16,1fr)" }}>
      {teeth.map((t) => (
        <span key={t} className={STATE[t] ?? ""}>{t}</span>
      ))}
    </div>
  );
}

export function ExpedienteHero() {
  return (
    <div className="pm-scene pm-t-blue">
      <div className="pm-scene__glow" aria-hidden="true" />

      <div className="pm-scene__side" aria-hidden="true">
        <div className="pm-mh">
          <b>Notas de evolución</b>
          <span className="pm-tag pm-pill--blue">Dictado</span>
        </div>
        <div className="pm-mb">
          <div className="pm-mnote" style={{ borderColor: "#93c5fd" }}>
            <b>Hoy · resina OD 26</b>
            <span>Se retira caries, se coloca resina y se ajusta oclusión.</span>
          </div>
          <div className="pm-mnote">
            <b>12 jun · valoración</b>
            <span>Se solicita radiografía periapical.</span>
          </div>
          <div className="pm-mnote">
            <b>3 may · limpieza</b>
            <span>Control de placa, sin sangrado.</span>
          </div>
        </div>
      </div>

      <figure className="pm-scene__main">
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", background: "linear-gradient(90deg,#eff6ff,#ffffff)", borderBottom: "1px solid #eef2f7" }}>
          <span aria-hidden="true" style={{ width: 26, height: 26, borderRadius: "50%", background: "#dbeafe", color: "#1e40af", fontSize: 9.5, fontWeight: 800, display: "grid", placeItems: "center", flex: "0 0 auto" }}>AT</span>
          <span style={{ flex: "1 1 auto", minWidth: 0 }}>
            <span style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#0f172a" }}>Ana Torres · P0118</span>
            <span style={{ display: "block", fontSize: 9.5, color: "#475569" }}>Expediente clínico</span>
          </span>
        </div>
        <div style={{ padding: 12 }}>
          <span className="pm-kicker" style={{ fontSize: 9 }}>Odontograma · superior derecho</span>
          <div className="pm-teeth pm-teeth--mini" style={{ marginTop: 7, gridTemplateColumns: "repeat(8,1fr)" }}>
            <span>18</span><span>17</span><span className="t-tx">16</span><span>15</span>
            <span className="t-pl">14</span><span>13</span><span>12</span><span>11</span>
          </div>
          <span className="pm-kicker" style={{ marginTop: 10, fontSize: 9 }}>Inferior derecho</span>
          <div className="pm-teeth pm-teeth--mini" style={{ marginTop: 7, gridTemplateColumns: "repeat(8,1fr)" }}>
            <span>48</span><span className="t-ok">47</span><span>46</span><span>45</span>
            <span>44</span><span className="t-ca">43</span><span>42</span><span>41</span>
          </div>
          <div className="pm-legend" style={{ marginTop: 11, fontSize: 8, gap: "5px" }}>
            <span><i style={{ background: "#93c5fd" }} />Tratado</span>
            <span><i style={{ background: "#fcd34d" }} />En plan</span>
            <span><i style={{ background: "#fca5a5" }} />Caries</span>
            <span><i style={{ background: "#86efac" }} />Sano</span>
          </div>
        </div>
      </figure>

      <div className="pm-scene__chip" aria-hidden="true">
        <i>✓</i>
        <span>
          <b>Nota guardada</b>
          <span>Dictada por voz · 14 s</span>
        </span>
      </div>
    </div>
  );
}

export function Expediente1() {
  return (
    <figure className="pm-win">
      <div className="pm-win__bar">
        <span className="pm-win__lights" aria-hidden="true"><i /><i /><i /></span>
        <span className="pm-win__url">app.dalecontrol.com/pacientes/ana-torres</span>
      </div>
      <div className="pm-win__body">
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, justifyContent: "space-between" }}>
          <span style={{ fontSize: 13.5, fontWeight: 700, color: "#0f172a" }}>Odontograma · Ana Torres</span>
          <span className="pm-pill pm-pill--blue">Adulto</span>
        </div>
        <div className="pm-scroll" style={{ marginTop: 12 }}>
          <div style={{ minWidth: 390 }}>
            <Arch teeth={UPPER} />
            <div style={{ marginTop: 4 }}>
              <Arch teeth={LOWER} />
            </div>
          </div>
        </div>
        <div className="pm-legend" style={{ marginTop: 14 }}>
          <span><i style={{ background: "#93c5fd" }} />Tratado</span>
          <span><i style={{ background: "#fcd34d" }} />En plan de tratamiento</span>
          <span><i style={{ background: "#fca5a5" }} />Caries</span>
          <span><i style={{ background: "#86efac" }} />Sano</span>
        </div>
        <div style={{ marginTop: 14, borderTop: "1px solid #f1f5f9", paddingTop: 13, display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: 11.5, color: "#475569" }}>Diente 16 · resina oclusal · 12 jun</span>
          <span className="pm-act" style={{ background: "#2563eb" }}>Abrir periodontograma</span>
        </div>
      </div>
    </figure>
  );
}

export function Expediente2() {
  return (
    <figure className="pm-win">
      <div className="pm-win__head">
        <b>Nota de evolución · hoy</b>
        <span className="pm-pill pm-pill--violet pm-live"><i className="pm-live__dot" aria-hidden="true" />Dictando</span>
      </div>
      <div className="pm-win__body">
        <div style={{ border: "1px solid #e8edf4", borderRadius: 11, padding: 13, background: "#f8fafc" }}>
          <p style={{ fontSize: 13, lineHeight: 1.6, color: "#0f172a" }}>
            Paciente acude a control. Se retira caries en <strong>diente 16</strong>, se coloca resina oclusal y se ajusta oclusión.
            Sin dolor a la percusión. Se indica cita de revisión en tres semanas.
          </p>
          <div style={{ marginTop: 11, display: "flex", alignItems: "center", gap: 9 }}>
            <span className="pm-wave" aria-hidden="true">
              <i style={{ height: 7, background: "#c4b5fd" }} />
              <i style={{ height: 14, background: "#7c3aed" }} />
              <i style={{ height: 10, background: "#a78bfa" }} />
              <i style={{ height: 16, background: "#7c3aed" }} />
              <i style={{ height: 6, background: "#c4b5fd" }} />
              <i style={{ height: 12, background: "#a78bfa" }} />
            </span>
            <span style={{ fontSize: 11, color: "#475569" }}>Dictado 00:14 · revisa antes de guardar</span>
          </div>
        </div>
        <div className="pm-chips" style={{ marginTop: 13 }}>
          <span>+ Diagnóstico</span>
          <span>+ Receta</span>
          <span>+ Adjuntar estudio</span>
        </div>
        <div style={{ marginTop: 14, borderTop: "1px solid #f1f5f9", paddingTop: 13, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, justifyContent: "space-between" }}>
          <span style={{ fontSize: 11.5, color: "#475569" }}>Dra. Ríos · queda firmada con tu usuario</span>
          <span className="pm-act" style={{ background: "#7c3aed" }}>Guardar nota</span>
        </div>
      </div>
    </figure>
  );
}

export function Expediente3() {
  return (
    <figure className="pm-win">
      <div className="pm-win__head">
        <b>Archivos de Ana Torres</b>
        <span className="pm-pill pm-pill--cyan">Expediente</span>
      </div>
      <ul className="pm-list">
        <li>
          <span className="pm-mini pm-mini--sq" style={{ background: "#cffafe", color: "#0e7490", fontSize: 10 }} aria-hidden="true">RX</span>
          <span className="pm-list__main"><b>Periapical · diente 16</b><span>12 jun · subida por Dra. Ríos</span></span>
          <span className="pm-list__link">Abrir</span>
        </li>
        <li>
          <span className="pm-mini pm-mini--sq" style={{ background: "#ede9fe", color: "#6d28d9", fontSize: 10 }} aria-hidden="true">3D</span>
          <span className="pm-list__main"><b>Estudio CBCT · maxilar</b><span>2 jul · visor en el navegador</span></span>
          <span className="pm-list__link">Abrir</span>
        </li>
        <li>
          <span className="pm-mini pm-mini--sq" style={{ background: "#dbeafe", color: "#1e40af", fontSize: 10 }} aria-hidden="true">$</span>
          <span className="pm-list__main"><b>Presupuesto · plan de tratamiento</b><span>Aceptado por el paciente</span></span>
          <span className="pm-list__link">Abrir</span>
        </li>
        <li>
          <span className="pm-mini pm-mini--sq pm-mini--gray" style={{ fontSize: 10 }} aria-hidden="true">✎</span>
          <span className="pm-list__main"><b>Consentimiento informado</b><span>Firmado en el portal del paciente</span></span>
          <span className="pm-list__link">Abrir</span>
        </li>
      </ul>
    </figure>
  );
}

export function Expediente4() {
  return (
    <figure className="pm-win">
      <div className="pm-win__head">
        <b>Importar mi clínica</b>
        <span className="pm-pill pm-pill--green">pacientes.xlsx</span>
      </div>
      <div className="pm-win__body">
        <span className="pm-kicker">Relación de columnas</span>
        <ul className="pm-boxes" style={{ marginTop: 10 }}>
          <li><span className="pm-boxes__k" style={{ fontSize: 11.5 }}>Columna A · Nombre</span><span aria-hidden="true" style={{ color: "#15803d", fontWeight: 800 }}>→</span><span className="pm-boxes__v" style={{ fontSize: 11.5, flex: "1 1 auto" }}>Nombre del paciente</span></li>
          <li><span className="pm-boxes__k" style={{ fontSize: 11.5 }}>Columna B · Cel</span><span aria-hidden="true" style={{ color: "#15803d", fontWeight: 800 }}>→</span><span className="pm-boxes__v" style={{ fontSize: 11.5, flex: "1 1 auto" }}>Teléfono</span></li>
          <li><span className="pm-boxes__k" style={{ fontSize: 11.5 }}>Columna C · Notas</span><span aria-hidden="true" style={{ color: "#15803d", fontWeight: 800 }}>→</span><span className="pm-boxes__v" style={{ fontSize: 11.5, flex: "1 1 auto" }}>Antecedentes</span></li>
        </ul>
        <div className="pm-note" style={{ marginTop: 13, background: "#f6fefa", borderColor: "#dcfce7" }}>
          <i style={{ background: "#dcfce7", color: "#15803d" }}>✓</i>
          <span>Revisamos repetidos antes de crear las fichas</span>
        </div>
        <div style={{ marginTop: 14, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, justifyContent: "space-between" }}>
          <span style={{ fontSize: 11.5, color: "#475569" }}>Puedes importar por etapas</span>
          <span className="pm-act" style={{ background: "#15803d" }}>Importar pacientes</span>
        </div>
      </div>
    </figure>
  );
}
