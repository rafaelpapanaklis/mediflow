// Mockups de /software-multiclinica-dental — réplica de 8-Multisede-roles.dc.html.

type Cell = "yes" | "no" | string;

function cell(v: Cell) {
  if (v === "yes") return <span style={{ textAlign: "center", fontSize: 13, fontWeight: 800, color: "#15803d" }}>✓</span>;
  if (v === "no") return <span style={{ textAlign: "center", fontSize: 13, fontWeight: 800, color: "#b91c1c" }}>✕</span>;
  return <span style={{ textAlign: "center", fontSize: 11, fontWeight: 700, color: "#b45309" }}>{v}</span>;
}

const MATRIX: Array<[string, Cell, Cell, Cell, Cell]> = [
  ["Agenda y citas", "yes", "yes", "yes", "yes"],
  ["Expediente clínico", "yes", "yes", "solo ver", "no"],
  ["Caja y cobros", "yes", "no", "no", "yes"],
  ["Facturación", "yes", "no", "no", "yes"],
  ["Reportes de ingresos", "yes", "solo suyos", "no", "no"],
];

export function MultisedeHero() {
  return (
    <div className="pm-scene pm-t-navy">
      <div className="pm-scene__glow" aria-hidden="true" />

      <div className="pm-scene__side" aria-hidden="true">
        <div className="pm-mh">
          <b>Tus sedes</b>
          <span className="pm-tag pm-pill--navy">3</span>
        </div>
        <div className="pm-mb">
          <div className="pm-mrow" style={{ borderColor: "#bfdbfe", background: "#eff6ff" }}>
            <span aria-hidden="true" style={{ width: 16, height: 16, borderRadius: 4, background: "#1e40af", display: "block", flex: "0 0 auto" }} />
            <span style={{ fontWeight: 700, color: "#1e3a8a" }}>Sede Centro</span>
            <b style={{ fontSize: 8.5, color: "#1d4ed8", fontWeight: 600 }}>activa</b>
          </div>
          <div className="pm-mrow">
            <span aria-hidden="true" style={{ width: 16, height: 16, borderRadius: 4, background: "#94a3b8", display: "block", flex: "0 0 auto" }} />
            <span>Sede Norte</span>
          </div>
          <div className="pm-mrow">
            <span aria-hidden="true" style={{ width: 16, height: 16, borderRadius: 4, background: "#94a3b8", display: "block", flex: "0 0 auto" }} />
            <span>Sede Sur</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 7, borderTop: "1px dashed #e2e8f0", paddingTop: 7 }}>
            <span style={{ flex: "1 1 auto", fontSize: 9, color: "#475569" }}>Vista consolidada</span>
            <span aria-hidden="true" style={{ color: "#1e40af", fontWeight: 800, fontSize: 10 }}>→</span>
          </div>
        </div>
      </div>

      <figure className="pm-scene__main">
        <div className="pm-mh" style={{ background: "linear-gradient(90deg,#eff6ff,#ffffff)", padding: "10px 12px" }}>
          <b style={{ fontSize: 11 }}>Permisos por puesto</b>
          <span className="pm-tag pm-pill--navy">Sede Centro</span>
        </div>
        <div style={{ padding: 11 }}>
          <div className="pm-mmx pm-mmx--head">
            <span style={{ textAlign: "left" }}>PERMISO</span><span>ADMIN</span><span>DOCTOR</span><span>RECEP.</span>
          </div>
          <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 4 }}>
            <div className="pm-mmx"><span style={{ textAlign: "left", color: "#0f172a" }}>Agenda</span><b className="ok">✓</b><b className="ok">✓</b><b className="ok">✓</b></div>
            <div className="pm-mmx"><span style={{ textAlign: "left", color: "#0f172a" }}>Expediente</span><b className="ok">✓</b><b className="ok">✓</b><b className="no">✕</b></div>
            <div className="pm-mmx"><span style={{ textAlign: "left", color: "#0f172a" }}>Caja</span><b className="ok">✓</b><b className="no">✕</b><b className="ok">✓</b></div>
            <div className="pm-mmx pm-mmx--last"><span style={{ textAlign: "left", color: "#0f172a" }}>Reportes</span><b className="ok">✓</b><b className="mid">◐</b><b className="no">✕</b></div>
          </div>
          <div style={{ marginTop: 9, display: "flex", alignItems: "center", gap: 7, background: "#f8fafc", border: "1px solid #e8edf4", borderRadius: 8, padding: "7px 9px" }}>
            <span aria-hidden="true" style={{ width: 16, height: 16, borderRadius: "50%", background: "#dbeafe", color: "#1e40af", fontSize: 7.5, fontWeight: 800, display: "grid", placeItems: "center", flex: "0 0 auto" }}>2F</span>
            <span style={{ fontSize: 8.5, color: "#475569" }}>2FA activo para todo el equipo</span>
          </div>
        </div>
      </figure>

      <div className="pm-scene__chip" aria-hidden="true">
        <i>✓</i>
        <span>
          <b>Permisos actualizados</b>
          <span>Aplican en las 3 sedes</span>
        </span>
      </div>
    </div>
  );
}

