"use client";

import { useState } from "react";
import { Lock } from "lucide-react";

export function PasswordGate({ slug, clinicName }: { slug: string; clinicName: string }) {
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!password.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/live/${slug}/unlock`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        if (res.status === 401) setError("Contraseña incorrecta");
        else setError("No se pudo desbloquear");
        return;
      }
      window.location.reload();
    } catch {
      setError("Error de red");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: 24,
      }}
    >
      <form
        onSubmit={submit}
        style={{
          width: "100%",
          maxWidth: 380,
          background: "#fff",
          color: "#1A2540",
          borderRadius: 16,
          padding: 28,
          boxShadow: "0 24px 60px -16px rgba(0,0,0,0.45)",
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: 14,
            background: "linear-gradient(135deg, #4A90E2, #2A68C0)",
            display: "grid",
            placeItems: "center",
            color: "#fff",
            margin: "0 auto",
            boxShadow: "0 8px 24px -10px rgba(74,144,226,0.5)",
          }}
        >
          <Lock size={26} aria-hidden />
        </div>
        <h1 style={{ fontSize: 19, fontWeight: 700, margin: 0, textAlign: "center" }}>
          {clinicName}
        </h1>
        <p style={{ fontSize: 13, color: "#6B7A99", textAlign: "center", margin: 0, lineHeight: 1.5 }}>
          Esta vista está protegida con contraseña. Ingresa la contraseña que tu clínica configuró.
        </p>
        <input
          type="password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Contraseña"
          autoComplete="off"
          style={{
            width: "100%",
            padding: "11px 14px",
            fontSize: 14,
            borderRadius: 10,
            border: "1px solid #E2ECF4",
            fontFamily: "inherit",
            outline: "none",
          }}
        />
        {error && (
          <div
            style={{
              fontSize: 12,
              color: "#EF4444",
              background: "rgba(239,68,68,0.08)",
              border: "1px solid rgba(239,68,68,0.3)",
              borderRadius: 8,
              padding: "8px 10px",
              textAlign: "center",
            }}
          >
            {error}
          </div>
        )}
        <button
          type="submit"
          disabled={loading || !password.trim()}
          style={{
            width: "100%",
            padding: "11px 14px",
            fontSize: 14,
            fontWeight: 700,
            background: "#4A90E2",
            color: "#fff",
            border: "none",
            borderRadius: 10,
            cursor: loading ? "wait" : "pointer",
            fontFamily: "inherit",
            opacity: loading || !password.trim() ? 0.6 : 1,
            boxShadow: "0 6px 18px -6px rgba(74,144,226,0.5)",
          }}
        >
          {loading ? "Desbloqueando…" : "Entrar"}
        </button>
        <p style={{ fontSize: 10, color: "#9AAAC0", textAlign: "center", margin: 0 }}>
          Tu sesión queda activa por 12 horas en este dispositivo.
        </p>
      </form>
    </div>
  );
}
