// Mockups de /radiografias-3d-cbct-dental — réplica de 6-Radiografias-3D.dc.html.
// El "estudio" es una ILUSTRACIÓN de barras (nunca una radiografía real) y la
// leyenda "La IA asiste, el doctor decide" es obligatoria en este módulo.

const SLICES = [48, 62, 76, 88, 80, 84, 72, 64, 54, 46];

export function RadiografiasHero() {
  return (
    <div className="pm-scene pm-t-cyan">
      <div className="pm-scene__glow" aria-hidden="true" />

      <div className="pm-scene__side" aria-hidden="true">
        <div className="pm-mh">
          <b>Estudios del paciente</b>
          <span className="pm-tag pm-pill--cyan">3</span>
        </div>
        <div className="pm-mb">
          <div className="pm-mrow"><span aria-hidden="true" className="pm-mtag" style={{ background: "#cffafe", color: "#0e7490" }}>3D</span><span>CBCT maxilar · 2 jul</span></div>
          <div className="pm-mrow"><span aria-hidden="true" className="pm-mtag" style={{ background: "#e0e7ff", color: "#4338ca" }}>RX</span><span>Panorámica · 12 jun</span></div>
          <div className="pm-mrow"><span aria-hidden="true" className="pm-mtag" style={{ background: "#e0e7ff", color: "#4338ca" }}>RX</span><span>Periapical 16 · 12 jun</span></div>
        </div>
      </div>

      <figure className="pm-scene__main pm-scene__main--dark">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "9px 11px", background: "rgba(255,255,255,.06)", borderBottom: "1px solid rgba(255,255,255,.1)" }}>
          <span style={{ fontSize: 10.5, fontWeight: 700, color: "#fff" }}>Visor · CBCT maxilar</span>
          <span style={{ fontSize: 9, fontWeight: 700, color: "#67e8f9", background: "rgba(34,211,238,.16)", borderRadius: 999, padding: "3px 7px" }}>Corte axial</span>
        </div>
        <div className="pm-scan" style={{ padding: 12 }}>
          <div className="pm-scan__slices" style={{ gridTemplateColumns: "repeat(8,1fr)", height: 96, gap: 4 }}>
            {[54, 68, 82, 74, 78, 66, 58, 50].map((h, i) => (
              <i key={i} style={{ height: `${h}%`, background: "linear-gradient(180deg,#e2e8f0,#64748b)" }} aria-hidden="true" />
            ))}
          </div>
          <span className="pm-scan__mark" style={{ left: "34%", top: 26, width: 44, height: 40, borderWidth: 1.5 }} aria-hidden="true" />
          <span className="pm-scan__tag" style={{ left: "34%", top: 8, fontSize: 8, color: "#67e8f9", background: "rgba(8,145,178,.35)" }}>zona sugerida · 26</span>
          <span className="pm-mono" style={{ marginTop: 9, fontSize: 8 }}>vista del estudio · ejemplo</span>
        </div>
        <div style={{ padding: "9px 11px", background: "rgba(255,255,255,.04)", borderTop: "1px solid rgba(255,255,255,.08)", display: "flex", alignItems: "center", gap: 7 }}>
          <span aria-hidden="true" style={{ width: 18, height: 18, borderRadius: "50%", background: "rgba(34,211,238,.2)", color: "#67e8f9", fontSize: 9, fontWeight: 800, display: "grid", placeItems: "center", flex: "0 0 auto" }}>IA</span>
          <span style={{ fontSize: 8.5, color: "#cbd5e1", lineHeight: 1.35 }}>La IA asiste; la lectura la decide el doctor</span>
        </div>
      </figure>

      <div className="pm-scene__chip" aria-hidden="true">
        <i>✓</i>
        <span>
          <b>Estudio abierto</b>
          <span>Sin instalar nada</span>
        </span>
      </div>
    </div>
  );
}