export function Multisede1() {
  return (
    <figure className="pm-win">
      <div className="pm-win__bar">
        <span className="pm-win__lights" aria-hidden="true"><i /><i /><i /></span>
        <span className="pm-win__url">app.dalecontrol.com/sedes</span>
      </div>
      <div className="pm-win__body">
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, justifyContent: "space-between" }}>
          <span style={{ fontSize: 13.5, fontWeight: 700, color: "#0f172a" }}>Selector de sede</span>
          <span className="pm-pill pm-pill--navy">3 sucursales</span>
        </div>
        <ul className="pm-boxes" style={{ marginTop: 12 }}>
          <li style={{ borderColor: "#bfdbfe", background: "#eff6ff", borderRadius: 11, padding: "11px 12px" }}>
            <span className="pm-mini pm-mini--sq" style={{ width: 28, height: 28, background: "#1e40af", color: "#fff", fontSize: 10 }} aria-hidden="true">CE</span>
            <span className="pm-list__main"><b style={{ color: "#1e3a8a", fontWeight: 700 }}>Sede Centro</b><span style={{ color: "#1d4ed8" }}>2 doctores · 4 sillones · caja abierta</span></span>
            <span className="pm-pill" style={{ color: "#fff", background: "#1e40af" }}>Activa</span>
          </li>
          <li style={{ borderRadius: 11, padding: "11px 12px" }}>
            <span className="pm-mini pm-mini--sq pm-mini--gray" style={{ width: 28, height: 28, fontSize: 10 }} aria-hidden="true">NO</span>
            <span className="pm-list__main"><b>Sede Norte</b><span>1 doctor · 2 sillones</span></span>
            <span className="pm-list__link" style={{ color: "#1e40af" }}>Entrar</span>
          </li>
          <li style={{ borderRadius: 11, padding: "11px 12px" }}>
            <span className="pm-mini pm-mini--sq pm-mini--gray" style={{ width: 28, height: 28, fontSize: 10 }} aria-hidden="true">SU</span>
            <span className="pm-list__main"><b>Sede Sur</b><span>1 doctor · 2 sillones</span></span>
            <span className="pm-list__link" style={{ color: "#1e40af" }}>Entrar</span>
          </li>
        </ul>
        <div className="pm-note" style={{ marginTop: 12 }}>
          <i style={{ background: "#dbeafe", color: "#1e40af" }}>Σ</i>
          <span style={{ flex: "1 1 auto" }}>Ver todas las sedes juntas</span>
          <span aria-hidden="true" style={{ color: "#1e40af", fontWeight: 800 }}>→</span>
        </div>
      </div>
    </figure>
  );
}

