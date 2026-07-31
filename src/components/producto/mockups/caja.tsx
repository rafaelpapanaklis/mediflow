// Mockups de /caja-y-cobros-clinica-dental — réplica de 4-Caja-y-cobros.dc.html.
// Las cifras ($2,150 · $4,380 · $8,430) son datos de ejemplo de la interfaz.

export function CajaHero() {
  return (
    <div className="pm-scene pm-t-emerald">
      <div className="pm-scene__glow" aria-hidden="true" />

      <div className="pm-scene__side" aria-hidden="true">
        <div className="pm-mh">
          <b>Corte del día</b>
          <span className="pm-tag pm-pill--emerald">Cuadra</span>
        </div>
        <div className="pm-mb">
          <div className="pm-mkv"><span>Efectivo</span><b>$2,150</b></div>
          <div className="pm-mkv"><span>Tarjeta</span><b>$4,380</b></div>
          <div className="pm-mkv"><span>Transferencia</span><b>$1,900</b></div>
          <div className="pm-mkv" style={{ borderTop: "1px dashed #e2e8f0", paddingTop: 6 }}><span style={{ fontWeight: 700, color: "#0f172a" }}>Esperado</span><b style={{ fontWeight: 800 }}>$8,430</b></div>
          <div className="pm-mkv" style={{ background: "#ecfdf5", borderRadius: 6, padding: "5px 7px" }}><span style={{ fontWeight: 700, color: "#065f46" }}>Diferencia</span><b style={{ color: "#047857", fontWeight: 800 }}>$0</b></div>
        </div>
      </div>

      <figure className="pm-scene__main">
        <div className="pm-mh" style={{ background: "linear-gradient(90deg,#ecfdf5,#ffffff)", padding: "10px 12px" }}>
          <b style={{ fontSize: 11 }}>Caja · hoy</b>
          <span className="pm-tag pm-pill--emerald">Abierta · Karla</span>
        </div>
        <div style={{ padding: 11 }}>
          <span className="pm-kicker" style={{ fontSize: 8.5 }}>Cobro en curso</span>
          <div style={{ marginTop: 6, border: "1px solid #e8edf4", borderRadius: 10, padding: 9 }}>
            <span style={{ display: "block", fontSize: 10.5, fontWeight: 700, color: "#0f172a" }}>Ana Torres · limpieza</span>
            <span style={{ display: "block", fontSize: 9, color: "#475569" }}>Dra. Ríos · hoy 10:45</span>
            <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 4 }}>
              <span style={{ fontSize: 8.5, fontWeight: 700, color: "#065f46", background: "#d1fae5", border: "1px solid #6ee7b7", borderRadius: 6, padding: "6px 0", textAlign: "center" }}>Efectivo</span>
              <span style={{ fontSize: 8.5, fontWeight: 600, color: "#475569", border: "1px solid #e8edf4", borderRadius: 6, padding: "6px 0", textAlign: "center" }}>Tarjeta</span>
              <span style={{ fontSize: 8.5, fontWeight: 600, color: "#475569", border: "1px solid #e8edf4", borderRadius: 6, padding: "6px 0", textAlign: "center" }}>Transfer.</span>
            </div>
            <div style={{ marginTop: 8, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: 9, color: "#475569" }}>Total del cobro</span>
              <span style={{ fontSize: 12, fontWeight: 800, color: "#0f172a" }}>$850</span>
            </div>
          </div>
          <span className="pm-kicker" style={{ marginTop: 10, fontSize: 8.5 }}>Movimientos</span>
          <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 5 }}>
            <div className="pm-mmov"><span>R. Vega · resina</span><em>Tarjeta</em><b>$1,450</b></div>
            <div className="pm-mmov"><span>L. Paredes · ortodoncia</span><em>Efectivo</em><b>$900</b></div>
            <div className="pm-mmov pm-mmov--last"><span>J. Medina · endodoncia</span><em>Transfer.</em><b>$1,900</b></div>
          </div>
        </div>
      </figure>

      <div className="pm-scene__chip" aria-hidden="true">
        <i>✓</i>
        <span>
          <b>Corte cerrado</b>
          <span>Sin diferencias</span>
        </span>
      </div>
    </div>
  );
}

