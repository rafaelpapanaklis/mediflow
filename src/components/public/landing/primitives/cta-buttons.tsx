import Link from "next/link";

export function CTAButtons() {
  return (
    <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
      <Link
        href="/auth/register"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          padding: "14px 24px",
          borderRadius: 10,
          background: "linear-gradient(180deg, #8b5cf6, #7c3aed)",
          color: "#fff",
          fontSize: 15,
          fontWeight: 500,
          textDecoration: "none",
          boxShadow: "0 8px 24px rgba(124,58,237,0.35), inset 0 1px 0 rgba(255,255,255,0.15)",
        }}
      >
        Empieza gratis <span aria-hidden="true">→</span>
      </Link>
      <Link
        href="/clinicas"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          padding: "14px 24px",
          borderRadius: 10,
          background: "rgba(255,255,255,0.04)",
          border: "1px solid rgba(255,255,255,0.1)",
          color: "var(--ld-fg, #f5f5f7)",
          fontSize: 15,
          fontWeight: 500,
          textDecoration: "none",
        }}
      >
        Ver demo interactivo
      </Link>
    </div>
  );
}
