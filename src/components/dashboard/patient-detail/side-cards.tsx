"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Receipt, Sparkles, MessageCircle, CheckCircle2 } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { isAbortError } from "@/lib/fetch-safe";
import { useT } from "@/i18n/i18n-provider";
import styles from "./patient-detail.module.css";

/** Cobro ya timbrado ante el SAT — se lista con ✓ "Facturado" en el card. */
export interface StampedInvoiceSummary {
  id: string;
  invoiceNumber: string;
  total: number;
}

interface SideCardsProps {
  finance: { total: number; paid: number; balance: number; credit?: number; pct: number };
  patientId: string;
  patientName: string;
  patientPhone: string | null;
  onCharge: () => void;
  onOpenBilling: () => void; // NUEVO — abre el tab Facturación
  /**
   * ¿La sesión tiene "billing.view"? Sin el permiso el card "Estado de cuenta"
   * NO se monta (es dato de facturación, igual que la pestaña); el resto del
   * rail —reglas automáticas y WhatsApp— queda intacto.
   */
  canViewBilling?: boolean;
  /** Facturas del paciente con CFDI timbrado (canceladas excluidas). */
  stampedInvoices?: StampedInvoiceSummary[];
}

/** Máximo de cobros timbrados listados; el resto se resume en un enlace. */
const MAX_STAMPED_ROWS = 3;

/** Un mensaje del hilo de WhatsApp, tal cual lo devuelve la API. */
interface RecentWaMessage {
  id: string;
  direction: "IN" | "OUT";
  body: string;
  sentAt: string;
  /** Envío automático de la plataforma (recordatorio, reseña, aviso…). */
  isSystem: boolean;
}

/** Cuántos mensajes caben en el rail sin estirar la tarjeta. */
const WA_RECENT_LIMIT = 4;

/**
 * "cargando" hasta que responde; "noAccess" solo con 403 (sin permiso de Inbox
 * o paciente restringido); "ready" para todo lo demás — un fallo de red se
 * degrada a "sin mensajes" en silencio, sin toast: es una tarjeta secundaria.
 */
type WaCardState = "idle" | "loading" | "ready" | "noAccess";

/**
 * Hora corta en formato de México (3:05 p.m.). Un solo formatter para toda la
 * lista. Se construye a nivel de módulo sin riesgo de desajuste de hidratación
 * porque estas filas SOLO se pintan tras el fetch del cliente.
 */
