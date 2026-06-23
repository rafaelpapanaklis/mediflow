"use client";

import { useCallback, useEffect, useState } from "react";
import { ShieldCheck, Copy, Check, Download, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useT } from "@/i18n/i18n-provider";
import toast from "react-hot-toast";

interface Props {
  // Enrolamiento obligado por la clínica (clinic.require2fa): arranca solo y al
  // terminar lleva al panel. En ajustes (opcional) se controla con un botón.
  forced?: boolean;
  // Ajustes: refrescar el estado de la card al activar.
  onEnabled?: () => void;
}

export function TwoFactorSetup({ forced = false, onEnabled }: Props) {
  const t = useT();
  const [step, setStep] = useState<"start" | "scan" | "codes">(forced ? "scan" : "start");
  const [qr, setQr] = useState<string | null>(null);
  const [secret, setSecret] = useState("");
  const [code, setCode] = useState("");
  const [codes, setCodes] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const begin = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/2fa/setup", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error ?? t("settings.client.tfa.errorGeneric"));
        return;
      }
      setQr(data.qrDataUrl ?? null);
      setSecret(data.secret ?? "");
      setStep("scan");
    } catch {
      setError(t("settings.client.tfa.errorGeneric"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  // Enrolamiento forzado: arranca al montar (una sola vez).
  useEffect(() => {
    if (forced) begin();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forced]);

  async function confirm() {
    if (loading || !code.trim()) return;
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/2fa/enable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(t("settings.client.tfa.genericError"));
        return;
      }
      setCodes(data.recoveryCodes ?? []);
      setStep("codes");
    } catch {
      setError(t("settings.client.tfa.errorGeneric"));
    } finally {
      setLoading(false);
    }
  }

  function copyCodes() {
    navigator.clipboard
      ?.writeText(codes.join("\n"))
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {});
  }

  function downloadCodes() {
    const blob = new Blob(
      [`DaleControl — ${t("settings.client.tfa.recoveryTitle")}\n\n${codes.join("\n")}\n`],
      { type: "text/plain" },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "dalecontrol-2fa-recovery-codes.txt";
    a.click();
    URL.revokeObjectURL(url);
  }

  function finish() {
    toast.success(t("settings.client.tfa.enabledToast"));
    if (forced) {
      window.location.href = "/dashboard";
      return;
    }
    onEnabled?.();
  }

  const errorBox = error ? (
    <div
      role="alert"
      className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-600 dark:text-rose-400"
    >
      {error}
    </div>
  ) : null;

  // ── Paso: códigos de recuperación ───────────────────────────────
  if (step === "codes") {
    return (
      <div className="bg-card border border-border rounded-2xl p-6 shadow-card space-y-4">
        <div className="flex items-center gap-2">
          <KeyRound className="h-5 w-5 text-brand-600" />
          <h2 className="text-base font-bold">{t("settings.client.tfa.recoveryTitle")}</h2>
        </div>
        <p className="text-sm text-muted-foreground">{t("settings.client.tfa.recoveryHint")}</p>
        <ul className="grid grid-cols-2 gap-2 rounded-xl border border-border bg-muted/30 p-4 font-mono text-sm">
          {codes.map((c) => (
            <li key={c} className="text-center tracking-wider">
              {c}
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={copyCodes}>
            {copied ? <Check className="mr-1.5 h-4 w-4" /> : <Copy className="mr-1.5 h-4 w-4" />}
            {copied ? t("settings.client.tfa.recoveryCopied") : t("settings.client.tfa.recoveryCopy")}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={downloadCodes}>
            <Download className="mr-1.5 h-4 w-4" />
            {t("settings.client.tfa.recoveryDownload")}
          </Button>
        </div>
        <div className="flex justify-end pt-1">
          <Button type="button" onClick={finish}>
            {t("settings.client.tfa.recoveryDone")}
          </Button>
        </div>
      </div>
    );
  }

  // ── Paso: escanear QR + verificar ───────────────────────────────
  if (step === "scan") {
    return (
      <div className="bg-card border border-border rounded-2xl p-6 shadow-card space-y-4">
        {forced && (
          <div className="space-y-1 border-b border-border/60 pb-3">
            <h2 className="text-base font-bold">{t("settings.client.tfa.forcedTitle")}</h2>
            <p className="text-sm text-muted-foreground">{t("settings.client.tfa.forcedSubtitle")}</p>
          </div>
        )}
        <div className="space-y-1">
          <h3 className="text-sm font-semibold">{t("settings.client.tfa.scanTitle")}</h3>
          <p className="text-xs text-muted-foreground">{t("settings.client.tfa.scanHint")}</p>
        </div>

        <div className="flex flex-col items-center gap-3">
          {qr ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={qr}
              alt="QR 2FA"
              width={200}
              height={200}
              className="rounded-xl border border-border bg-white p-2"
            />
          ) : (
            <div className="h-[200px] w-[200px] animate-pulse rounded-xl border border-border bg-muted/30" />
          )}
          {secret && (
            <div className="w-full text-center">
              <p className="text-xs text-muted-foreground">{t("settings.client.tfa.manualLabel")}</p>
              <code className="mt-1 inline-block break-all rounded-md bg-muted px-2 py-1 font-mono text-xs">
                {secret}
              </code>
            </div>
          )}
        </div>

        {errorBox}

        <div className="space-y-1.5">
          <Label>{t("settings.client.tfa.codeLabel")}</Label>
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            placeholder={t("settings.client.tfa.codePlaceholder")}
            className="text-center text-lg tracking-[0.3em]"
          />
        </div>

        <div className="flex flex-wrap justify-end gap-2 pt-1">
          {!forced && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setStep("start");
                setCode("");
                setError(null);
              }}
            >
              {t("settings.client.tfa.cancel")}
            </Button>
          )}
          <Button type="button" onClick={confirm} disabled={loading || !code.trim()}>
            {loading ? t("settings.client.tfa.verifying") : t("settings.client.tfa.verifyBtn")}
          </Button>
        </div>
      </div>
    );
  }

  // ── Paso: inicio (solo en ajustes) ──────────────────────────────
  return (
    <div className="space-y-3">
      {errorBox}
      <Button type="button" onClick={begin} disabled={loading}>
        <ShieldCheck className="mr-1.5 h-4 w-4" />
        {loading ? t("settings.client.tfa.verifying") : t("settings.client.tfa.setupBtn")}
      </Button>
    </div>
  );
}
