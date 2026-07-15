"use client";

import { useCallback, useEffect, useState } from "react";
import { ShieldCheck, Copy, Check, Download, KeyRound } from "lucide-react";
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
  ) : null;

  // ── Paso: códigos de recuperación ───────────────────────────────
  if (step === "codes") {
    return (
      <div className="card p-6 space-y-4">
        <div className="form-section__title">
          <KeyRound size={16} strokeWidth={1.75} />
          {t("settings.client.tfa.recoveryTitle")}
          <span className="form-section__rule" />
        </div>
        <p style={{ fontSize: 12.5, color: "var(--text-3)", margin: 0 }}>
          {t("settings.client.tfa.recoveryHint")}
        </p>
        <ul
          className="mono grid grid-cols-2 gap-2"
          style={{
            background: "var(--bg-elev-2)",
            border: "1px solid var(--border-soft)",
            borderRadius: "var(--radius-lg)",
            padding: 16,
            fontSize: 12,
            color: "var(--text-1)",
          }}
        >
          {codes.map((c) => (
            <li key={c} className="text-center tracking-wider">
              {c}
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-new btn-new--secondary btn-new--sm" onClick={copyCodes}>
            {copied ? <Check size={16} strokeWidth={1.75} /> : <Copy size={16} strokeWidth={1.75} />}
            {copied ? t("settings.client.tfa.recoveryCopied") : t("settings.client.tfa.recoveryCopy")}
          </button>
          <button type="button" className="btn-new btn-new--secondary btn-new--sm" onClick={downloadCodes}>
            <Download size={16} strokeWidth={1.75} />
            {t("settings.client.tfa.recoveryDownload")}
          </button>
        </div>
        <div className="flex justify-end pt-1">
          <button type="button" className="btn-new btn-new--primary" style={{ height: 40 }} onClick={finish}>
            {t("settings.client.tfa.recoveryDone")}
          </button>
        </div>
      </div>
    );
  }

  // ── Paso: escanear QR + verificar ───────────────────────────────
  if (step === "scan") {
    return (
      <div className="card p-6 space-y-4">
        {forced && (
          <div
            className="space-y-1"
            style={{ borderBottom: "1px solid var(--border-soft)", paddingBottom: 12 }}
          >
            <h2 style={{ fontSize: 15, fontWeight: 600, color: "var(--text-1)", margin: 0 }}>
              {t("settings.client.tfa.forcedTitle")}
            </h2>
            <p style={{ fontSize: 12.5, color: "var(--text-3)", margin: 0 }}>
              {t("settings.client.tfa.forcedSubtitle")}
            </p>
          </div>
        )}
        <div>
          <div className="form-section__title">
            {t("settings.client.tfa.scanTitle")}
            <span className="form-section__rule" />
          </div>
          <p style={{ fontSize: 12, color: "var(--text-3)", margin: 0 }}>
            {t("settings.client.tfa.scanHint")}
          </p>
        </div>

        <div className="flex flex-col items-center gap-3">
          <div
            style={{
              background: "var(--bg-elev-2)",
              borderRadius: "var(--radius-lg)",
              padding: 16,
            }}
          >
            {qr ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={qr}
                alt="QR 2FA"
                width={200}
                height={200}
                className="block bg-white p-2"
                style={{ borderRadius: "var(--radius)" }}
              />
            ) : (
              <div
                className="skel-new"
                style={{ width: 200, height: 200, borderRadius: "var(--radius)" }}
              />
            )}
          </div>
          {secret && (
            <div className="w-full text-center">
              <p style={{ fontSize: 11, color: "var(--text-3)", margin: 0 }}>
                {t("settings.client.tfa.manualLabel")}
              </p>
              <code
                className="mono mt-1 inline-block break-all"
                style={{
                  background: "var(--bg-elev-2)",
                  borderRadius: "var(--radius-sm)",
                  padding: "4px 8px",
                  fontSize: 12,
                  color: "var(--text-1)",
                }}
              >
                {secret}
              </code>
            </div>
          )}
        </div>

        {errorBox}

        <div className="field-new">
          <label className="field-new__label">{t("settings.client.tfa.codeLabel")}</label>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            placeholder={t("settings.client.tfa.codePlaceholder")}
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

        <div className="flex flex-wrap justify-end gap-2 pt-1">
          {!forced && (
            <button
              type="button"
              className="btn-new btn-new--ghost"
              style={{ height: 40 }}
              onClick={() => {
                setStep("start");
                setCode("");
                setError(null);
              }}
            >
              {t("settings.client.tfa.cancel")}
            </button>
          )}
          <button
            type="button"
            className="btn-new btn-new--primary"
            style={{ height: 40 }}
            onClick={confirm}
            disabled={loading || !code.trim()}
          >
            {loading ? t("settings.client.tfa.verifying") : t("settings.client.tfa.verifyBtn")}
          </button>
        </div>
      </div>
    );
  }

  // ── Paso: inicio (solo en ajustes) ──────────────────────────────
  return (
    <div className="space-y-3">
      {errorBox}
      <button
        type="button"
        className="btn-new btn-new--primary"
        style={{ height: 40 }}
        onClick={begin}
        disabled={loading}
      >
        <ShieldCheck size={16} strokeWidth={1.75} />
        {loading ? t("settings.client.tfa.verifying") : t("settings.client.tfa.setupBtn")}
      </button>
    </div>
  );
}