export function Radiografias1() {
  return (
    <figure className="pm-win pm-win--dark" style={{ boxShadow: "0 24px 46px -28px rgba(8,145,178,.6)" }}>
      <div style={{ padding: "11px 14px", background: "rgba(255,255,255,.06)", borderBottom: "1px solid rgba(255,255,255,.1)", display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: "#fff" }}>CBCT maxilar · Ana Torres</span>
        <span style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: "#0b1220", background: "#67e8f9", borderRadius: 6, padding: "4px 9px" }}>Axial</span>
          <span style={{ fontSize: 10, fontWeight: 600, color: "#cbd5e1", border: "1px solid rgba(255,255,255,.2)", borderRadius: 6, padding: "4px 9px" }}>Coronal</span>
          <span style={{ fontSize: 10, fontWeight: 600, color: "#cbd5e1", border: "1px solid rgba(255,255,255,.2)", borderRadius: 6, padding: "4px 9px" }}>Sagital</span>
        </span>
      </div>
      <div className="pm-scan" style={{ padding: "clamp(14px,1.8vw,22px)" }}>
        <div className="pm-scan__slices" style={{ gridTemplateColumns: "repeat(10,1fr)", height: "clamp(120px,16vw,168px)" }}>
          {SLICES.map((h, i) => (
            <i key={i} style={{ height: `${h}%`, background: "linear-gradient(180deg,#f1f5f9,#64748b)" }} aria-hidden="true" />
          ))}
        </div>
        <span className="pm-scan__mark" style={{ left: "31%", top: "26%", width: "clamp(48px,11%,64px)", height: "clamp(48px,42%,72px)" }} aria-hidden="true" />
        <span className="pm-scan__tag" style={{ left: "31%", top: "calc(26% - 20px)" }}>Zona sugerida · 26</span>
        <span className="pm-mono" style={{ marginTop: 12 }}>vista del estudio · ilustración de ejemplo</span>
      </div>
      <div style={{ padding: "11px 14px", background: "rgba(255,255,255,.04)", borderTop: "1px solid rgba(255,255,255,.08)", display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
        <span style={{ fontSize: 10.5, color: "#cbd5e1" }}>Brillo</span>
        <span aria-hidden="true" style={{ flex: "1 1 90px", height: 4, borderRadius: 999, background: "linear-gradient(90deg,#67e8f9 60%,rgba(255,255,255,.18) 60%)", display: "block" }} />
        <span style={{ fontSize: 10.5, color: "#cbd5e1" }}>Zoom</span>
        <span aria-hidden="true" style={{ flex: "1 1 90px", height: 4, borderRadius: 999, background: "linear-gradient(90deg,#67e8f9 35%,rgba(255,255,255,.18) 35%)", display: "block" }} />
      </div>
    </figure>
  );
}

export function Radiografias2() {
  return (
    <figure className="pm-win">
      <div className="pm-win__head" style={{ background: "linear-gradient(90deg,#ecfeff,#ffffff)" }}>
        <b>Zonas sugeridas por la IA</b>
        <span className="pm-pill pm-pill--cyan">Apoyo</span>
      </div>
      <ul className="pm-list">
        <li>
          <span className="pm-mini pm-mini--sq" style={{ background: "#cffafe", color: "#0e7490" }} aria-hidden="true">26</span>
          <span className="pm-list__main"><b>Zona sugerida · diente 26</b><span>Revisar con corte coronal</span></span>
          <span className="pm-pill pm-pill--green">Confirmada</span>
        </li>
        <li>
          <span className="pm-mini pm-mini--sq" style={{ background: "#cffafe", color: "#0e7490" }} aria-hidden="true">36</span>
          <span className="pm-list__main"><b>Zona sugerida · diente 36</b><span>Comparar con estudio anterior</span></span>
          <span className="pm-pill pm-pill--gray">Por revisar</span>
        </li>
        <li>
          <span className="pm-mini pm-mini--sq pm-mini--gray" aria-hidden="true">17</span>
          <span className="pm-list__main"><b>Zona sugerida · diente 17</b><span>Descartada por el doctor</span></span>
          <span className="pm-pill pm-pill--red">Descartada</span>
        </li>
      </ul>
      <div style={{ padding: "13px 16px", background: "#ecfeff", borderTop: "1px solid #cffafe", display: "flex", alignItems: "center", gap: 10 }}>
        <span aria-hidden="true" style={{ width: 24, height: 24, borderRadius: "50%", background: "#cffafe", color: "#0e7490", fontSize: 10, fontWeight: 800, display: "grid", placeItems: "center", flex: "0 0 auto" }}>IA</span>
        <span style={{ fontSize: 11.5, color: "#155e75", lineHeight: 1.45 }}>
          <strong style={{ fontWeight: 700 }}>La IA asiste, el doctor decide.</strong> Las marcas son apoyo para tu revisión, no un diagnóstico.
        </span>
      </div>
    </figure>
  );
}