const WA_TIME_FMT = new Intl.DateTimeFormat("es-MX", {
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

export function SideCards({
  finance,
  patientId,
  patientName,
  patientPhone,
  onCharge,
  onOpenBilling,
  canViewBilling = false,
  stampedInvoices = [],
}: SideCardsProps) {
  const t = useT();
  const stampedShown = stampedInvoices.slice(0, MAX_STAMPED_ROWS);
  const stampedRest  = stampedInvoices.length - stampedShown.length;
  const firstName = patientName.split(" ")[0] ?? "";

  // ── WhatsApp recientes ──────────────────────────────────────────────────
  // La tarjeta era ESTÁTICA: pintaba siempre "Sin mensajes recientes" porque
  // nunca pedía nada. Ahora los mensajes salen de /api/inbox/patient-recent,
  // que además encuentra los hilos que le tocan al paciente por teléfono
  // aunque el enlace hilo↔paciente falte.
  const [waState, setWaState] = useState<WaCardState>(patientPhone ? "loading" : "idle");
  const [waMessages, setWaMessages] = useState<RecentWaMessage[]>([]);

  useEffect(() => {
    // Sin teléfono no puede haber conversación: ni se pide.
    if (!patientPhone) {
      setWaMessages([]);
      setWaState("idle");
      return;
    }

    const ctrl = new AbortController();
    let cancelled = false;
    setWaState("loading");

    fetch(
      `/api/inbox/patient-recent?patientId=${encodeURIComponent(patientId)}&limit=${WA_RECENT_LIMIT}`,
      { signal: ctrl.signal },
    )
      .then(async (res) => {
        if (cancelled) return;
        if (res.status === 403) {
          setWaMessages([]);
          setWaState("noAccess");
          return;
        }
        if (!res.ok) {
          setWaMessages([]);
          setWaState("ready");
          return;
        }
        const json = await res.json().catch(() => null);
        if (cancelled) return;
        setWaMessages(Array.isArray(json?.messages) ? (json.messages as RecentWaMessage[]) : []);
        setWaState("ready");
      })
      .catch((err: unknown) => {
        // Cancelar no es fallar (no se toca estado). Un error de red tampoco
        // se grita: la tarjeta se queda con su texto de "sin mensajes".
        if (cancelled || isAbortError(err)) return;
        setWaMessages([]);
        setWaState("ready");
      });

    return () => {
      cancelled = true;
      ctrl.abort();
    };
  }, [patientId, patientPhone]);

  return (
    <aside className={styles.sidePanel} aria-label={t("patients.sideCards.panelAria")}>
      {/* Estado de cuenta — solo con permiso "billing.view" */}
      {canViewBilling && (
        <section className={styles.sideCard}>
          <header
            className={styles.sideCardHead}
            style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}
          >
            <h3 className={styles.sideCardTitle}>
              <Receipt size={13} strokeWidth={1.75} aria-hidden /> {t("patients.sideCards.accountStatement")}
            </h3>
            <button type="button" className={styles.sideCardLink} onClick={onOpenBilling}>
              {t("patients.sideCards.viewBilling")} →
            </button>
          </header>
          <div className={styles.financeRow}>
            <span>{t("patients.sideCards.treatmentTotal")}</span>
            <strong>{formatCurrency(finance.total)}</strong>
          </div>
          <div className={`${styles.financeRow} ${styles.success}`}>
            <span>{t("patients.sideCards.paid")}</span>
            <strong>{formatCurrency(finance.paid)}</strong>
          </div>
          <div className={`${styles.financeRow} ${styles.danger}`}>
            <span>{t("patients.sideCards.pendingBalance")}</span>
            <strong>{formatCurrency(finance.balance)}</strong>
          </div>
          {(finance.credit ?? 0) > 0 && (
            <div className={`${styles.financeRow} ${styles.success}`}>
              <span>{t("patients.sideCards.creditBalance")}</span>
              <strong>{formatCurrency(finance.credit ?? 0)}</strong>
            </div>
          )}
          <div className={styles.financeBar}>
            <div className={styles.financeBarFill} style={{ width: `${finance.pct}%` }} />
          </div>
          <div className={styles.financeBarLabel}>{t("patients.sideCards.pctCovered", { pct: finance.pct })}</div>

          {/* CFDI — un ✓ "Facturado" por cobro timbrado, para no tener que abrir
              la pestaña para saber cuáles ya se facturaron ante el SAT. */}
          {stampedShown.length > 0 && (
            <div style={{ marginTop: 10 }}>
              {stampedShown.map((inv) => (
                <div key={inv.id} className={`${styles.financeRow} ${styles.success}`}>
                  <span
                    style={{
                      display: "inline-flex", alignItems: "center", gap: 5,
                      minWidth: 0, color: "var(--success)",
                    }}
                  >
                    <CheckCircle2 size={12} strokeWidth={2.25} style={{ flexShrink: 0 }} aria-hidden />
                    {t("patients.sideCards.invoiced")}
                    <span
                      className="mono"
                      style={{ color: "var(--text-3)", fontSize: 11, overflow: "hidden", textOverflow: "ellipsis" }}
                    >
                      {inv.invoiceNumber}
                    </span>
                  </span>
                  <strong>{formatCurrency(inv.total)}</strong>
                </div>
              ))}
              {stampedRest > 0 && (
                <button
                  type="button"
                  className={styles.sideCardLink}
                  style={{ fontSize: 11, marginTop: 6 }}
                  onClick={onOpenBilling}
                >
                  {t("patients.sideCards.moreInvoiced", { count: stampedRest })}
                </button>
              )}
            </div>
          )}

          {finance.balance > 0 && (
            <button
              type="button"
              className={`${styles.sideBtn} ${styles.primary} ${styles.fullWidth}`}
              onClick={onCharge}
            >
              {t("patients.sideCards.chargeNow")} · {formatCurrency(finance.balance)}
            </button>
          )}
        </section>
      )}

      {/* Reglas automáticas */}
      <section className={`${styles.sideCard} ${styles.aiCard}`}>
        <header className={styles.sideCardHead}>
          <h3 className={styles.sideCardTitle}>
            <Sparkles size={13} strokeWidth={1.75} aria-hidden /> {t("patients.sideCards.autoRules")}
          </h3>
        </header>
        <p className={styles.aiText}>
          {t("patients.sideCards.reminderText", { name: firstName })}
        </p>
      </section>

      {/* WhatsApp recientes */}
      <section className={styles.sideCard}>
        <header className={styles.sideCardHead}>
          <h3 className={styles.sideCardTitle}>
            <MessageCircle size={13} strokeWidth={1.75} aria-hidden /> {t("patients.sideCards.recentWhatsApp")}
          </h3>
        </header>
        {!patientPhone ? (
          <div className={styles.waEmpty}>{t("patients.sideCards.noPhone")}</div>
        ) : waState === "loading" ? (
          <div className={styles.waEmpty}>{t("patients.sideCards.waLoading")}</div>
        ) : waState === "noAccess" ? (
          <div className={styles.waEmpty}>{t("patients.sideCards.waNoAccess")}</div>
        ) : waMessages.length === 0 ? (
          <div className={styles.waEmpty}>
            {t("patients.sideCards.noRecentMessages", { name: firstName })}
          </div>
        ) : (
          <ul className={styles.waList}>
            {waMessages.map((m) => (
              <li
                key={m.id}
                className={`${styles.waMsg} ${m.direction === "IN" ? styles.waMsgIn : ""} ${
                  m.isSystem ? styles.waMsgSystem : ""
                }`}
              >
                <span className={styles.waWho}>
                  {m.direction === "IN"
                    ? t("patients.sideCards.waFromPatient", { name: firstName })
                    : t("patients.sideCards.waFromClinic")}
                </span>
                {/* El rail recorta a una línea: el texto completo, en el title. */}
                <span className={styles.waBody} title={m.body}>
                  {m.body}
                </span>
                <span className={styles.waTime}>{WA_TIME_FMT.format(new Date(m.sentAt))}</span>
              </li>
            ))}
          </ul>
        )}
        {/* Sin acceso al Inbox el enlace no lleva a ningún lado: se esconde. */}
        {patientPhone && waState !== "noAccess" && (
          <Link
            href={`/dashboard/inbox?patientId=${encodeURIComponent(patientId)}`}
            className={`${styles.sideBtn} ${styles.fullWidth}`}
            style={{ textDecoration: "none" }}
          >
            {t("patients.sideCards.openChat")}
          </Link>
        )}
      </section>
    </aside>
  );
}
