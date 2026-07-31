// Mockups de /software-agenda-dental — réplica de 1-Agenda-recordatorios.dc.html.
// Ilustraciones estáticas del panel: los nombres y las cifras son de ejemplo.

export function AgendaHero() {
  return (
    <div className="pm-scene pm-t-green">
      <div className="pm-scene__glow" aria-hidden="true" />

      <div className="pm-scene__side" aria-hidden="true">
        <div className="pm-mh">
          <b>Agenda · jue 9 jul</b>
          <span className="pm-tag pm-pill--violet">Semana</span>
        </div>
        <div className="pm-mb">
          <div className="pm-mslot"><span>09:00</span><b style={{ background: "#dcfce7", color: "#166534" }}>Ortodoncia · confirmada ✓</b></div>
          <div className="pm-mslot"><span>10:00</span><b style={{ background: "#dbeafe", color: "#1e40af" }}>Limpieza · Ana T. ✓</b></div>
          <div className="pm-mslot"><span>11:00</span><b style={{ background: "#fef3c7", color: "#92400e" }}>Valoración · por confirmar</b></div>
          <div className="pm-mslot"><span>12:00</span><b style={{ border: "1px dashed #c4b5fd", color: "#6d28d9" }}>Hueco libre · lista de espera</b></div>
        </div>
      </div>

      <figure className="pm-scene__main pm-scene__main--phone">
        <div className="pm-phone">
          <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "11px 12px", background: "#15803d" }}>
            <span aria-hidden="true" style={{ width: 27, height: 27, borderRadius: "50%", background: "rgba(255,255,255,.24)", color: "#fff", fontSize: 10.5, fontWeight: 800, display: "grid", placeItems: "center", flex: "0 0 auto" }}>DC</span>
            <span style={{ flex: "1 1 auto", minWidth: 0 }}>
              <span style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#fff" }}>Clínica Dental</span>
              <span style={{ display: "block", fontSize: 10, color: "#dcfce7" }}>en línea</span>
            </span>
          </div>
          <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ background: "#fff", borderRadius: "12px 12px 12px 3px", padding: "10px 11px", boxShadow: "0 1px 2px rgba(15,23,42,.14)" }}>
              <p style={{ fontSize: 11.5, lineHeight: 1.5, color: "#0f172a" }}>
                Hola Ana 👋 te recordamos tu cita de <strong>limpieza</strong> mañana a las <strong>10:00 am</strong> con la Dra. Ríos.
              </p>
              <p style={{ marginTop: 6, fontSize: 10.5, lineHeight: 1.45, color: "#475569" }}>Av. Insurgentes 123, consultorio 4.</p>
              <div style={{ marginTop: 9, display: "flex", gap: 5, flexWrap: "wrap" }}>
                <span style={{ fontSize: 10.5, fontWeight: 700, color: "#15803d", background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 7, padding: "5px 9px" }}>Confirmar</span>
                <span style={{ fontSize: 10.5, fontWeight: 700, color: "#475569", background: "#f8fafc", border: "1px solid #e8edf4", borderRadius: 7, padding: "5px 9px" }}>Reagendar</span>
              </div>
              <span style={{ display: "block", marginTop: 7, fontSize: 9.5, color: "#475569" }}>Ayer 18:00</span>
            </div>
            <div style={{ alignSelf: "flex-end", background: "#dcfce7", borderRadius: "12px 12px 3px 12px", padding: "8px 11px", maxWidth: "74%" }}>
              <p style={{ fontSize: 11.5, lineHeight: 1.45, color: "#14532d", fontWeight: 600 }}>Confirmar</p>
              <span style={{ display: "block", marginTop: 3, fontSize: 9.5, color: "#14532d", textAlign: "right" }}>18:04 ✓✓</span>
            </div>
          </div>
        </div>
      </figure>

      <div className="pm-scene__chip" aria-hidden="true">
        <i>✓</i>
        <span>
          <b>Recordatorio enviado</b>
          <span>Ana T. confirmó su cita</span>
        </span>
      </div>
    </div>
  );
}

