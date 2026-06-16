// Conexiones IG/FB — placeholder de foundation (lo llena WS-MKT-T4).

export default function MarketingConnectionsPage() {
  return (
    <section
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        gap: 10,
        padding: "clamp(40px, 8vw, 96px) 24px",
        border: "1px dashed var(--border-soft)",
        borderRadius: 16,
        background: "var(--bg-elev)",
      }}
    >
      <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600, color: "var(--text-1)" }}>Conexiones</h2>
      <p style={{ margin: 0, fontSize: 14, color: "var(--text-3)", maxWidth: 440 }}>
        En construcción — vincula tus páginas de Facebook e Instagram para publicar desde aquí. (WS-MKT-T4)
      </p>
    </section>
  );
}
