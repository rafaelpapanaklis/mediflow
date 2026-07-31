// Mockups de /portal-del-paciente-dental — réplica de 3-Portal-del-paciente.dc.html.

export function PortalHero() {
  return (
    <div className="pm-scene pm-t-violet">
      <div className="pm-scene__glow" aria-hidden="true" />

      <div className="pm-scene__side" aria-hidden="true">
        <div className="pm-mh">
          <b>Estado de cuenta</b>
          <span className="pm-tag pm-pill--green">Al día</span>
        </div>
        <div className="pm-mb">
          <div className="pm-mrow"><span>Limpieza · 3 may</span><b style={{ color: "#15803d" }}>Pagado</b></div>
          <div className="pm-mrow"><span>Resina · 12 jun</span><b style={{ color: "#15803d" }}>Pagado</b></div>
          <div className="pm-mrow" style={{ borderColor: "#fde68a", background: "#fffbeb" }}><span style={{ color: "#92400e" }}>Ortodoncia · mensualidad</span><b style={{ color: "#b45309" }}>Pendiente</b></div>
          <div className="pm-mrow"><span>Recibo de tu último pago</span><b style={{ color: "#6d28d9" }}>Ver</b></div>
        </div>
      </div>

      <figure className="pm-scene__main pm-scene__main--phone">
        <div className="pm-phone" style={{ background: "#f8fafc" }}>
          <div style={{ padding: 12, background: "linear-gradient(135deg,#6d28d9,#7c3aed)" }}>
            <span style={{ display: "block", fontSize: 9.5, color: "#ddd6fe", fontWeight: 600 }}>Clínica Dental · portal</span>
            <span style={{ display: "block", marginTop: 3, fontSize: 13, fontWeight: 800, color: "#fff" }}>Hola, Ana</span>
          </div>
          <div style={{ padding: 11, display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ background: "#fff", border: "1px solid #e8edf4", borderRadius: 11, padding: 10 }}>
              <span className="pm-kicker" style={{ fontSize: 8.5, color: "#6d28d9", letterSpacing: ".09em" }}>Tu próxima cita</span>
              <span style={{ display: "block", marginTop: 4, fontSize: 11.5, fontWeight: 700, color: "#0f172a" }}>Jue 9 jul · 10:00 am</span>
              <span style={{ display: "block", fontSize: 9.5, color: "#475569" }}>Limpieza · Dra. Ríos</span>
              <div style={{ marginTop: 8, display: "flex", gap: 5 }}>
                <span style={{ flex: "1 1 auto", textAlign: "center", fontSize: 10, fontWeight: 700, color: "#fff", background: "#7c3aed", borderRadius: 7, padding: "6px 0" }}>Confirmar</span>
                <span style={{ flex: "1 1 auto", textAlign: "center", fontSize: 10, fontWeight: 700, color: "#475569", border: "1px solid #e8edf4", borderRadius: 7, padding: "6px 0" }}>Reagendar</span>
              </div>
            </div>
            <div style={{ background: "#fff", border: "1px solid #e8edf4", borderRadius: 11, padding: 10, display: "flex", alignItems: "center", gap: 8 }}>
              <span aria-hidden="true" style={{ width: 24, height: 24, borderRadius: 7, background: "#ede9fe", color: "#6d28d9", fontSize: 9, fontWeight: 800, display: "grid", placeItems: "center", flex: "0 0 auto" }}>$</span>
              <span style={{ flex: "1 1 auto", minWidth: 0 }}>
                <span style={{ display: "block", fontSize: 10.5, fontWeight: 700, color: "#0f172a" }}>Presupuesto por revisar</span>
                <span style={{ display: "block", fontSize: 9, color: "#475569" }}>Plan de ortodoncia</span>
              </span>
              <span aria-hidden="true" style={{ color: "#6d28d9", fontWeight: 800, fontSize: 11 }}>→</span>
            </div>
            <div style={{ background: "#fff", border: "1px solid #e8edf4", borderRadius: 11, padding: 10, display: "flex", alignItems: "center", gap: 8 }}>
              <span aria-hidden="true" style={{ width: 24, height: 24, borderRadius: 7, background: "#dbeafe", color: "#1e40af", fontSize: 9, fontWeight: 800, display: "grid", placeItems: "center", flex: "0 0 auto" }}>✎</span>
              <span style={{ flex: "1 1 auto", minWidth: 0 }}>
                <span style={{ display: "block", fontSize: 10.5, fontWeight: 700, color: "#0f172a" }}>Consentimiento</span>
                <span style={{ display: "block", fontSize: 9, color: "#475569" }}>Firma antes de tu cita</span>
              </span>
              <span aria-hidden="true" style={{ color: "#6d28d9", fontWeight: 800, fontSize: 11 }}>→</span>
            </div>
          </div>
        </div>
      </figure>

      <div className="pm-scene__chip" aria-hidden="true">
        <i>✓</i>
        <span>
          <b>Presupuesto aceptado</b>
          <span>Firmado desde el portal</span>
        </span>
      </div>
    </div>
  );
}