export function Agenda1() {
  return (
    <figure className="pm-win">
      <div className="pm-win__head" style={{ background: "linear-gradient(90deg,#f5f3ff,#ffffff)" }}>
        <b>Jueves 9 de julio</b>
        <span className="pm-pill pm-pill--amber">Sala de espera: 1</span>
      </div>
      <ul className="pm-list pm-list--agenda">
        <li>
          <span className="pm-hour">09:00</span>
          <span className="pm-tick" style={{ background: "#22c55e" }} aria-hidden="true" />
          <span className="pm-list__main"><b>Ortodoncia · L. Paredes</b><span>Dra. Ríos · Sillón 2</span></span>
          <span className="pm-pill pm-pill--green">Confirmada</span>
        </li>
        <li className="pm-row--hi">
          <span className="pm-hour">10:00</span>
          <span className="pm-tick" style={{ background: "#7c3aed" }} aria-hidden="true" />
          <span className="pm-list__main"><b>Endodoncia · J. Medina</b><span>Dr. Salas · Sillón 1 · en el consultorio</span></span>
          <span className="pm-pill pm-pill--violet">En curso</span>
        </li>
        <li>
          <span className="pm-hour">11:00</span>
          <span className="pm-tick" style={{ background: "#f59e0b" }} aria-hidden="true" />
          <span className="pm-list__main"><b>Valoración · R. Vega</b><span>Dra. Ríos · Sillón 2 · reserva en línea</span></span>
          <span className="pm-pill pm-pill--amber">Por confirmar</span>
        </li>
        <li>
          <span className="pm-hour" style={{ color: "#475569" }}>12:00</span>
          <span className="pm-list__main" style={{ border: "1px dashed #c4b5fd", background: "#fbfaff", borderRadius: 9, padding: "8px 10px" }}>
            <b style={{ fontSize: 12.5, color: "#6d28d9" }}>Espacio libre · 45 min</b>
          </span>
        </li>
      </ul>
    </figure>
  );
}

export function Agenda2() {
  return (
    <figure className="pm-win">
      <div className="pm-win__bar">
        <span className="pm-win__lights" aria-hidden="true"><i /><i /><i /></span>
        <span className="pm-win__url">app.dalecontrol.com/recordatorios</span>
      </div>
      <div className="pm-win__body">
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, justifyContent: "space-between" }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: "#0f172a" }}>Plantilla · Recordatorio de cita</span>
          <span className="pm-pill pm-pill--green">Activa</span>
        </div>
        <div style={{ marginTop: 12, border: "1px solid #e8edf4", borderRadius: 11, padding: 12, background: "#f8fafc" }}>
          <p style={{ fontSize: 12.5, lineHeight: 1.6, color: "#0f172a" }}>
            Hola <span className="pm-var pm-var--g">{"{nombre}"}</span> 👋 te recordamos tu cita de{" "}
            <span className="pm-var pm-var--b">{"{tratamiento}"}</span> el <span className="pm-var pm-var--v">{"{fecha}"}</span> a las{" "}
            <span className="pm-var pm-var--v">{"{hora}"}</span> con <span className="pm-var pm-var--b">{"{doctor}"}</span>.
          </p>
          <div className="pm-chips" style={{ marginTop: 10 }}>
            <span>+ {"{dirección}"}</span>
            <span>+ {"{sillón}"}</span>
            <span>+ {"{link de mapa}"}</span>
          </div>
        </div>
        <span className="pm-kicker" style={{ marginTop: 16 }}>Cuándo se envía</span>
        <ul className="pm-boxes" style={{ marginTop: 9 }}>
          <li>
            <span className="pm-toggle" aria-hidden="true"><i /></span>
            <span className="pm-boxes__k" style={{ fontWeight: 600, color: "#0f172a", fontSize: 12 }}>Un día antes · 6:00 pm</span>
            <span style={{ fontSize: 10.5, color: "#475569" }}>automático</span>
          </li>
          <li>
            <span className="pm-toggle" aria-hidden="true"><i /></span>
            <span className="pm-boxes__k" style={{ fontWeight: 600, color: "#0f172a", fontSize: 12 }}>Dos horas antes de la cita</span>
            <span style={{ fontSize: 10.5, color: "#475569" }}>automático</span>
          </li>
          <li className="pm-row--ok">
            <span className="pm-note__i" aria-hidden="true">✓</span>
            <span className="pm-boxes__k" style={{ fontWeight: 600, color: "#0f172a", fontSize: 12 }}>La respuesta del paciente entra a la cita</span>
          </li>
        </ul>
        <div style={{ marginTop: 14, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, justifyContent: "space-between" }}>
          <span style={{ fontSize: 11.5, color: "#475569" }}>Una plantilla por tratamiento</span>
          <span className="pm-act" style={{ background: "#15803d" }}>Guardar plantilla</span>
        </div>
      </div>
    </figure>
  );
}