export function Caja1() {
  return (
    <figure className="pm-win">
      <div className="pm-win__bar">
        <span className="pm-win__lights" aria-hidden="true"><i /><i /><i /></span>
        <span className="pm-win__url">app.dalecontrol.com/caja</span>
      </div>
      <div className="pm-win__body">
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, justifyContent: "space-between" }}>
          <span style={{ fontSize: 13.5, fontWeight: 700, color: "#0f172a" }}>Nuevo cobro</span>
          <span className="pm-pill pm-pill--emerald">Caja abierta</span>
        </div>
        <div style={{ marginTop: 12, border: "1px solid #e8edf4", borderRadius: 11, padding: 13, background: "#f8fafc" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span className="pm-mini pm-mini--round" style={{ background: "#d1fae5", color: "#065f46", fontSize: 11 }} aria-hidden="true">AT</span>
            <span className="pm-list__main"><b>Ana Torres · P0118</b><span>Limpieza dental · Dra. Ríos</span></span>
            <span style={{ fontSize: 15, fontWeight: 800, color: "#0f172a", flex: "0 0 auto" }}>$850</span>
          </div>
        </div>
        <span className="pm-kicker" style={{ marginTop: 14 }}>Método de pago</span>
        <div className="pm-methods" style={{ marginTop: 9 }}>
          <span className="is-on">Efectivo</span>
          <span>Tarjeta</span>
          <span>Transferencia</span>
          <span>Combinado</span>
        </div>
        <div className="pm-note" style={{ marginTop: 12, background: "#fffbeb", borderColor: "#fde68a" }}>
          <i style={{ background: "#fef3c7", color: "#b45309" }}>!</i>
          <span>Si abona una parte, el resto queda como saldo pendiente</span>
        </div>
        <div style={{ marginTop: 14, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, justifyContent: "space-between" }}>
          <span style={{ fontSize: 11.5, color: "#475569" }}>Registra: Karla · recepción</span>
          <span className="pm-act" style={{ background: "#047857" }}>Cobrar</span>
        </div>
      </div>
    </figure>
  );
}

export function Caja2() {
  return (
    <figure className="pm-win">
      <div className="pm-win__head">
        <b>Abrir caja</b>
        <span className="pm-pill pm-pill--blue">Turno matutino</span>
      </div>
      <div className="pm-win__body" style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
        <div style={{ flex: "1 1 150px", minWidth: 0 }}>
          <span style={{ display: "block", fontSize: 11.5, color: "#475569" }}>Ingresa tu PIN</span>
          <div style={{ marginTop: 9, display: "flex", gap: 6 }} aria-hidden="true">
            <span style={{ width: 13, height: 13, borderRadius: "50%", background: "#1d4ed8", display: "block" }} />
            <span style={{ width: 13, height: 13, borderRadius: "50%", background: "#1d4ed8", display: "block" }} />
            <span style={{ width: 13, height: 13, borderRadius: "50%", background: "#1d4ed8", display: "block" }} />
            <span style={{ width: 13, height: 13, borderRadius: "50%", border: "1px solid #cbd5e1", display: "block" }} />
          </div>
          <div className="pm-keypad" style={{ marginTop: 12 }} aria-hidden="true">
            {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((n) => (
              <span key={n}>{n}</span>
            ))}
          </div>
        </div>
        <div style={{ flex: "1 1 170px", minWidth: 0 }}>
          <span className="pm-kicker">Sesiones de hoy</span>
          <ul className="pm-boxes" style={{ marginTop: 9 }}>
            <li>
              <span className="pm-mini pm-mini--round" style={{ width: 26, height: 26, background: "#dbeafe", color: "#1e40af", fontSize: 10 }} aria-hidden="true">KM</span>
              <span className="pm-list__main"><b style={{ fontSize: 12 }}>Karla · recepción</b><span style={{ fontSize: 10.5 }}>Abrió 09:00</span></span>
            </li>
            <li>
              <span className="pm-mini pm-mini--round pm-mini--gray" style={{ width: 26, height: 26, fontSize: 10 }} aria-hidden="true">DR</span>
              <span className="pm-list__main"><b style={{ fontSize: 12 }}>Dra. Ríos</b><span style={{ fontSize: 10.5 }}>Solo consulta</span></span>
            </li>
          </ul>
          <div className="pm-note" style={{ marginTop: 10 }}>
            <i style={{ background: "#dbeafe", color: "#1d4ed8", fontSize: 10 }}>2F</i>
            <span style={{ fontSize: 11 }}>2FA activo para las cuentas del equipo</span>
          </div>
        </div>
      </div>
    </figure>
  );
}

