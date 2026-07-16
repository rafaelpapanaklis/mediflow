import type { Metadata } from "next";
import { AdminLoginForm } from "./admin-login-form";

export const metadata: Metadata = { title: "Admin — DaleControl" };

export default function AdminLoginPage() {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "var(--bg)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
    >
      <div style={{ width: "100%", maxWidth: 380 }}>
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div
            style={{
              width: 52,
              height: 52,
              borderRadius: 16,
              background: "var(--brand-grad)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#fff",
              fontWeight: 800,
              fontSize: 22,
              margin: "0 auto 16px",
              boxShadow: "0 6px 16px -4px rgba(124,58,237,0.45)",
            }}
          >
            M
          </div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: "var(--text-1)", margin: 0, letterSpacing: "-0.01em" }}>
            Panel de Administración
          </h1>
          <p style={{ color: "var(--text-3)", fontSize: 13, margin: "6px 0 0" }}>Acceso restringido</p>
        </div>
        <AdminLoginForm />
      </div>
    </div>
  );
}
