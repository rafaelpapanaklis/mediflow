// Mockups de /facturacion-dental-cfdi — réplica de 5-Facturacion.dc.html.
// El aviso "DaleControl prepara y organiza la factura; el timbrado lo realizas
// con tu proveedor" es parte del diseño aprobado: no quitarlo.

export function FacturacionHero() {
  return (
    <div className="pm-scene pm-t-indigo">
      <div className="pm-scene__glow" aria-hidden="true" />

      <div className="pm-scene__side" aria-hidden="true">
        <div className="pm-mh">
          <b>Datos fiscales</b>
          <span className="pm-tag pm-pill--indigo">Guardados</span>
        </div>
        <div className="pm-mb">
          <div className="pm-mkv"><span>RFC</span><b style={{ fontSize: 9 }}>XAXX010101000</b></div>
          <div className="pm-mkv"><span>Razón social</span><b style={{ fontSize: 9 }}>Ana Torres</b></div>
          <div className="pm-mkv"><span>Régimen</span><b style={{ fontSize: 9 }}>Sueldos</b></div>
          <div className="pm-mkv"><span>Uso CFDI</span><b style={{ fontSize: 9 }}>Gastos médicos</b></div>
          <div className="pm-mkv"><span>Correo</span><b style={{ fontSize: 9 }}>ana@correo.com</b></div>
        </div>
      </div>

      <figure className="pm-scene__main">
        <div className="pm-mh" style={{ background: "linear-gradient(90deg,#eef2ff,#ffffff)", padding: "10px 12px" }}>
          <b style={{ fontSize: 11 }}>Factura · borrador</b>
          <span className="pm-tag pm-pill--indigo">Por preparar</span>
        </div>
        <div style={{ padding: 11 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
            <span style={{ minWidth: 0 }}>
              <span className="pm-kicker" style={{ fontSize: 8, letterSpacing: ".09em" }}>Emisor</span>
              <span style={{ display: "block", fontSize: 9.5, fontWeight: 700, color: "#0f172a" }}>Clínica Dental</span>
            </span>
            <span style={{ minWidth: 0, textAlign: "right" }}>
              <span className="pm-kicker" style={{ fontSize: 8, letterSpacing: ".09em" }}>Receptor</span>
              <span style={{ display: "block", fontSize: 9.5, fontWeight: 700, color: "#0f172a" }}>Ana Torres</span>
            </span>
          </div>
          <div style={{ marginTop: 9, border: "1px solid #e8edf4", borderRadius: 9, overflow: "hidden" }}>
            <div style={{ display: "flex", gap: 6, padding: "6px 8px", background: "#f8fafc", borderBottom: "1px solid #eef2f7" }}>
              <span style={{ flex: "1 1 auto", fontSize: 8, fontWeight: 700, color: "#475569" }}>Concepto</span>
              <span style={{ fontSize: 8, fontWeight: 700, color: "#475569" }}>Importe</span>
            </div>
            <div style={{ display: "flex", gap: 6, padding: "7px 8px", borderBottom: "1px solid #f1f5f9" }}>
              <span style={{ flex: "1 1 auto", fontSize: 9, color: "#0f172a" }}>Limpieza dental</span>
              <span style={{ fontSize: 9, fontWeight: 700, color: "#0f172a" }}>$850</span>
            </div>
            <div style={{ display: "flex", gap: 6, padding: "7px 8px" }}>
              <span style={{ flex: "1 1 auto", fontSize: 9, color: "#0f172a" }}>Resina · diente 16</span>
              <span style={{ fontSize: 9, fontWeight: 700, color: "#0f172a" }}>$1,450</span>
            </div>
          </div>
          <div style={{ marginTop: 8, display: "flex", justifyContent: "space-between", gap: 8 }}>
            <span style={{ fontSize: 9, color: "#475569" }}>Forma de pago</span>
            <span style={{ fontSize: 9, fontWeight: 700, color: "#0f172a" }}>Tarjeta · caja</span>
          </div>
          <div style={{ marginTop: 9, display: "flex", alignItems: "center", gap: 7, background: "#eef2ff", border: "1px solid #c7d2fe", borderRadius: 8, padding: "7px 9px" }}>
            <span aria-hidden="true" style={{ width: 16, height: 16, borderRadius: "50%", background: "#c7d2fe", color: "#3730a3", fontSize: 8, fontWeight: 800, display: "grid", placeItems: "center", flex: "0 0 auto" }}>i</span>
            <span style={{ fontSize: 8.5, color: "#3730a3", lineHeight: 1.35 }}>Lista para tu proceso de timbrado</span>
          </div>
        </div>
      </figure>

      <div className="pm-scene__chip" aria-hidden="true">
        <i>✓</i>
        <span>
          <b>Solicitud del paciente</b>
          <span>Llegó desde su portal</span>
        </span>
      </div>
    </div>
  );
}

export function Facturacion1() {
  return (
    <figure className="pm-win">
      <div className="pm-win__bar">
        <span className="pm-win__lights" aria-hidden="true"><i /><i /><i /></span>
        <span className="pm-win__url">app.dalecontrol.com/facturacion</span>
      </div>
      <div className="pm-win__body">
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, justifyContent: "space-between" }}>
          <span style={{ fontSize: 13.5, fontWeight: 700, color: "#0f172a" }}>Factura de Ana Torres</span>
          <span className="pm-pill pm-pill--indigo">Preparada</span>
        </div>
        <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,150px),1fr))", gap: 10 }}>
          <div style={{ border: "1px solid #e8edf4", borderRadius: 11, padding: 11 }}>
            <span className="pm-kicker" style={{ fontSize: 10, letterSpacing: ".09em" }}>Emisor</span>
            <span style={{ display: "block", marginTop: 4, fontSize: 12.5, fontWeight: 700, color: "#0f172a" }}>Clínica Dental</span>
            <span style={{ display: "block", fontSize: 11, color: "#475569" }}>Datos de tu clínica</span>
          </div>
          <div style={{ border: "1px solid #e8edf4", borderRadius: 11, padding: 11 }}>
            <span className="pm-kicker" style={{ fontSize: 10, letterSpacing: ".09em" }}>Receptor</span>
            <span style={{ display: "block", marginTop: 4, fontSize: 12.5, fontWeight: 700, color: "#0f172a" }}>Ana Torres</span>
            <span style={{ display: "block", fontSize: 11, color: "#475569" }}>RFC guardado en su ficha</span>
          </div>
        </div>
        <div style={{ marginTop: 12, border: "1px solid #e8edf4", borderRadius: 11, overflow: "hidden" }}>
          <div style={{ display: "flex", gap: 10, padding: "9px 12px", background: "#f8fafc", borderBottom: "1px solid #eef2f7" }}>
            <span style={{ flex: "1 1 auto", fontSize: 10.5, fontWeight: 700, color: "#475569" }}>Concepto</span>
            <span style={{ fontSize: 10.5, fontWeight: 700, color: "#475569" }}>Importe</span>
          </div>
          <div style={{ display: "flex", gap: 10, padding: "10px 12px", borderBottom: "1px solid #f1f5f9" }}>
            <span style={{ flex: "1 1 auto", minWidth: 0 }}>
              <span style={{ display: "block", fontSize: 12.5, color: "#0f172a" }}>Limpieza dental</span>
              <span style={{ display: "block", fontSize: 11, color: "#475569" }}>Cobrada el 3 may</span>
            </span>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: "#0f172a" }}>$850</span>
          </div>
          <div style={{ display: "flex", gap: 10, padding: "10px 12px" }}>
            <span style={{ flex: "1 1 auto", minWidth: 0 }}>
              <span style={{ display: "block", fontSize: 12.5, color: "#0f172a" }}>Resina · diente 16</span>
              <span style={{ display: "block", fontSize: 11, color: "#475569" }}>Cobrada el 12 jun</span>
            </span>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: "#0f172a" }}>$1,450</span>
          </div>
        </div>
        <div className="pm-chips" style={{ marginTop: 12 }}>
          <span>Uso CFDI · gastos médicos</span>
          <span>Forma de pago · tarjeta</span>
          <span>Régimen · sueldos</span>
        </div>
        <div className="pm-note pm-note--tone" style={{ marginTop: 12 }}>
          <i>i</i>
          <span>DaleControl prepara y organiza la factura; el timbrado lo realizas con tu proveedor.</span>
        </div>
        <div style={{ marginTop: 14, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, justifyContent: "space-between" }}>
          <span style={{ fontSize: 11.5, color: "#475569" }}>Queda guardada en el expediente</span>
          <span className="pm-act" style={{ background: "#4338ca" }}>Descargar detalle</span>
        </div>
      </div>
    </figure>
  );
}