export function Multisede2() {
  return (
    <figure className="pm-win">
      <div className="pm-win__head" style={{ background: "linear-gradient(90deg,#f5f3ff,#ffffff)" }}>
        <b>Matriz de permisos</b>
        <span className="pm-pill pm-pill--violet">Sede Centro</span>
      </div>
      <div className="pm-win__body pm-win__body--tight pm-scroll">
        <div style={{ minWidth: 392 }}>
          <div className="pm-mx pm-mx--head">
            <span>Permiso</span>
            <span>Admin</span>
            <span>Doctor</span>
            <span>Higiene</span>
            <span>Recepción</span>
          </div>
          {MATRIX.map(([label, a, d, h, r], i) => (
            <div key={label} className={`pm-mx${i === MATRIX.length - 1 ? " pm-mx--last" : ""}`}>
              <span style={{ fontSize: 12.5, color: "#0f172a" }}>{label}</span>
              {cell(a)}
              {cell(d)}
              {cell(h)}
              {cell(r)}
            </div>
          ))}
        </div>
      </div>
    </figure>
  );
}

export function Multisede3() {
  return (
    <figure className="pm-win">
      <div className="pm-win__head">
        <b>Equipo y accesos</b>
        <span className="pm-pill pm-pill--green">2FA activo</span>
      </div>
      <ul className="pm-list">
        <li>
          <span className="pm-mini pm-mini--round" style={{ background: "#dbeafe", color: "#1e40af" }} aria-hidden="true">RM</span>
          <span className="pm-list__main"><b>Rafael M. · admin</b><span>Acceso a las 3 sedes</span></span>
          <span className="pm-pill pm-pill--green">2FA</span>
        </li>
        <li>
          <span className="pm-mini pm-mini--round" style={{ background: "#ede9fe", color: "#6d28d9" }} aria-hidden="true">DR</span>
          <span className="pm-list__main"><b>Dra. Ríos · doctora</b><span>Centro y Norte</span></span>
          <span className="pm-pill pm-pill--green">2FA</span>
        </li>
        <li>
          <span className="pm-mini pm-mini--round pm-mini--gray" aria-hidden="true">KM</span>
          <span className="pm-list__main"><b>Karla M. · recepción</b><span>Solo sede Centro</span></span>
          <span className="pm-pill pm-pill--amber">Por activar</span>
        </li>
        <li>
          <span className="pm-mini pm-mini--round pm-mini--gray" aria-hidden="true">+</span>
          <span className="pm-list__main"><b>Invitar a alguien más</b><span>Con su correo y su rol</span></span>
          <span aria-hidden="true" style={{ color: "#15803d", fontWeight: 800, flex: "0 0 auto" }}>→</span>
        </li>
      </ul>
    </figure>
  );
}

export function Multisede4() {
  return (
    <figure className="pm-win">
      <div className="pm-win__head">
        <b>Configuración · Sede Norte</b>
        <span className="pm-pill pm-pill--amber">Editar</span>
      </div>
      <div className="pm-win__body">
        <ul className="pm-boxes">
          <li><span className="pm-boxes__k">Horario</span><span className="pm-boxes__v">Lun a vie · 9:00 a 19:00</span></li>
          <li><span className="pm-boxes__k">Sábados</span><span className="pm-boxes__v">9:00 a 14:00</span></li>
          <li><span className="pm-boxes__k">Sillones</span><span className="pm-boxes__v">2</span></li>
          <li><span className="pm-boxes__k">Doctores asignados</span><span className="pm-boxes__v">Dra. Ríos</span></li>
          <li><span className="pm-boxes__k">WhatsApp de la sede</span><span className="pm-boxes__v">Número propio</span></li>
        </ul>
        <div className="pm-note" style={{ marginTop: 13 }}>
          <i style={{ background: "#fef3c7", color: "#b45309" }}>i</i>
          <span>Las reservas en línea respetan este horario</span>
        </div>
      </div>
    </figure>
  );
}
