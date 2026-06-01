export const dynamic = "force-dynamic";

export default function LabInicioPage() {
  return (
    <div
      style={{
        padding: "clamp(16px, 3vw, 32px)",
        color: "var(--text-2)",
        fontSize: 14,
        fontFamily: "var(--font-sans, system-ui, sans-serif)",
      }}
    >
      <h1
        style={{
          fontSize: 22,
          fontWeight: 600,
          letterSpacing: "-0.01em",
          color: "var(--text-1)",
          margin: 0,
          marginBottom: 8,
        }}
      >
        Inicio
      </h1>
      <p style={{ margin: 0 }}>Próximamente: dashboard del laboratorio.</p>
    </div>
  );
}