export function Facturacion2() {
  return (
    <figure className="pm-win">
      <div className="pm-win__head">
        <b>Datos fiscales · Ana Torres</b>
        <span className="pm-pill pm-pill--green">Revisados</span>
      </div>
      <ul className="pm-list">
        <li><span className="pm-boxes__k">RFC</span><span className="pm-boxes__v">XAXX010101000</span></li>
        <li><span className="pm-boxes__k">Razón social</span><span className="pm-boxes__v">Ana Torres</span></li>
        <li><span className="pm-boxes__k">Régimen fiscal</span><span className="pm-boxes__v">Sueldos y salarios</span></li>
        <li><span className="pm-boxes__k">Uso de CFDI</span><span className="pm-boxes__v">Gastos médicos</span></li>
        <li><span className="pm-boxes__k">Correo para enviarla</span><span className="pm-boxes__v">ana@correo.com</span></li>
      </ul>
      <div style={{ padding: "12px 16px", background: "#f8fafc", borderTop: "1px solid #eef2f7", display: "flex", alignItems: "center", gap: 9 }}>
        <span className="pm-note__i" style={{ background: "#dbeafe", color: "#1d4ed8" }} aria-hidden="true">i</span>
        <span style={{ fontSize: 11.5, color: "#475569" }}>El paciente puede actualizarlos desde su portal</span>
      </div>
    </figure>
  );
}

