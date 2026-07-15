// Skeleton de la pagina de Equipo (sistema Variante A). Usa .skel-new y las
// clases de contenedor del sistema (.kpi/.card) para reflejar el layout real
// mientras carga: header, fila de KPIs, filtro segmentado y grid de tarjetas.
export default function Loading() {
  return (
    <div style={{ padding: "clamp(14px, 1.6vw, 28px)", maxWidth: 1400, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 22, gap: 24, flexWrap: "wrap" }}>
        <div>
          <span className="skel-new" style={{ width: 168, height: 24, borderRadius: "var(--radius-sm)" }} />
          <span className="skel-new" style={{ width: 220, height: 13, borderRadius: "var(--radius-sm)", marginTop: 10 }} />
        </div>
        <span className="skel-new" style={{ width: 152, height: 40, borderRadius: "var(--radius)" }} />
      </div>

      {/* KPIs */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 14, marginBottom: 20 }}>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="kpi">
            <span className="skel-new" style={{ width: "58%", height: 12, borderRadius: "var(--radius-sm)" }} />
            <span className="skel-new" style={{ width: 44, height: 28, borderRadius: "var(--radius-sm)", marginTop: 14 }} />
          </div>
        ))}
      </div>

      {/* Filtro segmentado */}
      <div style={{ marginBottom: 18 }}>
        <span className="skel-new" style={{ width: 244, height: 36, borderRadius: "var(--radius)" }} />
      </div>

      {/* Grid de tarjetas de miembro */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 14 }}>
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="card" style={{ padding: 20 }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
              <span className="skel-new" style={{ width: 64, height: 64, borderRadius: "50%" }} />
              <span className="skel-new" style={{ width: 140, height: 15, borderRadius: "var(--radius-sm)", marginTop: 4 }} />
              <span className="skel-new" style={{ width: 184, height: 12, borderRadius: "var(--radius-sm)" }} />
              <span className="skel-new" style={{ width: 88, height: 20, borderRadius: "var(--radius)", marginTop: 6 }} />
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 10, width: "100%", marginTop: 16, paddingTop: 16, borderTop: "1px solid var(--border-soft)" }}>
                <span className="skel-new" style={{ height: 30, borderRadius: "var(--radius-sm)" }} />
                <span className="skel-new" style={{ height: 30, borderRadius: "var(--radius-sm)" }} />
              </div>
              <div style={{ display: "flex", gap: 6, marginTop: 14 }}>
                <span className="skel-new" style={{ width: 74, height: 32, borderRadius: "var(--radius-sm)" }} />
                <span className="skel-new" style={{ width: 96, height: 32, borderRadius: "var(--radius-sm)" }} />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