export function Caja3() {
  return (
    <figure className="pm-win">
      <div className="pm-win__head">
        <b>Corte de caja · jueves 9 jul</b>
        <span className="pm-pill pm-pill--emerald">Cuadra</span>
      </div>
      <ul className="pm-list">
        <li><span className="pm-boxes__k">Efectivo · 6 movimientos</span><span className="pm-list__amount">$2,150</span></li>
        <li><span className="pm-boxes__k">Tarjeta · 4 movimientos</span><span className="pm-list__amount">$4,380</span></li>
        <li><span className="pm-boxes__k">Transferencia · 2 movimientos</span><span className="pm-list__amount">$1,900</span></li>
      </ul>
      <div className="pm-win__body" style={{ background: "#f8fafc", borderTop: "1px solid #eef2f7" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <span style={{ fontSize: 12.5, fontWeight: 700, color: "#0f172a" }}>Esperado en caja</span>
          <span style={{ fontSize: 15, fontWeight: 800, color: "#0f172a" }}>$8,430</span>
        </div>
        <div style={{ marginTop: 8, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <span style={{ fontSize: 12.5, color: "#475569" }}>Contado por Karla</span>
          <span style={{ fontSize: 15, fontWeight: 800, color: "#0f172a" }}>$8,430</span>
        </div>
        <div style={{ marginTop: 10, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, background: "#ecfdf5", border: "1px solid #a7f3d0", borderRadius: 10, padding: "10px 12px" }}>
          <span style={{ fontSize: 12.5, fontWeight: 700, color: "#065f46" }}>Diferencia</span>
          <span style={{ fontSize: 14, fontWeight: 800, color: "#047857" }}>$0</span>
        </div>
        <div style={{ marginTop: 13, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, justifyContent: "space-between" }}>
          <span style={{ fontSize: 11.5, color: "#475569" }}>Se guarda con fecha, turno y responsable</span>
          <span className="pm-act" style={{ background: "#b45309" }}>Cerrar caja</span>
        </div>
      </div>
    </figure>
  );
}

export function Caja4() {
  return (
    <figure className="pm-win">
      <div className="pm-win__head">
        <b>Saldos pendientes</b>
        <span className="pm-pill pm-pill--violet">Con cita esta semana</span>
      </div>
      <ul className="pm-list">
        <li>
          <span className="pm-mini pm-mini--round" style={{ background: "#ede9fe", color: "#6d28d9" }} aria-hidden="true">LP</span>
          <span className="pm-list__main"><b>L. Paredes</b><span>Ortodoncia · mensualidad de julio</span></span>
          <span className="pm-list__amount">$1,200</span>
        </li>
        <li>
          <span className="pm-mini pm-mini--round pm-mini--gray" aria-hidden="true">JM</span>
          <span className="pm-list__main"><b>J. Medina</b><span>Endodoncia · abonó una parte</span></span>
          <span className="pm-list__amount">$900</span>
        </li>
        <li>
          <span className="pm-mini pm-mini--round pm-mini--gray" aria-hidden="true">RV</span>
          <span className="pm-list__main"><b>R. Vega</b><span>Resina · pendiente desde junio</span></span>
          <span className="pm-list__amount">$450</span>
        </li>
      </ul>
      <div style={{ padding: "12px 16px", background: "#f8fafc", borderTop: "1px solid #eef2f7", display: "flex", alignItems: "center", gap: 9 }}>
        <span className="pm-note__i" style={{ background: "#ede9fe", color: "#6d28d9" }} aria-hidden="true">i</span>
        <span style={{ fontSize: 11.5, color: "#475569" }}>Recepción lo ve al abrir la cita del día</span>
      </div>
    </figure>
  );
}