export function Radiografias3() {
  return (
    <figure className="pm-win">
      <div className="pm-win__head">
        <b>Estudios de Ana Torres</b>
        <span className="pm-pill pm-pill--violet">Expediente</span>
      </div>
      <ul className="pm-list">
        <li className="pm-row--hi">
          <span className="pm-mini pm-mini--sq" style={{ background: "#cffafe", color: "#0e7490", fontSize: 10 }} aria-hidden="true">3D</span>
          <span className="pm-list__main"><b>CBCT maxilar</b><span>2 jul · el más reciente</span></span>
          <span className="pm-list__link">Abrir</span>
        </li>
        <li>
          <span className="pm-mini pm-mini--sq" style={{ background: "#e0e7ff", color: "#4338ca", fontSize: 10 }} aria-hidden="true">RX</span>
          <span className="pm-list__main"><b>Panorámica</b><span>12 jun</span></span>
          <span className="pm-list__link">Abrir</span>
        </li>
        <li>
          <span className="pm-mini pm-mini--sq" style={{ background: "#e0e7ff", color: "#4338ca", fontSize: 10 }} aria-hidden="true">RX</span>
          <span className="pm-list__main"><b>Periapical · diente 16</b><span>12 jun</span></span>
          <span className="pm-list__link">Abrir</span>
        </li>
      </ul>
      <div style={{ padding: "12px 16px", background: "#f8fafc", borderTop: "1px solid #eef2f7", display: "flex", alignItems: "center", gap: 9 }}>
        <span className="pm-note__i" style={{ background: "#ede9fe", color: "#6d28d9" }} aria-hidden="true">i</span>
        <span style={{ fontSize: 11.5, color: "#475569" }}>Se abren desde la cita del día, sin salir del expediente</span>
      </div>
    </figure>
  );
}

export function Radiografias4() {
  return (
    <figure className="pm-win">
      <div className="pm-win__head">
        <b>Compartir con el paciente</b>
        <span className="pm-pill pm-pill--green">Portal</span>
      </div>
      <div className="pm-win__body">
        <ul className="pm-boxes">
          <li>
            <span className="pm-mini pm-mini--sq" style={{ width: 26, height: 26, borderRadius: 7, background: "#cffafe", color: "#0e7490", fontSize: 9.5 }} aria-hidden="true">3D</span>
            <span className="pm-list__main"><b style={{ fontSize: 12.5 }}>CBCT maxilar · 2 jul</b><span style={{ fontSize: 11 }}>Visible para Ana en su portal</span></span>
            <span className="pm-toggle" aria-hidden="true"><i /></span>
          </li>
          <li>
            <span className="pm-mini pm-mini--sq" style={{ width: 26, height: 26, borderRadius: 7, background: "#e0e7ff", color: "#4338ca", fontSize: 9.5 }} aria-hidden="true">RX</span>
            <span className="pm-list__main"><b style={{ fontSize: 12.5 }}>Panorámica · 12 jun</b><span style={{ fontSize: 11 }}>Solo para el equipo de la clínica</span></span>
            <span className="pm-toggle pm-toggle--off" aria-hidden="true"><i /></span>
          </li>
        </ul>
        <div className="pm-note" style={{ marginTop: 13, background: "#f6fefa", borderColor: "#dcfce7" }}>
          <i style={{ background: "#dcfce7", color: "#15803d" }}>✓</i>
          <span>Se comparte junto con su presupuesto por etapas</span>
        </div>
      </div>
    </figure>
  );
}
