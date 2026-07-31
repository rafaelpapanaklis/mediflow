// Mockups de /reportes-clinica-dental — réplica de 7-Reportes-indicadores.dc.html.
// Las cifras ($42,300 · $68,900 · 78%) son datos de ejemplo de la interfaz.

const BARS = [
  { h: 42, c: "#fde68a" },
  { h: 56, c: "#fcd34d" },
  { h: 50, c: "#fcd34d" },
  { h: 70, c: "#f59e0b" },
  { h: 64, c: "#f59e0b" },
  { h: 86, c: "#d97706" },
];

export function ReportesHero() {
  return (
    <div className="pm-scene pm-t-amber">
      <div className="pm-scene__glow" aria-hidden="true" />

      <div className="pm-scene__side" aria-hidden="true">
        <div className="pm-mh">
          <b>Ocupación de agenda</b>
          <span className="pm-tag pm-pill--amber">Semana</span>
        </div>
        <div style={{ padding: "10px 11px", display: "flex", alignItems: "center", gap: 11 }}>
          <span className="pm-donut" style={{ width: 62, height: 62, ["--pct" as string]: "78%", ["--tone-ac" as string]: "#d97706", background: "conic-gradient(#d97706 0 78%,#f1f5f9 78% 100%)" }}>
            <span style={{ width: 44, height: 44, fontSize: 12 }}>78%</span>
          </span>
          <span style={{ minWidth: 0 }}>
            <span style={{ display: "block", fontSize: 9.5, color: "#475569", lineHeight: 1.4 }}>Sillones ocupados sobre las horas disponibles</span>
            <span style={{ display: "block", marginTop: 5, fontSize: 9, fontWeight: 700, color: "#b45309" }}>Lun a vie · 2 doctores</span>
          </span>
        </div>
      </div>

      <figure className="pm-scene__main">
        <div className="pm-mh" style={{ background: "linear-gradient(90deg,#fffbeb,#ffffff)", padding: "10px 12px" }}>
          <b style={{ fontSize: 11 }}>Ingresos del mes</b>
          <span className="pm-tag pm-pill--amber">Julio</span>
        </div>
        <div style={{ padding: 12 }}>
          <div className="pm-graph" style={{ gridTemplateColumns: "repeat(6,1fr)", height: 92, gap: 6 }}>
            {BARS.map((b, i) => (
              <i key={i} style={{ height: `${b.h + 2}%`, background: b.c, borderRadius: "5px 5px 0 0" }} aria-hidden="true" />
            ))}
          </div>
          <div className="pm-graph__x" style={{ marginTop: 6, gridTemplateColumns: "repeat(6,1fr)", gap: 6, fontSize: 7.5 }}>
            <span>feb</span><span>mar</span><span>abr</span><span>may</span><span>jun</span><span>jul</span>
          </div>
          <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 6 }}>
            <span style={{ border: "1px solid #e8edf4", borderRadius: 8, padding: "7px 8px" }}>
              <span className="pm-kicker" style={{ fontSize: 7.5, letterSpacing: ".08em" }}>Citas</span>
              <span style={{ display: "block", fontSize: 12, fontWeight: 800, color: "#0f172a" }}>212</span>
            </span>
            <span style={{ border: "1px solid #e8edf4", borderRadius: 8, padding: "7px 8px" }}>
              <span className="pm-kicker" style={{ fontSize: 7.5, letterSpacing: ".08em" }}>Ausencias</span>
              <span style={{ display: "block", fontSize: 12, fontWeight: 800, color: "#0f172a" }}>6</span>
            </span>
          </div>
        </div>
      </figure>

      <div className="pm-scene__chip" aria-hidden="true">
        <i>▲</i>
        <span>
          <b>Reporte listo</b>
          <span>Con los datos de tu caja</span>
        </span>
      </div>
    </div>
  );
}

export function Reportes1() {
  return (
    <figure className="pm-win">
      <div className="pm-win__bar">
        <span className="pm-win__lights" aria-hidden="true"><i /><i /><i /></span>
        <span className="pm-win__url">app.dalecontrol.com/reportes</span>
      </div>
      <div className="pm-win__body">
        <div className="pm-chips pm-chips--round">
          <span className="is-on">Mes</span>
          <span>Día</span>
          <span>Trimestre</span>
          <span>Año</span>
        </div>
        <div className="pm-graph" style={{ marginTop: 14, gridTemplateColumns: "repeat(6,1fr)", height: "clamp(110px,15vw,150px)" }}>
          {BARS.map((b, i) => (
            <i key={i} style={{ height: `${b.h}%`, background: b.c }} aria-hidden="true" />
          ))}
        </div>
        <div className="pm-graph__x" style={{ marginTop: 7, gridTemplateColumns: "repeat(6,1fr)" }}>
          <span>feb</span><span>mar</span><span>abr</span><span>may</span><span>jun</span><b>jul</b>
        </div>
        <div className="pm-stats" style={{ marginTop: 14 }}>
          <span>
            <span className="pm-kicker" style={{ fontSize: 10, letterSpacing: ".08em" }}>Efectivo</span>
            <b>$42,300</b>
          </span>
          <span>
            <span className="pm-kicker" style={{ fontSize: 10, letterSpacing: ".08em" }}>Tarjeta</span>
            <b>$68,900</b>
          </span>
          <span>
            <span className="pm-kicker" style={{ fontSize: 10, letterSpacing: ".08em" }}>Pendiente</span>
            <b style={{ color: "#b45309" }}>$7,150</b>
          </span>
        </div>
      </div>
    </figure>
  );
}

