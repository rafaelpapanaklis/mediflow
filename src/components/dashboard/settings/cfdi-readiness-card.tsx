"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, XCircle, MinusCircle, ExternalLink, RefreshCw } from "lucide-react";
import { useT } from "@/i18n/i18n-provider";

// Portal público de Facturapi para firmar la Carta Manifiesto. Se firma con la
// e.firma del RFC emisor (requisito SAT, reglas 2.7.2.5 y 2.7.2.7 de la RMF) y
// NO requiere cuenta en Facturapi: la identidad sale del propio certificado.
const MANIFIESTO_URL = "https://www.facturapi.io/manifiesto";

interface CfdiStatus {
  live:              boolean;
  configured:        boolean;
  unavailable?:      boolean;
  orgExists:         boolean;
  isProductionReady: boolean;
  /** false = Facturapi no dijo qué falta; los pasos van en null (desconocido). */
  stepsKnown?:       boolean;
  steps:             { legal: boolean | null; certificate: boolean | null; manifiesto: boolean | null; logo: boolean | null };
  pendingSteps:      { type: string; description: string | null }[];
  csdValidUntil?:    string | null;
}

/** ✓ / ✗ / — (— = no se pudo determinar; jamás se afirma lo que no se sabe). */
function StepIcon({ ok }: { ok: boolean | null }) {
  if (ok === null) return <MinusCircle size={16} strokeWidth={1.75} style={{ color: "var(--text-3)", flexShrink: 0 }} />;
  return ok
    ? <CheckCircle2 size={16} strokeWidth={1.75} style={{ color: "var(--success)", flexShrink: 0 }} />
    : <XCircle size={16} strokeWidth={1.75} style={{ color: "var(--danger)", flexShrink: 0 }} />;
}

function StepRow({ ok, label, help, children }: {
  ok: boolean | null; label: string; help?: string; children?: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-2.5 py-2" style={{ borderTop: "1px solid var(--border)" }}>
      <div className="pt-0.5"><StepIcon ok={ok} /></div>
      <div className="min-w-0 flex-1">
        <div className="text-sm" style={{ color: "var(--text-1)" }}>{label}</div>
        {help && <div className="text-xs mt-0.5" style={{ color: "var(--text-3)" }}>{help}</div>}
        {children}
      </div>
    </div>
  );
}

/**
 * Checklist REAL de la organización fiscal de la clínica en Facturapi: qué le
 * falta para emitir CFDI con validez fiscal. No se adivina nada — se lee
 * is_production_ready / pending_steps vía GET /api/settings/cfdi/status.
 *
 * `refreshKey` lo sube el padre cuando cambia algo que afecta al checklist
 * (p. ej. tras subir el CSD) para volver a consultar sin recargar la página.
 */
export function CfdiReadinessCard({ refreshKey = 0 }: { refreshKey?: number }) {
  const t = useT();
  const [status,  setStatus]  = useState<CfdiStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (refresh: boolean) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/settings/cfdi/status${refresh ? "?refresh=1" : ""}`);
      setStatus(res.ok ? await res.json() : null);
    } catch {
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(refreshKey > 0); }, [load, refreshKey]);

  const ready = status?.isProductionReady === true;
  // Pasos que Facturapi reporta y que no pintamos como fila propia (por si
  // agregan uno nuevo): se muestran con su propia descripción.
  const KNOWN = ["legal", "certificate", "manifiesto", "logo"];
  const extraSteps = (status?.pendingSteps ?? []).filter((s) => !KNOWN.includes(s.type));

  return (
    <div className="card">
      <div className="card__header">
        <div>
          <div className="card__title">{t("settings.client.readyTitle")}</div>
          <div className="card__sub">{t("settings.client.readySubtitle")}</div>
        </div>
        {status && !status.unavailable && status.configured && (
          <span className={`badge-new ${ready ? "badge-new--success" : "badge-new--warning"} whitespace-nowrap`}>
            {ready ? t("settings.client.readyBadgeOk") : t("settings.client.readyBadgePending")}
          </span>
        )}
      </div>
      <div className="card__body space-y-3">

        {loading && !status && (
          <div className="text-sm" style={{ color: "var(--text-3)" }}>{t("settings.client.readyLoading")}</div>
        )}

        {!loading && !status && (
          <div className="text-sm" style={{ color: "var(--text-2)" }}>{t("settings.client.readyUnavailable")}</div>
        )}

        {status?.unavailable && (
          <div className="text-sm" style={{ color: "var(--text-2)" }}>{t("settings.client.readyUnavailable")}</div>
        )}

        {status && !status.unavailable && !status.configured && (
          <div className="text-sm" style={{ color: "var(--text-2)" }}>{t("settings.client.readyNeedConfigFirst")}</div>
        )}

        {status && !status.unavailable && status.configured && !status.orgExists && (
          <div className="text-sm" style={{ color: "var(--danger)" }}>{t("settings.client.readyOrgMissing")}</div>
        )}

        {status && !status.unavailable && status.configured && status.orgExists && (
          <>
            <StepRow
              ok={status.steps.legal}
              label={t("settings.client.readyLegal")}
              help={t("settings.client.readyLegalHelp")}
            />
            <StepRow
              ok={status.steps.certificate}
              label={t("settings.client.readyCsd")}
              help={status.steps.certificate && status.csdValidUntil
                ? t("settings.client.csdValidUntilLabel", { date: new Date(status.csdValidUntil).toLocaleDateString() })
                : t("settings.client.readyCsdHelp")}
            />
            <StepRow
              ok={status.steps.manifiesto}
              label={t("settings.client.readyManifest")}
              help={t("settings.client.readyManifestHelp")}
            >
              {status.steps.manifiesto === false && (
                <a href={MANIFIESTO_URL} target="_blank" rel="noopener noreferrer"
                  className="btn-new btn-new--secondary btn-new--sm mt-2">
                  <ExternalLink size={14} strokeWidth={1.75} /> {t("settings.client.readyManifestBtn")}
                </a>
              )}
            </StepRow>
            {/* El logo también bloquea producción, pero solo se menciona si falta:
                en verde sería ruido en un checklist fiscal. */}
            {status.steps.logo === false && (
              <StepRow ok={false} label={t("settings.client.readyLogo")} help={t("settings.client.readyLogoHelp")} />
            )}
            {extraSteps.map((s) => (
              <StepRow key={s.type} ok={false} label={s.description || s.type} />
            ))}

            {/* Facturapi dice "no lista" pero no enumeró ni un paso: se explica en
                vez de mostrar todo en verde junto al badge "Faltan pasos". */}
            {status.stepsKnown === false && (
              <div className="text-xs" style={{
                background: "var(--warning-soft, rgba(245,158,11,0.10))",
                border: "1px solid var(--warning)", color: "var(--warning)",
                borderRadius: "var(--radius)", padding: 12,
              }}>
                {t("settings.client.readyStepsUnknown")}
              </div>
            )}

            <div className="text-xs" style={{
              background: "var(--info-soft)", border: "1px solid var(--info-soft)",
              color: "var(--info-strong)", borderRadius: "var(--radius)", padding: 12,
            }}>
              {status.live ? t("settings.client.readyLiveNote") : t("settings.client.readyTestNote")}
            </div>
          </>
        )}

        <div className="pt-1">
          <button type="button" onClick={() => load(true)} disabled={loading}
            className="btn-new btn-new--ghost btn-new--sm">
            <RefreshCw size={14} strokeWidth={1.75} /> {t("settings.client.readyRefresh")}
          </button>
        </div>
      </div>
    </div>
  );
}