export function Portal1() {
  return (
    <figure className="pm-win">
      <div className="pm-win__bar">
        <span className="pm-win__lights" aria-hidden="true"><i /><i /><i /></span>
        <span className="pm-win__url">dalecontrol.com/tu-clinica/mi-cuenta</span>
      </div>
      <div className="pm-win__body">
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, justifyContent: "space-between" }}>
          <span style={{ fontSize: 13.5, fontWeight: 700, color: "#0f172a" }}>Mi cuenta · Ana Torres</span>
          <span className="pm-pill pm-pill--violet">Acceso por WhatsApp</span>
        </div>
        <div style={{ marginTop: 13, border: "1px solid #ddd6fe", background: "#faf9ff", borderRadius: 11, padding: 13 }}>
          <span className="pm-kicker" style={{ fontSize: 10, color: "#6d28d9" }}>Próxima cita</span>
          <span style={{ display: "block", marginTop: 5, fontSize: 15, fontWeight: 800, color: "#0f172a" }}>Jueves 9 de julio · 10:00 am</span>
          <span style={{ display: "block", marginTop: 2, fontSize: 12, color: "#475569" }}>Limpieza · Dra. Ríos · Av. Insurgentes 123</span>
          <div style={{ marginTop: 11, display: "flex", flexWrap: "wrap", gap: 7 }}>
            <span style={{ fontSize: 11.5, fontWeight: 700, color: "#fff", background: "#7c3aed", borderRadius: 9, padding: "8px 14px" }}>Confirmar cita</span>
            <span style={{ fontSize: 11.5, fontWeight: 700, color: "#475569", background: "#fff", border: "1px solid #e8edf4", borderRadius: 9, padding: "8px 14px" }}>Pedir otra fecha</span>
          </div>
        </div>
        <ul className="pm-boxes" style={{ marginTop: 13 }}>
          <li>
            <span className="pm-mini pm-mini--sq" style={{ width: 24, height: 24, borderRadius: 7, background: "#dbeafe", color: "#1e40af", fontSize: 9.5 }} aria-hidden="true">✎</span>
            <span className="pm-boxes__k" style={{ fontSize: 12, fontWeight: 600, color: "#0f172a" }}>Consentimiento informado</span>
            <span className="pm-pill pm-pill--amber">Por firmar</span>
          </li>
          <li>
            <span className="pm-mini pm-mini--sq" style={{ width: 24, height: 24, borderRadius: 7, background: "#ede9fe", color: "#6d28d9", fontSize: 9.5 }} aria-hidden="true">◷</span>
            <span className="pm-boxes__k" style={{ fontSize: 12, fontWeight: 600, color: "#0f172a" }}>Mis visitas anteriores</span>
            <span aria-hidden="true" style={{ color: "#6d28d9", fontWeight: 800 }}>→</span>
          </li>
          <li>
            <span className="pm-mini pm-mini--sq" style={{ width: 24, height: 24, borderRadius: 7, background: "#dcfce7", color: "#15803d", fontSize: 9.5 }} aria-hidden="true">$</span>
            <span className="pm-boxes__k" style={{ fontSize: 12, fontWeight: 600, color: "#0f172a" }}>Mi estado de cuenta</span>
            <span aria-hidden="true" style={{ color: "#6d28d9", fontWeight: 800 }}>→</span>
          </li>
        </ul>
      </div>
    </figure>
  );
}