export function Agenda3() {
  return (
    <figure className="pm-win">
      <div className="pm-win__bar">
        <span className="pm-win__lights" aria-hidden="true"><i /><i /><i /></span>
        <span className="pm-win__url">dalecontrol.com/tu-clinica/agendar</span>
      </div>
      <div className="pm-win__body">
        <h4 style={{ fontSize: 15, fontWeight: 700, color: "#0f172a" }}>Agenda tu cita</h4>
        <p style={{ marginTop: 5, fontSize: 12, color: "#64748b" }}>Elige el día y la hora que te acomode</p>
        <div className="pm-chips pm-chips--round" style={{ marginTop: 14 }}>
          <span>Vie 10</span>
          <span className="is-on">Sáb 11</span>
          <span>Lun 13</span>
          <span>Mar 14</span>
        </div>
        <div className="pm-slots" style={{ marginTop: 16 }}>
          <span className="is-off">09:00</span>
          <span>10:00</span>
          <span className="is-sel">11:30</span>
          <span>13:00</span>
          <span className="is-off">16:00</span>
          <span>17:30</span>
        </div>
        <div style={{ marginTop: 16, borderTop: "1px solid #f1f5f9", paddingTop: 14, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, justifyContent: "space-between" }}>
          <span style={{ fontSize: 11.5, color: "#475569" }}>Limpieza dental · 45 min</span>
          <span className="pm-act" style={{ background: "#7c3aed" }}>Reservar</span>
        </div>
      </div>
    </figure>
  );
}

export function Agenda4() {
  return (
    <figure className="pm-win">
      <div className="pm-win__head">
        <b>Hueco liberado</b>
        <span className="pm-pill pm-pill--amber">VIE 10 · 11:00</span>
      </div>
      <div style={{ padding: "14px 16px", borderBottom: "1px solid #f1f5f9" }}>
        <p style={{ fontSize: 12.5, color: "#475569", lineHeight: 1.5 }}>
          Cancelación de <strong style={{ color: "#0f172a", fontWeight: 700 }}>L. Paredes</strong> · Ortodoncia, Sillón 2
        </p>
        <p style={{ marginTop: 6, fontSize: 11.5, color: "#64748b" }}>Se ofreció al primer paciente de la lista de espera</p>
      </div>
      <ul className="pm-list">
        <li className="pm-row--ok">
          <span className="pm-mini pm-mini--round" style={{ background: "#dcfce7", color: "#15803d" }} aria-hidden="true">MG</span>
          <span className="pm-list__main"><b>M. Gutiérrez</b><span>Ortodoncia · espera desde el lunes</span></span>
          <span className="pm-pill" style={{ color: "#fff", background: "#15803d" }}>Aceptó</span>
        </li>
        <li>
          <span className="pm-mini pm-mini--round pm-mini--gray" aria-hidden="true">SR</span>
          <span className="pm-list__main"><b>S. Ruiz</b><span>Ortodoncia · sigue en lista</span></span>
          <span className="pm-pill pm-pill--gray">En espera</span>
        </li>
      </ul>
      <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "12px 16px", background: "#f5f3ff" }}>
        <span className="pm-note__i" style={{ background: "#ede9fe", color: "#6d28d9" }} aria-hidden="true">⟳</span>
        <span style={{ fontSize: 11.5, color: "#475569" }}>Viernes 11:00 vuelve a estar ocupado</span>
      </div>
    </figure>
  );
}