export function Reportes2() {
  const days: Array<[string, number, string]> = [
    ["Lunes", 86, "#2563eb"],
    ["Martes", 74, "#2563eb"],
    ["Miércoles", 62, "#60a5fa"],
    ["Jueves", 88, "#2563eb"],
    ["Viernes", 58, "#60a5fa"],
  ];
  return (
    <figure className="pm-win">
      <div className="pm-win__head">
        <b>Ocupación de agenda</b>
        <span className="pm-pill pm-pill--blue">Esta semana</span>
      </div>
      <div className="pm-win__body" style={{ display: "flex", flexWrap: "wrap", gap: 18, alignItems: "center" }}>
        <span className="pm-donut" style={{ width: 112, height: 112, ["--pct" as string]: "78%" }} aria-hidden="true">
          <span style={{ width: 80, height: 80, fontSize: 22 }}>78%</span>
        </span>
        <div style={{ flex: "1 1 170px", minWidth: 0 }}>
          <ul style={{ display: "flex", flexDirection: "column", gap: 9 }}>
            {days.map(([d, pct, c]) => (
              <li key={d}>
                <span style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 11.5, color: "#475569" }}>
                  <span>{d}</span>
                  <span style={{ fontWeight: 700, color: "#0f172a" }}>{pct}%</span>
                </span>
                <span className="pm-bar" style={{ marginTop: 4, height: 7 }} aria-hidden="true">
                  <i style={{ width: `${pct}%`, background: c }} />
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <div style={{ padding: "12px 16px", background: "#f8fafc", borderTop: "1px solid #eef2f7", display: "flex", alignItems: "center", gap: 9 }}>
        <span className="pm-note__i" style={{ background: "#dbeafe", color: "#1d4ed8" }} aria-hidden="true">i</span>
        <span style={{ fontSize: 11.5, color: "#475569" }}>Viernes es tu día con más espacios libres</span>
      </div>
    </figure>
  );
}

export function Reportes3() {
  const docs: Array<[string, string, string, number, string]> = [
    ["DR", "Dra. Ríos", "96 citas", 82, "#7c3aed"],
    ["DS", "Dr. Salas", "78 citas", 66, "#a78bfa"],
    ["DM", "Dra. Mena · higiene", "38 citas", 34, "#c4b5fd"],
  ];
  return (
    <figure className="pm-win">
      <div className="pm-win__head">
        <b>Productividad · julio</b>
        <span className="pm-pill pm-pill--violet">Por doctor</span>
      </div>
      <div className="pm-win__body">
        <ul style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {docs.map(([ini, name, n, pct, c], i) => (
            <li key={name}>
              <span className="pm-barhead">
                <span className={`pm-mini pm-mini--round${i === 2 ? " pm-mini--gray" : ""}`} style={{ width: 26, height: 26, fontSize: 10, ...(i === 2 ? {} : { background: "#ede9fe", color: "#6d28d9" }) }} aria-hidden="true">{ini}</span>
                <b>{name}</b>
                <span style={{ fontWeight: 700 }}>{n}</span>
              </span>
              <span className="pm-bar" style={{ marginTop: 6 }} aria-hidden="true">
                <i style={{ width: `${pct}%`, background: c }} />
              </span>
            </li>
          ))}
        </ul>
        <span className="pm-kicker" style={{ marginTop: 16 }}>Tratamientos del mes</span>
        <div className="pm-chips pm-chips--round" style={{ marginTop: 9 }}>
          <span style={{ color: "#6d28d9", background: "#ede9fe", border: "1px solid #ede9fe", fontWeight: 700 }}>Limpieza · 64</span>
          <span style={{ color: "#1d4ed8", background: "#dbeafe", border: "1px solid #dbeafe", fontWeight: 700 }}>Resina · 41</span>
          <span style={{ color: "#b45309", background: "#fef3c7", border: "1px solid #fef3c7", fontWeight: 700 }}>Ortodoncia · 33</span>
          <span style={{ color: "#047857", background: "#d1fae5", border: "1px solid #d1fae5", fontWeight: 700 }}>Endodoncia · 18</span>
        </div>
      </div>
    </figure>
  );
}

export function Reportes4() {
  const sedes: Array<[string, string, number, string, string]> = [
    ["Sede Centro", "212 citas", 88, "#15803d", "Ocupación 82% · 2 doctores"],
    ["Sede Norte", "146 citas", 61, "#22c55e", "Ocupación 64% · 1 doctor"],
    ["Sede Sur", "98 citas", 41, "#86efac", "Ocupación 52% · 1 doctor"],
  ];
  return (
    <figure className="pm-win">
      <div className="pm-win__head">
        <b>Comparativo de sedes</b>
        <span className="pm-pill pm-pill--green">Julio</span>
      </div>
      <div className="pm-win__body">
        <ul style={{ display: "flex", flexDirection: "column", gap: 13 }}>
          {sedes.map(([name, n, pct, c, sub]) => (
            <li key={name}>
              <span style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12.5, color: "#0f172a", fontWeight: 600 }}>
                <span>{name}</span>
                <span>{n}</span>
              </span>
              <span className="pm-bar" style={{ marginTop: 5, height: 9 }} aria-hidden="true">
                <i style={{ width: `${pct}%`, background: c }} />
              </span>
              <span style={{ display: "block", marginTop: 4, fontSize: 11, color: "#475569" }}>{sub}</span>
            </li>
          ))}
        </ul>
        <div style={{ marginTop: 14, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, justifyContent: "space-between" }}>
          <span style={{ fontSize: 11.5, color: "#475569" }}>También puedes verlas consolidadas</span>
          <span className="pm-act" style={{ background: "#15803d" }}>Ver consolidado</span>
        </div>
      </div>
    </figure>
  );
}
