"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Shield, Eye, EyeOff } from "lucide-react";

export function AdminLoginForm() {
  const router = useRouter();
  const [step, setStep]         = useState<"password" | "totp">("password");
  const [password, setPassword] = useState("");
  const [totp, setTotp]         = useState("");
  const [showPwd, setShowPwd]   = useState(false);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState("");

  async function handlePassword(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/admin/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ step: "password", password }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error); return; }
      setStep("totp");
    } finally {
      setLoading(false);
    }
  }

  async function handleTotp(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/admin/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ step: "totp", password, totp }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        setError(data.error ?? `Error ${res.status}`);
        return;
      }
      // Hard redirect so the browser sends the new cookie on the server request
      window.location.href = "/admin";
      return;
    } catch (err: any) {
      setError(err.message ?? "Error de conexión");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card" style={{ padding: 24 }}>
      {error && (
        <div
          style={{
            background: "var(--danger-soft)",
            border: "1px solid color-mix(in oklab, var(--danger) 30%, transparent)",
            color: "var(--danger)",
            fontSize: 13,
            borderRadius: 10,
            padding: "10px 14px",
            marginBottom: 16,
          }}
        >
          {error}
        </div>
      )}

      {step === "password" ? (
        <form onSubmit={handlePassword} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <label style={{ fontSize: 13, fontWeight: 600, color: "var(--text-2)", display: "block", marginBottom: 6 }}>
              Contraseña maestra
            </label>
            <div style={{ position: "relative" }}>
              <input
                type={showPwd ? "text" : "password"}
                className="input-new"
                style={{ height: 44, paddingRight: 42 }}
                placeholder="••••••••••••"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
              />
              <button
                type="button"
                onClick={() => setShowPwd(!showPwd)}
                aria-label={showPwd ? "Ocultar contraseña" : "Ver contraseña"}
                style={{
                  position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)",
                  background: "transparent", border: "none", cursor: "pointer",
                  color: "var(--text-3)", padding: 8, display: "grid", placeItems: "center", borderRadius: 8,
                }}
              >
                {showPwd ? <EyeOff size={16} strokeWidth={1.75} /> : <Eye size={16} strokeWidth={1.75} />}
              </button>
            </div>
          </div>
          <button
            type="submit"
            disabled={loading || !password}
            className="btn-new btn-new--primary"
            style={{ width: "100%", height: 44, justifyContent: "center" }}
          >
            {loading ? "Verificando…" : "Continuar →"}
          </button>
        </form>
      ) : (
        <form onSubmit={handleTotp} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--success)", fontSize: 13, fontWeight: 600 }}>
            <Shield size={16} strokeWidth={1.75} />
            Contraseña verificada. Ingresa el código 2FA.
          </div>
          <div>
            <label style={{ fontSize: 13, fontWeight: 600, color: "var(--text-2)", display: "block", marginBottom: 6 }}>
              Código de Google Authenticator
            </label>
            <input
              type="text"
              inputMode="numeric"
              maxLength={6}
              className="input-new mono"
              style={{ height: 52, fontSize: 22, textAlign: "center", letterSpacing: "0.5em", fontWeight: 600 }}
              placeholder="000000"
              value={totp}
              onChange={e => setTotp(e.target.value.replace(/\D/g, "").slice(0, 6))}
              required
              autoFocus
            />
            <p style={{ fontSize: 11, color: "var(--text-3)", margin: "6px 0 0", textAlign: "center" }}>
              Abre Google Authenticator y escribe el código de 6 dígitos
            </p>
          </div>
          <button
            type="submit"
            disabled={loading || totp.length !== 6}
            className="btn-new btn-new--primary"
            style={{ width: "100%", height: 44, justifyContent: "center" }}
          >
            {loading ? "Verificando…" : "Acceder al panel"}
          </button>
          <button
            type="button"
            onClick={() => { setStep("password"); setTotp(""); setError(""); }}
            className="btn-new btn-new--ghost"
            style={{ width: "100%", justifyContent: "center" }}
          >
            ← Volver
          </button>
        </form>
      )}
    </div>
  );
}
