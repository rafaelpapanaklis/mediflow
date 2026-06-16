// Biblioteca / Plantillas — placeholder de foundation (lo llena WS-MKT-T6).

export default function MarketingLibraryPage() {
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
      <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600, color: "var(--text-1)" }}>Biblioteca</h2>
      <p style={{ margin: 0, fontSize: 14, color: "var(--text-3)", maxWidth: 440 }}>
        En construcción — plantillas de captions, ideas y campañas reutilizables. (WS-MKT-T6)
      </p>
    </section>
  );
}
