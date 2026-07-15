"use client";

import { useEffect, useState, type FormEvent } from "react";
import { ShieldCheck } from "lucide-react";
import { useT } from "@/i18n/i18n-provider";

// Solo aceptamos `next` interno a /dashboard (evita open-redirect). El layout y
// el middleware lo pasan como ?next=<ruta original>.
function safeNext(): string {
  if (typeof window === "undefined") return "/dashboard";
  const n = new URLSearchParams(window.location.search).get("next") ?? "";
  if (n.startsWith("/dashboard") && !n.startsWith("//")) return n;
  return "/dashboard";
}

export function TwoFactorChallenge() {
  const t = useT();
  const [code, setCode] = useState("");
  const [recovery, setRecovery] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [next, setNext] = useState("/dashboard");

  useEffect(() => {
    setNext(safeNext());
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (loading || !code.trim()) return;
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/2fa/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code.trim() }),
      });
      if (!res.ok) {
        setError(t("settings.client.tfa.genericError"));
        setLoading(false);
        return;
      }
      // Navegación dura: monta el layout completo una sola vez (mismo patrón
      // que el login).
      window.location.href = next;
    } catch {
      setError(t("settings.client.tfa.errorGeneric"));
      setLoading(false);
    }
  }

  return (
    <div className="w-full" style={{ maxWidth: 420, margin: "0 auto" }}>
      <div className="card p-6 space-y-5" style={{ boxShadow: "var(--shadow-2)" }}>
        <div className="flex flex-col items-center text-center gap-2">
          <div
            className="flex items-center justify-center rounded-full"
            style={{ width: 44, height: 44, background: "var(--brand-soft)", color: "var(--consult-active-accent)" }}
          >
            <ShieldCheck size={20} strokeWidth={1.75} />
          </div>
          <h1 style={{ fontSize: 15, fontWeight: 600, color: "var(--text-1)", margin: 0 }}>
            {t("settings.client.tfa.challengeTitle")}
          </h1>
          <p style={{ fontSize: 12.5, color: "var(--text-3)", margin: 0 }}>
            {recovery
              ? t("settings.client.tfa.recoveryInputLabel")
              : t("settings.client.tfa.challengeSubtitle")}
          </p>
        </div>

        <form onSubmit={submit} className="space-y-4">
          {error && (
            <div
              role="alert"
              style={{
                background: "var(--danger-soft)",
                border: "1px solid var(--danger-border-strong)",
                borderRadius: "var(--radius)",
                padding: "8px 12px",
                fontSize: 12,
                color: "var(--danger)",
              }}
            >
              {error}
            </div>
          )}

          <div className="field-new">
            <label className="field-new__label">
              {recovery
                ? t("settings.client.tfa.recoveryInputLabel")
                : t("settings.client.tfa.codeLabel")}
            </label>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              inputMode={recovery ? "text" : "numeric"}
              autoComplete="one-time-code"
              autoFocus
              maxLength={recovery ? 20 : 6}
              placeholder={
                recovery
                  ? t("settings.client.tfa.recoveryInputPlaceholder")
                  : t("settings.client.tfa.codePlaceholder")
              }
              className="input-new mono"
              style={{
                height: 52,
                fontSize: 22,
                textAlign: "center",
                letterSpacing: "0.3em",
                fontVariantNumeric: "tabular-nums",
              }}
            />
          </div>

          <button
            type="submit"
            className="btn-new btn-new--primary"
            style={{ width: "100%", height: 40, justifyContent: "center" }}
            disabled={loading || !code.trim()}
          >
            {loading ? t("settings.client.tfa.verifying") : t("settings.client.tfa.challengeSubmit")}
          </button>

          <button
            type="button"
            onClick={() => {
              setRecovery((v) => !v);
              setCode("");
              setError(null);
            }}
            className="btn-new btn-new--ghost"
            style={{
              width: "100%",
              height: 40,
              justifyContent: "center",
              fontSize: 12,
              fontWeight: 500,
              color: "var(--consult-active-accent)",
            }}
          >
            {recovery ? t("settings.client.tfa.useApp") : t("settings.client.tfa.useRecovery")}
          </button>
        </form>
      </div>
    </div>
  );
}