export function Facturacion3() {
  return (
    <figure className="pm-win">
      <div className="pm-win__head">
        <b>Solicitudes de factura</b>
        <span className="pm-pill pm-pill--amber">2 pendientes</span>
      </div>
      <ul className="pm-list">
        <li className="pm-row--warn">
          <span className="pm-mini pm-mini--round" style={{ background: "#fef3c7", color: "#b45309" }} aria-hidden="true">AT</span>
          <span className="pm-list__main"><b>Ana Torres</b><span>Pago del 12 jun · tarjeta</span></span>
          <span className="pm-pill pm-pill--amber">Pendiente</span>
        </li>
        <li className="pm-row--warn">
          <span className="pm-mini pm-mini--round" style={{ background: "#fef3c7", color: "#b45309" }} aria-hidden="true">RV</span>
          <span className="pm-list__main"><b>R. Vega</b><span>Pago del 2 jul · efectivo</span></span>
          <span className="pm-pill pm-pill--amber">Pendiente</span>
        </li>
        <li>
          <span className="pm-mini pm-mini--round" style={{ background: "#e0e7ff", color: "#4338ca" }} aria-hidden="true">LP</span>
          <span className="pm-list__main"><b>L. Paredes</b><span>Pago del 1 jul · transferencia</span></span>
          <span className="pm-pill pm-pill--indigo">Preparada</span>
        </li>
        <li>
          <span className="pm-mini pm-mini--round" style={{ background: "#dcfce7", color: "#15803d" }} aria-hidden="true">JM</span>
          <span className="pm-list__main"><b>J. Medina</b><span>Pago del 28 jun · tarjeta</span></span>
          <span className="pm-pill pm-pill--green">Entregada</span>
        </li>
      </ul>
    </figure>
  );
}

export function Facturacion4() {
  return (
    <figure className="pm-win">
      <div className="pm-win__head">
        <b>Historial · julio</b>
        <span className="pm-pill pm-pill--gray">Filtrar periodo</span>
      </div>
      <div className="pm-win__body">
        <div className="pm-chips pm-chips--round">
          <span className="is-on">Julio</span>
          <span>Junio</span>
          <span>Mayo</span>
          <span>Trimestre</span>
        </div>
        <ul className="pm-boxes" style={{ marginTop: 12 }}>
          <li>
            <span className="pm-list__main"><b style={{ fontSize: 12.5 }}>L. Paredes · ortodoncia</b><span style={{ fontSize: 11 }}>1 jul · transferencia</span></span>
            <span className="pm-pill pm-pill--indigo">Preparada</span>
          </li>
          <li>
            <span className="pm-list__main"><b style={{ fontSize: 12.5 }}>J. Medina · endodoncia</b><span style={{ fontSize: 11 }}>28 jun · tarjeta</span></span>
            <span className="pm-pill pm-pill--green">Entregada</span>
          </li>
          <li>
            <span className="pm-list__main"><b style={{ fontSize: 12.5 }}>Ana Torres · resina</b><span style={{ fontSize: 11 }}>12 jun · tarjeta</span></span>
            <span className="pm-pill pm-pill--amber">Pendiente</span>
          </li>
        </ul>
        <div className="pm-note" style={{ marginTop: 13 }}>
          <i style={{ background: "#fef3c7", color: "#b45309" }}>i</i>
          <span>El estado lo actualizas tú conforme avanza tu proceso</span>
        </div>
      </div>
    </figure>
  );
}