export function Portal2() {
  return (
    <figure className="pm-win">
      <div className="pm-win__head">
        <b>Presupuesto · plan de ortodoncia</b>
        <span className="pm-pill pm-pill--green">Aceptado</span>
      </div>
      <ul className="pm-list">
        <li>
          <span className="pm-mini pm-mini--round" style={{ width: 22, height: 22, background: "#dcfce7", color: "#15803d", fontSize: 10 }} aria-hidden="true">1</span>
          <span className="pm-list__main"><b style={{ fontSize: 12.5 }}>Etapa 1 · valoración y estudios</b><span style={{ fontSize: 11 }}>Radiografía y estudio 3D</span></span>
          <span className="pm-list__link" style={{ color: "#15803d", fontSize: 10.5 }}>Lista</span>
        </li>
        <li className="pm-row--hi">
          <span className="pm-mini pm-mini--round" style={{ width: 22, height: 22, background: "#ede9fe", color: "#6d28d9", fontSize: 10 }} aria-hidden="true">2</span>
          <span className="pm-list__main"><b style={{ fontSize: 12.5 }}>Etapa 2 · colocación de aparato</b><span style={{ fontSize: 11 }}>Se agenda al aceptar</span></span>
          <span className="pm-list__link" style={{ color: "#6d28d9", fontSize: 10.5 }}>En curso</span>
        </li>
        <li>
          <span className="pm-mini pm-mini--round pm-mini--gray" style={{ width: 22, height: 22, fontSize: 10 }} aria-hidden="true">3</span>
          <span className="pm-list__main"><b style={{ fontSize: 12.5 }}>Etapa 3 · controles mensuales</b><span style={{ fontSize: 11 }}>Citas de seguimiento</span></span>
          <span className="pm-list__link" style={{ color: "#475569", fontSize: 10.5 }}>Después</span>
        </li>
      </ul>
      <div className="pm-win__foot">
        <span>Firmado en el portal · queda en su expediente</span>
        <span className="pm-act" style={{ background: "#2563eb" }}>Ver firma</span>
      </div>
    </figure>
  );
}

export function Portal3() {
  return (
    <figure className="pm-win">
      <div className="pm-win__head">
        <b>Mi estado de cuenta</b>
        <span className="pm-pill pm-pill--amber">1 pendiente</span>
      </div>
      <ul className="pm-list">
        <li>
          <span className="pm-list__main"><b style={{ fontSize: 12.5 }}>Limpieza dental</b><span style={{ fontSize: 11 }}>3 may · pagado en caja</span></span>
          <span className="pm-pill pm-pill--green">Pagado</span>
        </li>
        <li>
          <span className="pm-list__main"><b style={{ fontSize: 12.5 }}>Resina · diente 16</b><span style={{ fontSize: 11 }}>12 jun · pagado con tarjeta</span></span>
          <span className="pm-pill pm-pill--green">Pagado</span>
        </li>
        <li className="pm-row--warn">
          <span className="pm-list__main"><b style={{ fontSize: 12.5 }}>Ortodoncia · mensualidad de julio</b><span style={{ fontSize: 11 }}>Puedes pagarla en tu próxima visita</span></span>
          <span className="pm-pill pm-pill--amber">Pendiente</span>
        </li>
      </ul>
      <div className="pm-win__foot">
        <span>Los movimientos vienen de la caja de tu clínica</span>
        <span className="pm-act" style={{ background: "#15803d" }}>Solicitar factura</span>
      </div>
    </figure>
  );
}

export function Portal4() {
  return (
    <figure className="pm-win">
      <div className="pm-win__head">
        <b>¿Cómo estuvo tu visita?</b>
        <span className="pm-pill pm-pill--amber">Encuesta</span>
      </div>
      <div className="pm-win__body">
        <p style={{ fontSize: 12.5, color: "#475569", lineHeight: 1.55 }}>Hoy te atendió la Dra. Ríos · limpieza dental</p>
        <div style={{ marginTop: 12, display: "flex", gap: 6, fontSize: 20, color: "#d97706" }} aria-hidden="true">
          <span>★</span><span>★</span><span>★</span><span>★</span><span style={{ color: "#e2e8f0" }}>★</span>
        </div>
        <div style={{ marginTop: 13, border: "1px solid #e8edf4", borderRadius: 11, padding: 12, background: "#f8fafc" }}>
          <span className="pm-kicker">Comentario</span>
          <p style={{ marginTop: 6, fontSize: 12.5, lineHeight: 1.55, color: "#0f172a" }}>Me explicaron todo antes de empezar y salí a tiempo.</p>
        </div>
        <ul className="pm-chips pm-chips--round" style={{ marginTop: 13 }}>
          <li><span>Trato del equipo</span></li>
          <li><span>Tiempo de espera</span></li>
          <li><span>Explicación del tratamiento</span></li>
        </ul>
        <div style={{ marginTop: 14, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, justifyContent: "space-between" }}>
          <span style={{ fontSize: 11.5, color: "#475569" }}>Las respuestas llegan a tus reportes</span>
          <span className="pm-act" style={{ background: "#b45309" }}>Enviar</span>
        </div>
      </div>
    </figure>
  );
}
