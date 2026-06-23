"use client";

import { useEffect, useState, type FormEvent } from "react";
import { ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
    <div className="w-full max-w-sm">
      <div className="bg-card border border-border rounded-2xl p-6 shadow-card space-y-5">
        <div className="flex flex-col items-center text-center gap-2">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-600/10 text-brand-600">
            <ShieldCheck className="h-6 w-6" />
          </div>
          <h1 className="text-lg font-bold">{t("settings.client.tfa.challengeTitle")}</h1>
          <p className="text-sm text-muted-foreground">
            {recovery
              ? t("settings.client.tfa.recoveryInputLabel")
              : t("settings.client.tfa.challengeSubtitle")}
          </p>
        </div>

        <form onSubmit={submit} className="space-y-4">
          {error && (
            <div
              role="alert"
              className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-600 dark:text-rose-400"
            >
              {error}
            </div>
          )}

          <div className="space-y-1.5">
            <Label>
              {recovery
                ? t("settings.client.tfa.recoveryInputLabel")
                : t("settings.client.tfa.codeLabel")}
            </Label>
            <Input
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
              className="text-center text-lg tracking-[0.3em]"
            />
          </div>

          <Button type="submit" className="w-full" disabled={loading || !code.trim()}>
            {loading ? t("settings.client.tfa.verifying") : t("settings.client.tfa.challengeSubmit")}
          </Button>

          <button
            type="button"
            onClick={() => {
              setRecovery((v) => !v);
              setCode("");
              setError(null);
            }}
            className="block w-full text-center text-xs font-medium text-brand-600 hover:underline"
          >
            {recovery ? t("settings.client.tfa.useApp") : t("settings.client.tfa.useRecovery")}
          </button>
        </form>
      </div>
    </div>
  );
}
