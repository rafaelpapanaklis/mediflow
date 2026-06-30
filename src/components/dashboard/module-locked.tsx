export function ModuleLocked({ name }: { name: string }) {
  return (
    <div style={{ padding: 40, textAlign: "center", maxWidth: 440, margin: "60px auto" }}>
      <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>{name} no está en tu plan</h2>
      <p style={{ fontSize: 14, color: "var(--text-3, #64748b)", marginBottom: 18, lineHeight: 1.5 }}>
        Mejora tu plan para desbloquear esta función.
      </p>
      <a href="/dashboard/marketplace" style={{ display: "inline-block", padding: "10px 20px", background: "var(--brand, #7c3aed)", color: "#fff", borderRadius: 8, textDecoration: "none", fontWeight: 600, fontSize: 14 }}>
        Ver planes
      </a>
    </div>
  );
}
