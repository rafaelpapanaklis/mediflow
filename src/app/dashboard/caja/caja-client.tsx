"use client";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Wallet, TrendingUp, Percent, Receipt, ArrowDownCircle, Banknote,
  Lock, Printer, X, ChevronDown, ChevronRight, History,
  CreditCard, Download, AlertTriangle, KeyRound, Clock,
} from "lucide-react";
import toast from "react-hot-toast";
import { KpiCard }   from "@/components/ui/design-system/kpi-card";
import { CardNew }   from "@/components/ui/design-system/card-new";
import { BadgeNew }  from "@/components/ui/design-system/badge-new";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { fmtMXNdec } from "@/lib/format";
import { useT } from "@/i18n/i18n-provider";
import { BillingClient } from "../billing/billing-client";
import type { CajaState, CajaHistoryRow } from "@/lib/caja";

interface BillingProps {
  invoices:      any[];
  patients:      any[];
  totalPaid:     number;
  totalPending:  number;
  totalOverdue:  number;
  monthInvoices: number;
  creditTotal:   number;
  clinic:        { facturApiEnabled: boolean; rfcEmisor: string | null; cfdiTaxMode?: string | null };
  /** true = FACTURAPI_ENV=live → el timbrado va al SAT con validez fiscal. */
  cfdiLive?:     boolean;
}

interface Props {
  caja:     CajaState;
  history:  CajaHistoryRow[];
  timezone: string;
  hasPin:   boolean;
  billing:  BillingProps;
}

interface CloseSummary {
  openedAt:         string;
  closedAt:         string;
  openingBalance:   number;
  cashIncome:       number;
  cardDebitIncome:  number;
  cardCreditIncome: number;
  otherIncome:      number;
  totalIncome:      number;
  discounts:        number;
  tax:              number;
  withdrawals:      number;
  expectedCash:     number;
  counted:          number;
  variance:         number;
  list:             CajaState["list"];
}

const PIN_RE = /^\d{6}$/;

/** A partir de estas horas abiertas sugerimos hacer el corte (solo aviso). */
const STALE_SHIFT_HOURS = 18;

export function CajaClient({ caja, history, timezone, hasPin: hasPinInitial, billing }: Props) {
  const t = useT();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [tab, setTab] = useState<"caja" | "facturas">(
    searchParams.get("tab") === "facturas" ? "facturas" : "caja",
  );

  // ¿El usuario ya configuró su PIN de Caja? Puede volverse true tras crearlo.
  const [hasPin, setHasPin] = useState(hasPinInitial);

  // Modals
  const [showOpen, setShowOpen]             = useState(false);
  const [showWithdrawal, setShowWithdrawal] = useState(false);
  const [showClose, setShowClose]           = useState(false);
  const [summary, setSummary]               = useState<CloseSummary | null>(null);
  const [showHistory, setShowHistory]       = useState(false);

  // Form state — apertura
  const [openingBalance, setOpeningBalance] = useState("");
  const [openPin, setOpenPin]               = useState("");
  const [openPinConfirm, setOpenPinConfirm] = useState("");
  const [openWAmount, setOpenWAmount]       = useState("");
  const [openWReason, setOpenWReason]       = useState("");
  // Form state — retiro
  const [wAmount, setWAmount]               = useState("");
  const [wReason, setWReason]               = useState("");
  // FIN-07: el retiro pasa a pedir el PIN, igual que el cierre. Mueve efectivo
  // de verdad — se resta del esperado y del corte— y hasta ahora no pedía nada.
  const [wPin, setWPin]                     = useState("");
  // Form state — cierre
  const [counted, setCounted]               = useState("");
  const [closingNotes, setClosingNotes]     = useState("");
  const [closePin, setClosePin]             = useState("");
  const [busy, setBusy]                     = useState(false);

  const reg    = caja.register;
  const totals = caja.totals;

  const METHOD_LABEL: Record<string, string> = {
    cash:     t("cashRegister.methodCash"),
    debit:    t("cashRegister.methodDebit"),
    credit:   t("cashRegister.methodCredit"),
    transfer: t("cashRegister.methodTransfer"),
    check:    t("cashRegister.methodCheck"),
    other:    t("cashRegister.methodOther"),
  };
  const methodLabel = (m: string) => METHOD_LABEL[m] ?? m;

  // ── Fechas, SIEMPRE en la zona horaria de la clínica ──────────────────
  // Si `timezone` llegara inválida, Intl lanza RangeError y tumba la página
  // entera; se degrada a la zona del navegador en vez de romper el corte.
  const tz = useMemo(() => {
    try { new Intl.DateTimeFormat("es-MX", { timeZone: timezone }); return timezone; }
    catch { return undefined; }
  }, [timezone]);

  const fmtTime = (iso: string) =>
    new Date(iso).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit", timeZone: tz });
  const fmtDateTime = (iso: string) =>
    new Date(iso).toLocaleString("es-MX", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: tz });
  /** "27 jul" — prefijo de día en las filas cuando el turno cruza días. */
  const fmtDayShort = (iso: string) =>
    new Date(iso).toLocaleDateString("es-MX", { day: "2-digit", month: "short", timeZone: tz });
  /** "Jueves, 27 de jul" — encabezado del grupo de día dentro de la tabla. */
  const fmtDayLong = (iso: string) => {
    const s = new Date(iso).toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "short", timeZone: tz });
    return s.charAt(0).toUpperCase() + s.slice(1);
  };
  /** dd/mm/aaaa y hh:mm de 24 h — para el CSV: Excel sí los parsea como fecha y hora. */
  const fmtDayNumeric = (iso: string) =>
    new Date(iso).toLocaleDateString("es-MX", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: tz });
  const fmtClock24 = (iso: string) =>
    new Date(iso).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: tz });

  // Día natural de la clínica como clave comparable ("2026-07-27"). Se arma con
  // formatToParts y no con un locale prestado (en-CA) para que el formato no
  // dependa de los locales que tenga instalados el navegador.
  const dayKeyFmt = useMemo(
    () => new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }),
    [tz],
  );
  const dayKey = useCallback((at: string | number | Date) => {
    const parts = dayKeyFmt.formatToParts(new Date(at));
    const get = (type: string) => parts.find(p => p.type === type)?.value ?? "";
    return `${get("year")}-${get("month")}-${get("day")}`;
  }, [dayKeyFmt]);

  /**
   * Días naturales distintos que toca un turno. Cuenta también las anclas
   * (apertura / cierre): un turno abierto ayer que solo cobró hoy TAMBIÉN cruza
   * días, y sus filas deben decir de qué día son.
   */
  const daySpan = useCallback(
    (rows: CajaState["list"], ...anchors: (string | null | undefined)[]) => {
      const days = new Set<string>();
      for (const a of anchors) if (a) days.add(dayKey(a));
      for (const r of rows) days.add(dayKey(r.at));
      return days;
    },
    [dayKey],
  );

  // La lista es del TURNO, no del día: solo si cruza más de un día natural las
  // filas muestran fecha. Un turno de un solo día se sigue viendo con la hora sola.
  const listMultiDay = daySpan(caja.list, reg?.openedAt).size > 1;
  // Mismo criterio para el resumen congelado que se muestra tras cerrar.
  const summaryMultiDay = summary != null && daySpan(summary.list, summary.openedAt, summary.closedAt).size > 1;

  // Conteo y suma por día — SOLO para el encabezado de grupo de la tabla. No
  // interviene en el arqueo: los totales del turno siguen viniendo del servidor.
  const dayAgg = useMemo(() => {
    const m = new Map<string, { count: number; total: number }>();
    for (const r of caja.list) {
      const k = dayKey(r.at);
      const cur = m.get(k) ?? { count: 0, total: 0 };
      cur.count += 1;
      cur.total += r.amount;
      m.set(k, cur);
    }
    return m;
  }, [caja.list, dayKey]);

  // ── Aviso de caja sin cortar ──────────────────────────────────────────
  // `now` se resuelve DESPUÉS de montar: calcularlo en el render lo haría
  // distinto en el servidor y en el navegador y rompería la hidratación.
  const [nowMs, setNowMs] = useState<number | null>(null);
  useEffect(() => {
    setNowMs(Date.now());
    const id = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const staleShift = useMemo(() => {
    if (!reg || nowMs == null) return null;
    const hours = (nowMs - new Date(reg.openedAt).getTime()) / 3_600_000;
    // Cruzar a otro día natural también amerita el aviso aunque lleve pocas horas.
    const crossedDay = dayKey(reg.openedAt) !== dayKey(nowMs);
    if (hours < STALE_SHIFT_HOURS && !crossedDay) return null;
    return { hours: Math.max(0, Math.floor(hours)) };
  }, [reg, nowMs, dayKey]);

  // Facturación del día (siempre disponible, con o sin caja abierta).
  const collectedToday = Math.max(0, caja.billedToday - caja.pendingToday);

  // Diferencia en vivo dentro del modal de cierre.
  const countedNum = parseFloat(counted);
  const liveVariance = useMemo(() => {
    if (!totals || Number.isNaN(countedNum)) return null;
    return Math.round((countedNum - totals.expectedCash + Number.EPSILON) * 100) / 100;
  }, [countedNum, totals]);

  async function post(url: string, body: any): Promise<any | null> {
    setBusy(true);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data?.error || t("cashRegister.errorGeneric"));
        return null;
      }
      return data ?? {};
    } catch {
      toast.error(t("cashRegister.errorGeneric"));
      return null;
    } finally {
      setBusy(false);
    }
  }

  function startOpen() {
    // Prefija la apertura con el efectivo de hoy aún no cuadrado (editable).
    setOpeningBalance(caja.suggestedOpening > 0 ? String(caja.suggestedOpening) : "");
    setOpenPin(""); setOpenPinConfirm(""); setOpenWAmount(""); setOpenWReason("");
    setShowOpen(true);
  }

  async function openRegister() {
    const bal = parseFloat(openingBalance);
    if (Number.isNaN(bal) || bal < 0) { toast.error(t("cashRegister.amountInvalid")); return; }
    if (!PIN_RE.test(openPin)) { toast.error("El PIN debe ser de 6 dígitos."); return; }

    // Si el usuario aún no tiene PIN, lo crea antes de abrir (open exige PIN).
    if (!hasPin) {
      if (openPin !== openPinConfirm) { toast.error("Los PIN no coinciden."); return; }
      const setRes = await post("/api/caja/pin", { action: "set", pin: openPin });
      if (!setRes) return;
      setHasPin(true);
    }

    const ok = await post("/api/caja/open", { openingBalance: bal, pin: openPin });
    if (!ok) return;

    // Retiro inicial opcional en la misma apertura. El PIN es el que se acaba
    // de teclear para abrir: no se le pide dos veces en la misma pantalla.
    const amt = parseFloat(openWAmount);
    if (!Number.isNaN(amt) && amt > 0) {
      await post("/api/caja/withdrawal", { amount: amt, reason: openWReason.trim() || "Retiro de apertura", pin: openPin });
    }

    toast.success(t("cashRegister.toastOpened"));
    setShowOpen(false);
    setOpeningBalance(""); setOpenPin(""); setOpenPinConfirm(""); setOpenWAmount(""); setOpenWReason("");
    router.refresh();
  }

  async function recordWithdrawal() {
    const amt = parseFloat(wAmount);
    if (Number.isNaN(amt) || amt <= 0) { toast.error(t("cashRegister.amountInvalid")); return; }
    if (!wReason.trim()) { toast.error(t("cashRegister.reasonRequired")); return; }
    if (!PIN_RE.test(wPin)) { toast.error("El PIN debe ser de 6 dígitos."); return; }
    const ok = await post("/api/caja/withdrawal", { amount: amt, reason: wReason.trim(), pin: wPin });
    if (!ok) return;
    toast.success(t("cashRegister.toastWithdrawal"));
    setShowWithdrawal(false);
    setWAmount(""); setWReason(""); setWPin("");
    router.refresh();
  }

  async function closeRegister() {
    const cnt = parseFloat(counted);
    if (Number.isNaN(cnt) || cnt < 0) { toast.error(t("cashRegister.amountInvalid")); return; }
    if (!PIN_RE.test(closePin)) { toast.error("El PIN debe ser de 6 dígitos."); return; }
    if (!totals || !reg) return;
    const res = await post("/api/caja/close", {
      countedClosingBalance: cnt,
      closingNotes: closingNotes.trim() || undefined,
      pin: closePin,
    });
    if (!res) return;
    // Congela el resumen del corte para mostrarlo/imprimirlo (tras refresh reg = null).
    setSummary({
      openedAt:         reg.openedAt,
      closedAt:         new Date().toISOString(),
      openingBalance:   totals.openingBalance,
      cashIncome:       totals.cashIncome,
      cardDebitIncome:  totals.cardDebitIncome,
      cardCreditIncome: totals.cardCreditIncome,
      otherIncome:      totals.otherIncome,
      totalIncome:      totals.totalIncome,
      discounts:        totals.discounts,
      tax:              totals.tax,
      withdrawals:      totals.withdrawals,
      expectedCash:     totals.expectedCash,
      counted:          cnt,
      variance:         typeof res.variance === "number" ? res.variance : cnt - totals.expectedCash,
      list:             caja.list,
    });
    toast.success(t("cashRegister.toastClosed"));
    setShowClose(false);
    setCounted(""); setClosingNotes(""); setClosePin("");
    router.refresh();
  }

  // Exporta las ventas del turno a CSV (abre en Excel). Sigue el patrón cliente
  // del repo (Blob + createObjectURL); BOM para acentos + CRLF para Excel.
  // Fecha y hora van SIEMPRE y en columnas separadas (dd/mm/aaaa + hh:mm de 24 h):
  // un archivo contable con solo la hora no sirve, y el turno puede cruzar días.
  function downloadVentasCsv() {
    const rows = caja.list;
    if (rows.length === 0) { toast.error("No hay ventas para exportar."); return; }
    const cell = (v: string | number) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const header = ["Fecha", "Hora", "Paciente", "Procedimiento", "Método", "Total", "Descuento", "Profesional"];
    const lines = [
      header.join(","),
      ...rows.map(r => [
        cell(fmtDayNumeric(r.at)),
        cell(fmtClock24(r.at)),
        cell(r.patientName),
        cell(r.concept),
        cell(methodLabel(r.method)),
        r.amount,
        r.discount,
        cell(r.doctorName),
      ].join(",")),
    ];
    const csv = "﻿" + lines.join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `caja-ventas-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Ventas exportadas.");
  }

  function printSummary(s: CloseSummary) {
    // El corte impreso es un documento de arqueo: si el turno cruzó días, cada
    // línea lleva la fecha completa, no solo la hora.
    const multiDay = daySpan(s.list, s.openedAt, s.closedAt).size > 1;
    const rows = s.list.map(r =>
      `<tr><td>${multiDay ? fmtDateTime(r.at) : fmtTime(r.at)}</td><td>${esc(r.patientName)}</td><td>${esc(r.concept)}</td><td style="text-align:right">${fmtMXNdec(r.amount)}</td><td>${esc(methodLabel(r.method))}</td><td>${esc(r.doctorName)}</td></tr>`,
    ).join("");
    const line = (label: string, val: string) =>
      `<tr><td style="padding:2px 12px 2px 0;color:#555">${label}</td><td style="text-align:right;font-weight:600">${val}</td></tr>`;
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${t("cashRegister.summaryTitle")}</title>
      <style>body{font-family:system-ui,Arial,sans-serif;padding:24px;color:#111;font-size:13px}h1{font-size:18px;margin:0 0 4px}h2{font-size:14px;margin:20px 0 8px}table{border-collapse:collapse;width:100%}td,th{padding:4px 8px}.mov th,.mov td{border-bottom:1px solid #eee;text-align:left}.mov th{background:#f6f6f6}</style>
      </head><body>
      <h1>${t("cashRegister.summaryTitle")}</h1>
      <div style="color:#666">${fmtDateTime(s.openedAt)} → ${fmtDateTime(s.closedAt)}</div>
      <h2>${t("cashRegister.title")}</h2>
      <table>
        ${line(t("cashRegister.kpiOpening"), fmtMXNdec(s.openingBalance))}
        ${line(t("cashRegister.kpiIncome"), fmtMXNdec(s.totalIncome))}
        ${line(t("cashRegister.methodCash"), fmtMXNdec(s.cashIncome))}
        ${line(t("cashRegister.methodDebit"), fmtMXNdec(s.cardDebitIncome))}
        ${line(t("cashRegister.methodCredit"), fmtMXNdec(s.cardCreditIncome))}
        ${line(t("cashRegister.kpiDiscounts"), fmtMXNdec(s.discounts))}
        ${line(t("cashRegister.kpiTax"), fmtMXNdec(s.tax))}
        ${line(t("cashRegister.kpiWithdrawals"), fmtMXNdec(s.withdrawals))}
        ${line(t("cashRegister.expectedCashLabel"), fmtMXNdec(s.expectedCash))}
        ${line(t("cashRegister.countedLabel"), fmtMXNdec(s.counted))}
        ${line(t("cashRegister.varianceLabel"), fmtMXNdec(s.variance))}
      </table>
      <h2>${t("cashRegister.listTitle")}</h2>
      <table class="mov"><thead><tr>
        <th>${multiDay ? t("cashRegister.thDateTime") : t("cashRegister.thTime")}</th><th>${t("cashRegister.thPatient")}</th><th>${t("cashRegister.thConcept")}</th>
        <th style="text-align:right">${t("cashRegister.thAmount")}</th><th>${t("cashRegister.thMethod")}</th><th>${t("cashRegister.thDoctor")}</th>
      </tr></thead><tbody>${rows || `<tr><td colspan="6" style="color:#999">${t("cashRegister.emptyList")}</td></tr>`}</tbody></table>
      <script>window.onload=function(){window.print();}</script>
      </body></html>`;
    const w = window.open("", "_blank", "width=820,height=640");
    if (w) { w.document.write(html); w.document.close(); }
  }

  const varianceTone = (v: number) => (Math.abs(v) < 0.005 ? "success" : v > 0 ? "info" : "danger");

  return (
    <div style={{ maxWidth: 1400, margin: "0 auto", width: "100%" }}>
      {/* Header + tabs */}
      <div style={{ padding: "clamp(14px, 1.6vw, 28px) clamp(14px, 1.6vw, 28px) 0" }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 20, flexWrap: "wrap", marginBottom: 16 }}>
          <div>
            <h1 style={{ fontSize: "clamp(20px, 1.4vw, 22px)", letterSpacing: "-0.02em", color: "var(--text-1)", fontWeight: 700, margin: 0 }}>
              {t("cashRegister.title")}
            </h1>
            <p style={{ color: "var(--text-3)", fontSize: 13, marginTop: 4 }}>{t("cashRegister.subtitle")}</p>
          </div>
        </div>
        <div className="segment-new" role="tablist" style={{ marginBottom: 4 }}>
          <button type="button" onClick={() => setTab("caja")}
            className={`segment-new__btn ${tab === "caja" ? "segment-new__btn--active" : ""}`}>
            {t("cashRegister.tabCaja")}
          </button>
          <button type="button" onClick={() => setTab("facturas")}
            className={`segment-new__btn ${tab === "facturas" ? "segment-new__btn--active" : ""}`}>
            {t("cashRegister.tabInvoices")}
          </button>
        </div>
      </div>

      {tab === "facturas" ? (
        <BillingClient
          invoices={billing.invoices}
          patients={billing.patients}
          totalPaid={billing.totalPaid}
          totalPending={billing.totalPending}
          totalOverdue={billing.totalOverdue}
          monthInvoices={billing.monthInvoices}
          creditTotal={billing.creditTotal}
          clinic={billing.clinic}
          cfdiLive={billing.cfdiLive}
        />
      ) : (
        <div style={{ padding: "clamp(14px, 1.6vw, 28px)" }}>
          {/* ── Facturación del día (siempre visible) ── */}
          <div style={{ marginBottom: 18 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <Receipt size={16} strokeWidth={1.75} style={{ color: "var(--text-3)" }} />
              <span style={{ color: "var(--text-2)", fontSize: 13.5, fontWeight: 600 }}>Facturación del día</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 14 }}>
              <KpiCard label="Facturado hoy" value={fmtMXNdec(caja.billedToday)}  icon={Receipt} />
              <KpiCard label="Cobrado hoy"   value={fmtMXNdec(collectedToday)}    icon={TrendingUp} hero />
              <KpiCard label="Por cobrar"    value={fmtMXNdec(caja.pendingToday)} icon={Wallet} />
              <KpiCard label="Vencido"       value={fmtMXNdec(caja.overdueToday)} icon={AlertTriangle} />
            </div>
          </div>

          {!reg || !totals ? (
            /* ── Caja cerrada ── */
            <CardNew>
              <div style={{ textAlign: "center", padding: "40px 20px" }}>
                <Wallet size={34} strokeWidth={1.75} style={{ color: "var(--text-3)", marginBottom: 12 }} />
                <div style={{ color: "var(--text-1)", fontSize: 16, fontWeight: 600 }}>{t("cashRegister.closedTitle")}</div>
                <p style={{ color: "var(--text-3)", fontSize: 13, margin: "6px 0 18px" }}>{t("cashRegister.closedDesc")}</p>
                <ButtonNew variant="primary" icon={<Wallet size={16} strokeWidth={1.75} />} onClick={startOpen}>
                  {t("cashRegister.openCta")}
                </ButtonNew>
              </div>
            </CardNew>
          ) : (
            <>
              {/* Aviso de turno sin cortar. Solo informa: no cierra la caja ni
               *  bloquea nada. Aparece a las STALE_SHIFT_HOURS o al cruzar de día. */}
              {staleShift && (
                <div style={{
                  display: "flex", alignItems: "flex-start", gap: 10,
                  background: "var(--warning-soft)",
                  border: "1px solid var(--warning-border-strong)",
                  borderRadius: "var(--radius-lg)",
                  padding: "12px 14px", marginBottom: 14,
                }}>
                  <Clock size={16} strokeWidth={1.75} style={{ color: "var(--warning-strong)", flexShrink: 0, marginTop: 1 }} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "var(--warning-strong)" }}>
                      {t("cashRegister.staleShiftTitle", { date: fmtDateTime(reg.openedAt), hours: staleShift.hours })}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--warning-strong)", opacity: 0.85, marginTop: 3 }}>
                      {t("cashRegister.staleShiftDesc")}
                    </div>
                  </div>
                </div>
              )}

              {/* Barra de estado + acciones */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <BadgeNew tone="success" dot>{t("cashRegister.tabCaja")}</BadgeNew>
                  <span style={{ color: "var(--text-3)", fontSize: 12.5 }}>
                    {t("cashRegister.openedBy", { name: reg.operatorName })} · {t("cashRegister.openedAt", { time: fmtDateTime(reg.openedAt) })}
                  </span>
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <ButtonNew variant="secondary" icon={<ArrowDownCircle size={16} strokeWidth={1.75} />} onClick={() => { setWPin(""); setShowWithdrawal(true); }}>
                    {t("cashRegister.withdrawalCta")}
                  </ButtonNew>
                  <ButtonNew variant="primary" icon={<Lock size={16} strokeWidth={1.75} />} onClick={() => setShowClose(true)}>
                    {t("cashRegister.closeCta")}
                  </ButtonNew>
                </div>
              </div>

              {/* KPIs del turno — incluye desglose de tarjeta débito/crédito */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 14, marginBottom: 8 }}>
                <KpiCard label={t("cashRegister.kpiOpening")}      value={fmtMXNdec(totals.openingBalance)}   icon={Wallet} />
                <KpiCard label={t("cashRegister.kpiIncome")}       value={fmtMXNdec(totals.totalIncome)}      icon={TrendingUp} hero />
                <KpiCard label={t("cashRegister.methodCash")}      value={fmtMXNdec(totals.cashIncome)}       icon={Banknote} />
                <KpiCard label={t("cashRegister.methodDebit")}     value={fmtMXNdec(totals.cardDebitIncome)}  icon={CreditCard} />
                <KpiCard label={t("cashRegister.methodCredit")}    value={fmtMXNdec(totals.cardCreditIncome)} icon={CreditCard} />
                <KpiCard label={t("cashRegister.kpiDiscounts")}    value={fmtMXNdec(totals.discounts)}        icon={Percent} />
                <KpiCard label={t("cashRegister.kpiTax")}          value={fmtMXNdec(totals.tax)}              icon={Receipt} />
                <KpiCard label={t("cashRegister.kpiWithdrawals")}  value={fmtMXNdec(totals.withdrawals)}      icon={ArrowDownCircle} />
                <KpiCard label={t("cashRegister.kpiExpectedCash")} value={fmtMXNdec(totals.expectedCash)}     icon={Banknote} />
              </div>
              {totals.otherIncome > 0 && (
                <p style={{ color: "var(--text-3)", fontSize: 12, margin: "0 0 18px" }}>
                  Otros métodos (transferencia / cheque / otro):{" "}
                  <span style={{ fontFamily: "var(--font-mono, monospace)", fontVariantNumeric: "tabular-nums", fontWeight: 600, color: "var(--text-2)" }}>{fmtMXNdec(totals.otherIncome)}</span>
                </p>
              )}

              {/* Retiros del turno */}
              {caja.withdrawals.length > 0 && (
                <CardNew title={t("cashRegister.withdrawalsTitle")} className="mb-4" >
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {caja.withdrawals.map(w => (
                      <div key={w.id} style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 13, borderBottom: "1px solid var(--border-soft)", paddingBottom: 6 }}>
                        <span style={{ color: "var(--text-2)" }}>{w.reason} <span style={{ color: "var(--text-3)" }}>· {fmtTime(w.recordedAt)} · {w.recordedByName}</span></span>
                        <span style={{ color: "var(--danger)", fontWeight: 600, fontFamily: "var(--font-mono, monospace)", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>−{fmtMXNdec(w.amount)}</span>
                      </div>
                    ))}
                  </div>
                </CardNew>
              )}

              {/* ── Finanzas: ventas del turno + exportar ── */}
              <div style={{ marginTop: 18 }}>
                <CardNew noPad>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", padding: "14px 16px", borderBottom: "1px solid var(--border-soft)" }}>
                    {/* La lista es de TODO el turno (desde openedAt), no del día:
                     *  el título lo dice y muestra desde cuándo. */}
                    <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                      <span style={{ color: "var(--text-1)", fontSize: 14, fontWeight: 600 }}>{t("cashRegister.shiftSalesTitle")}</span>
                      <span style={{ color: "var(--text-3)", fontSize: 12 }}>
                        {t("cashRegister.shiftSalesSince", { date: fmtDateTime(reg.openedAt) })}
                      </span>
                    </div>
                    <ButtonNew variant="secondary" icon={<Download size={16} strokeWidth={1.75} />} onClick={downloadVentasCsv} disabled={caja.list.length === 0}>
                      Descargar Excel
                    </ButtonNew>
                  </div>
                  {caja.list.length === 0 ? (
                    <div style={{ padding: "40px 24px", textAlign: "center", color: "var(--text-3)", fontSize: 13 }}>
                      {t("cashRegister.emptyList")}
                    </div>
                  ) : (
                    <div style={{ overflowX: "auto" }}>
                      <table className="table-new">
                        <thead>
                          <tr>
                            <th>{listMultiDay ? t("cashRegister.thDateTime") : t("cashRegister.thTime")}</th>
                            <th>{t("cashRegister.thPatient")}</th>
                            <th>{t("cashRegister.thConcept")}</th>
                            <th>{t("cashRegister.thMethod")}</th>
                            <th style={{ textAlign: "right" }}>{t("cashRegister.thAmount")}</th>
                            <th style={{ textAlign: "right" }}>Descuento</th>
                            <th>{t("cashRegister.thDoctor")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {caja.list.map((r, i) => {
                            // Turno que cruza días: fila separadora al abrir cada día
                            // natural + fecha en la propia fila. La fecha va apilada
                            // sobre la hora, así la columna no se ensancha y la tabla
                            // no desborda en laptop. Turno de un día: nada de esto.
                            const k = dayKey(r.at);
                            const newDay = listMultiDay && (i === 0 || dayKey(caja.list[i - 1].at) !== k);
                            const agg = dayAgg.get(k);
                            return (
                              <React.Fragment key={r.paymentId}>
                                {newDay && (
                                  <tr>
                                    <td colSpan={7} style={{ background: "var(--bg-elev-2)", padding: "7px 14px" }}>
                                      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                                        <span style={{ color: "var(--text-2)", fontSize: 12, fontWeight: 600 }}>{fmtDayLong(r.at)}</span>
                                        {agg && (
                                          <span style={{ color: "var(--text-3)", fontSize: 11.5, fontVariantNumeric: "tabular-nums" }}>
                                            {t("cashRegister.dayGroupMeta", { count: agg.count, amount: fmtMXNdec(agg.total) })}
                                          </span>
                                        )}
                                      </div>
                                    </td>
                                  </tr>
                                )}
                                <tr>
                                  <td style={{ whiteSpace: "nowrap", color: "var(--text-3)" }}>
                                    {listMultiDay && (
                                      <span style={{ display: "block", fontSize: 11, opacity: 0.85 }}>{fmtDayShort(r.at)}</span>
                                    )}
                                    {fmtTime(r.at)}
                                  </td>
                                  <td style={{ color: "var(--text-1)" }}>{r.patientName}</td>
                                  <td style={{ color: "var(--text-2)" }}>{r.concept}</td>
                                  <td><BadgeNew tone={r.method === "cash" ? "success" : "info"}>{methodLabel(r.method)}</BadgeNew></td>
                                  <td style={{ textAlign: "right", fontWeight: 600, color: "var(--text-1)", whiteSpace: "nowrap", fontFamily: "var(--font-mono, monospace)", fontVariantNumeric: "tabular-nums" }}>{fmtMXNdec(r.amount)}</td>
                                  <td style={{ textAlign: "right", color: r.discount > 0 ? "var(--danger)" : "var(--text-3)", whiteSpace: "nowrap", fontFamily: "var(--font-mono, monospace)", fontVariantNumeric: "tabular-nums", fontWeight: r.discount > 0 ? 600 : 400 }}>{r.discount > 0 ? `−${fmtMXNdec(r.discount)}` : "—"}</td>
                                  <td style={{ color: "var(--text-2)" }}>{r.doctorName}</td>
                                </tr>
                              </React.Fragment>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </CardNew>
              </div>
            </>
          )}

          {/* Historial de cortes (colapsable) */}
          <div style={{ marginTop: 22 }}>
            <button type="button" onClick={() => setShowHistory(s => !s)}
              style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", cursor: "pointer", color: "var(--text-2)", fontSize: 13, fontWeight: 500, padding: "10px 4px", minHeight: 40, borderRadius: "var(--radius-sm)", transition: "color var(--dur-1) var(--ease)" }}>
              {showHistory ? <ChevronDown size={16} strokeWidth={1.75} /> : <ChevronRight size={16} strokeWidth={1.75} />}
              <History size={16} strokeWidth={1.75} /> {t("cashRegister.historyTitle")} ({history.length})
            </button>
            {showHistory && (
              <CardNew noPad>
                {history.length === 0 ? (
                  <div style={{ padding: "32px 24px", textAlign: "center", color: "var(--text-3)", fontSize: 13 }}>
                    {t("cashRegister.historyEmpty")}
                  </div>
                ) : (
                  <div style={{ overflowX: "auto" }}>
                    <table className="table-new">
                      <thead>
                        <tr>
                          <th>{t("cashRegister.thOpened")}</th>
                          <th>{t("cashRegister.thClosed")}</th>
                          <th>{t("cashRegister.thOperator")}</th>
                          <th style={{ textAlign: "right" }}>{t("cashRegister.kpiOpening")}</th>
                          <th style={{ textAlign: "right" }}>{t("cashRegister.thExpected")}</th>
                          <th style={{ textAlign: "right" }}>{t("cashRegister.thCounted")}</th>
                          <th style={{ textAlign: "right" }}>{t("cashRegister.thVariance")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {history.map(h => (
                          <tr key={h.id}>
                            <td style={{ whiteSpace: "nowrap", color: "var(--text-3)" }}>{fmtDateTime(h.openedAt)}</td>
                            <td style={{ whiteSpace: "nowrap", color: "var(--text-3)" }}>{h.closedAt ? fmtDateTime(h.closedAt) : "—"}</td>
                            <td style={{ color: "var(--text-2)" }}>{h.operatorName}</td>
                            <td style={{ textAlign: "right", whiteSpace: "nowrap", fontFamily: "var(--font-mono, monospace)", fontVariantNumeric: "tabular-nums" }}>{fmtMXNdec(h.openingBalance)}</td>
                            <td style={{ textAlign: "right", whiteSpace: "nowrap", fontFamily: "var(--font-mono, monospace)", fontVariantNumeric: "tabular-nums" }}>{h.expectedCash == null ? "—" : fmtMXNdec(h.expectedCash)}</td>
                            <td style={{ textAlign: "right", whiteSpace: "nowrap", fontFamily: "var(--font-mono, monospace)", fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{h.countedClosingBalance == null ? "—" : fmtMXNdec(h.countedClosingBalance)}</td>
                            <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                              {h.variance == null ? "—" : <BadgeNew tone={varianceTone(h.variance)}>{fmtMXNdec(h.variance)}</BadgeNew>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardNew>
            )}
          </div>
        </div>
      )}

      {/* ── Modal: Abrir caja (PIN + apertura sugerida + retiro inicial) ── */}
      {showOpen && (
        <div className="modal-overlay" onClick={() => setShowOpen(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal__header">
              <div className="modal__title">{t("cashRegister.openTitle")}</div>
              <button onClick={() => setShowOpen(false)} type="button" className="btn-new btn-new--ghost btn-new--sm" aria-label={t("common.close")}><X size={16} strokeWidth={1.75} /></button>
            </div>
            <form onSubmit={e => { e.preventDefault(); openRegister(); }}>
              <div className="modal__body">
                {/* PIN de Caja */}
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, color: "var(--text-2)", fontSize: 13, fontWeight: 600 }}>
                  <KeyRound size={16} strokeWidth={1.75} style={{ color: "var(--brand)" }} /> {hasPin ? "Ingresa tu PIN de Caja" : "Crea tu PIN de 6 dígitos"}
                </div>
                {!hasPin && (
                  <p style={{ color: "var(--text-3)", fontSize: 12, margin: "0 0 12px" }}>
                    Este PIN protege la apertura y el cierre de Caja. Guárdalo: lo pediremos en cada corte.
                  </p>
                )}
                <div className="field-new" style={{ marginBottom: 14 }}>
                  <label className="field-new__label">PIN <span className="req">*</span></label>
                  <input type="password" inputMode="numeric" pattern="\d{6}" maxLength={6} className="input-new" autoFocus
                    style={{ fontFamily: "var(--font-mono, monospace)", fontVariantNumeric: "tabular-nums", letterSpacing: "0.25em", textAlign: "center", fontSize: 14 }}
                    placeholder="••••••" value={openPin}
                    onChange={e => setOpenPin(e.target.value.replace(/\D/g, "").slice(0, 6))} />
                </div>
                {!hasPin && (
                  <div className="field-new" style={{ marginBottom: 14 }}>
                    <label className="field-new__label">Confirma tu PIN <span className="req">*</span></label>
                    <input type="password" inputMode="numeric" pattern="\d{6}" maxLength={6} className="input-new"
                      style={{ fontFamily: "var(--font-mono, monospace)", fontVariantNumeric: "tabular-nums", letterSpacing: "0.25em", textAlign: "center", fontSize: 14 }}
                      placeholder="••••••" value={openPinConfirm}
                      onChange={e => setOpenPinConfirm(e.target.value.replace(/\D/g, "").slice(0, 6))} />
                  </div>
                )}

                <div className="field-new" style={{ marginBottom: 14 }}>
                  <label className="field-new__label">{t("cashRegister.openingBalanceLabel")}</label>
                  <input type="number" min={0} step="0.01" className="input-new" placeholder="0.00"
                    value={openingBalance} onChange={e => setOpeningBalance(e.target.value)} />
                  <span style={{ color: "var(--text-3)", fontSize: 12, marginTop: 4 }}>
                    Sugerido por el efectivo de hoy aún no cuadrado:{" "}
                    <span style={{ fontFamily: "var(--font-mono, monospace)", fontVariantNumeric: "tabular-nums", fontWeight: 600, color: "var(--text-2)" }}>{fmtMXNdec(caja.suggestedOpening)}</span>
                  </span>
                </div>

                {/* Retiro inicial opcional */}
                <div className="field-new" style={{ marginBottom: 10 }}>
                  <label className="field-new__label">Retiro inicial (opcional)</label>
                  <input type="number" min={0} step="0.01" className="input-new" placeholder="0.00"
                    value={openWAmount} onChange={e => setOpenWAmount(e.target.value)} />
                </div>
                {parseFloat(openWAmount) > 0 && (
                  <div className="field-new">
                    <label className="field-new__label">Motivo del retiro</label>
                    <input className="input-new" placeholder={t("cashRegister.reasonPlaceholder")}
                      value={openWReason} onChange={e => setOpenWReason(e.target.value)} />
                  </div>
                )}
              </div>
              <div className="modal__footer">
                <ButtonNew variant="ghost" type="button" onClick={() => setShowOpen(false)}>{t("common.cancel")}</ButtonNew>
                <ButtonNew variant="primary" type="submit" disabled={busy}>{t("cashRegister.openSubmit")}</ButtonNew>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Modal: Registrar retiro ── */}
      {showWithdrawal && (
        <div className="modal-overlay" onClick={() => setShowWithdrawal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal__header">
              <div className="modal__title">{t("cashRegister.withdrawalTitle")}</div>
              <button onClick={() => setShowWithdrawal(false)} type="button" className="btn-new btn-new--ghost btn-new--sm" aria-label={t("common.close")}><X size={16} strokeWidth={1.75} /></button>
            </div>
            <form onSubmit={e => { e.preventDefault(); recordWithdrawal(); }}>
              <div className="modal__body">
                <div className="field-new" style={{ marginBottom: 14 }}>
                  <label className="field-new__label">{t("cashRegister.amountLabel")} <span className="req">*</span></label>
                  <input type="number" min={0} step="0.01" className="input-new" autoFocus placeholder="0.00"
                    value={wAmount} onChange={e => setWAmount(e.target.value)} />
                </div>
                <div className="field-new" style={{ marginBottom: 14 }}>
                  <label className="field-new__label">{t("cashRegister.reasonLabel")} <span className="req">*</span></label>
                  <input className="input-new" placeholder={t("cashRegister.reasonPlaceholder")}
                    value={wReason} onChange={e => setWReason(e.target.value)} />
                </div>
                {/* FIN-07: el mismo PIN que pide el cierre. Sacar efectivo de la
                    caja tiene que costar lo mismo que cuadrarla. */}
                <div className="field-new">
                  <label className="field-new__label" style={{ display: "flex", alignItems: "center", gap: 6 }}><KeyRound size={13} strokeWidth={1.75} /> PIN de Caja <span className="req">*</span></label>
                  <input type="password" inputMode="numeric" pattern="\d{6}" maxLength={6} className="input-new"
                    style={{ fontFamily: "var(--font-mono, monospace)", fontVariantNumeric: "tabular-nums", letterSpacing: "0.25em", textAlign: "center", fontSize: 14 }}
                    placeholder="••••••" value={wPin}
                    onChange={e => setWPin(e.target.value.replace(/\D/g, "").slice(0, 6))} />
                </div>
              </div>
              <div className="modal__footer">
                <ButtonNew variant="ghost" type="button" onClick={() => setShowWithdrawal(false)}>{t("common.cancel")}</ButtonNew>
                <ButtonNew variant="primary" type="submit" disabled={busy}>{t("cashRegister.withdrawalSubmit")}</ButtonNew>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Modal: Cerrar caja (corte con desglose + PIN) ── */}
      {showClose && totals && (
        <div className="modal-overlay" onClick={() => setShowClose(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal__header">
              <div className="modal__title">{t("cashRegister.closeTitle")}</div>
              <button onClick={() => setShowClose(false)} type="button" className="btn-new btn-new--ghost btn-new--sm" aria-label={t("common.close")}><X size={16} strokeWidth={1.75} /></button>
            </div>
            <form onSubmit={e => { e.preventDefault(); closeRegister(); }}>
              <div className="modal__body">
                {/* Desglose del corte */}
                <div style={{ display: "flex", flexDirection: "column", gap: 2, background: "var(--bg-elev-2)", border: "1px solid var(--border-soft)", borderRadius: "var(--radius)", padding: "8px 12px", marginBottom: 14 }}>
                  <CloseLine label={t("cashRegister.kpiOpening")}   value={fmtMXNdec(totals.openingBalance)} />
                  <CloseLine label={t("cashRegister.methodCash")}   value={fmtMXNdec(totals.cashIncome)} />
                  <CloseLine label={t("cashRegister.methodDebit")}  value={fmtMXNdec(totals.cardDebitIncome)} />
                  <CloseLine label={t("cashRegister.methodCredit")} value={fmtMXNdec(totals.cardCreditIncome)} />
                  <CloseLine label={t("cashRegister.kpiTax")}       value={fmtMXNdec(totals.tax)} />
                  <CloseLine label={t("cashRegister.kpiWithdrawals")} value={`−${fmtMXNdec(totals.withdrawals)}`} />
                  <CloseLine label={t("cashRegister.kpiIncome")}    value={fmtMXNdec(totals.totalIncome)} strong />
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "10px 12px", background: "var(--brand-softer)", border: "1px solid var(--border-soft)", borderRadius: "var(--radius)", marginBottom: 14 }}>
                  <span style={{ color: "var(--text-2)", fontSize: 13, fontWeight: 600 }}>{t("cashRegister.expectedCashLabel")}</span>
                  <span style={{ color: "var(--text-1)", fontWeight: 700, fontSize: 16, fontFamily: "var(--font-mono, monospace)", fontVariantNumeric: "tabular-nums" }}>{fmtMXNdec(totals.expectedCash)}</span>
                </div>
                <div className="field-new" style={{ marginBottom: 14 }}>
                  <label className="field-new__label">{t("cashRegister.countedLabel")} <span className="req">*</span></label>
                  <input type="number" min={0} step="0.01" className="input-new" autoFocus placeholder="0.00"
                    value={counted} onChange={e => setCounted(e.target.value)} />
                  <span style={{ color: "var(--text-3)", fontSize: 12, marginTop: 4 }}>{t("cashRegister.countedHint")}</span>
                </div>
                {liveVariance !== null && (
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                    <span style={{ color: "var(--text-2)", fontSize: 13 }}>{t("cashRegister.varianceLabel")}</span>
                    <BadgeNew tone={varianceTone(liveVariance)}>{fmtMXNdec(liveVariance)}</BadgeNew>
                  </div>
                )}
                <div className="field-new" style={{ marginBottom: 14 }}>
                  <label className="field-new__label">{t("cashRegister.notesLabel")}</label>
                  <input className="input-new" placeholder={t("cashRegister.notesPlaceholder")}
                    value={closingNotes} onChange={e => setClosingNotes(e.target.value)} />
                </div>
                <div className="field-new">
                  <label className="field-new__label" style={{ display: "flex", alignItems: "center", gap: 6 }}><KeyRound size={13} strokeWidth={1.75} /> PIN de Caja <span className="req">*</span></label>
                  <input type="password" inputMode="numeric" pattern="\d{6}" maxLength={6} className="input-new"
                    style={{ fontFamily: "var(--font-mono, monospace)", fontVariantNumeric: "tabular-nums", letterSpacing: "0.25em", textAlign: "center", fontSize: 14 }}
                    placeholder="••••••" value={closePin}
                    onChange={e => setClosePin(e.target.value.replace(/\D/g, "").slice(0, 6))} />
                </div>
              </div>
              <div className="modal__footer">
                <ButtonNew variant="ghost" type="button" onClick={() => setShowClose(false)}>{t("common.cancel")}</ButtonNew>
                <ButtonNew variant="primary" type="submit" disabled={busy}>{t("cashRegister.closeSubmit")}</ButtonNew>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Modal: Resumen del corte (post-cierre) ── */}
      {summary && (
        <div className="modal-overlay" onClick={() => setSummary(null)}>
          <div className="modal modal--wide" onClick={e => e.stopPropagation()}>
            <div className="modal__header">
              <div className="modal__title">{t("cashRegister.summaryTitle")}</div>
              <button onClick={() => setSummary(null)} type="button" className="btn-new btn-new--ghost btn-new--sm" aria-label={t("common.close")}><X size={16} strokeWidth={1.75} /></button>
            </div>
            <div className="modal__body">
              <div style={{ color: "var(--text-3)", fontSize: 12.5, marginBottom: 14 }}>
                {fmtDateTime(summary.openedAt)} → {fmtDateTime(summary.closedAt)}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10, marginBottom: 18 }}>
                <SumRow label={t("cashRegister.kpiOpening")}      value={fmtMXNdec(summary.openingBalance)} />
                <SumRow label={t("cashRegister.kpiIncome")}       value={fmtMXNdec(summary.totalIncome)} />
                <SumRow label={t("cashRegister.methodCash")}      value={fmtMXNdec(summary.cashIncome)} />
                <SumRow label={t("cashRegister.methodDebit")}     value={fmtMXNdec(summary.cardDebitIncome)} />
                <SumRow label={t("cashRegister.methodCredit")}    value={fmtMXNdec(summary.cardCreditIncome)} />
                <SumRow label={t("cashRegister.kpiDiscounts")}    value={fmtMXNdec(summary.discounts)} />
                <SumRow label={t("cashRegister.kpiTax")}          value={fmtMXNdec(summary.tax)} />
                <SumRow label={t("cashRegister.kpiWithdrawals")}  value={fmtMXNdec(summary.withdrawals)} />
                <SumRow label={t("cashRegister.expectedCashLabel")} value={fmtMXNdec(summary.expectedCash)} strong />
                <SumRow label={t("cashRegister.countedLabel")}    value={fmtMXNdec(summary.counted)} strong />
                <SumRow label={t("cashRegister.varianceLabel")}   value={fmtMXNdec(summary.variance)} strong />
              </div>
              {summary.list.length > 0 && (
                <div style={{ overflowX: "auto" }}>
                  <table className="table-new">
                    <thead>
                      <tr>
                        <th>{summaryMultiDay ? t("cashRegister.thDateTime") : t("cashRegister.thTime")}</th><th>{t("cashRegister.thPatient")}</th><th>{t("cashRegister.thConcept")}</th>
                        <th style={{ textAlign: "right" }}>{t("cashRegister.thAmount")}</th><th>{t("cashRegister.thMethod")}</th><th>{t("cashRegister.thDoctor")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.list.map(r => (
                        <tr key={r.paymentId}>
                          {/* Mismo criterio que la tabla del turno: la fecha solo
                            * aparece si el corte abarcó más de un día natural. */}
                          <td style={{ whiteSpace: "nowrap", color: "var(--text-3)" }}>
                            {summaryMultiDay && (
                              <span style={{ display: "block", fontSize: 11, opacity: 0.85 }}>{fmtDayShort(r.at)}</span>
                            )}
                            {fmtTime(r.at)}
                          </td>
                          <td>{r.patientName}</td>
                          <td style={{ color: "var(--text-2)" }}>{r.concept}</td>
                          <td style={{ textAlign: "right", fontWeight: 600, whiteSpace: "nowrap", fontFamily: "var(--font-mono, monospace)", fontVariantNumeric: "tabular-nums" }}>{fmtMXNdec(r.amount)}</td>
                          <td>{methodLabel(r.method)}</td>
                          <td style={{ color: "var(--text-2)" }}>{r.doctorName}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            <div className="modal__footer">
              <ButtonNew variant="secondary" type="button" icon={<Printer size={16} strokeWidth={1.75} />} onClick={() => printSummary(summary)}>
                {t("cashRegister.print")}
              </ButtonNew>
              <ButtonNew variant="primary" type="button" onClick={() => setSummary(null)}>{t("common.close")}</ButtonNew>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SumRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "8px 10px", background: "var(--bg-elev-2)", border: "1px solid var(--border-soft)", borderRadius: "var(--radius-sm)" }}>
      <span style={{ color: "var(--text-3)", fontSize: 12.5 }}>{label}</span>
      <span style={{ color: "var(--text-1)", fontWeight: strong ? 700 : 600, fontSize: strong ? 14.5 : 13, fontFamily: "var(--font-mono, monospace)", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{value}</span>
    </div>
  );
}

function CloseLine({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: strong ? "7px 0 5px" : "5px 0", borderTop: strong ? "1px solid var(--border-soft)" : "none", marginTop: strong ? 4 : 0 }}>
      <span style={{ color: "var(--text-2)", fontSize: 12.5, fontWeight: strong ? 600 : 400 }}>{label}</span>
      <span style={{ color: "var(--text-1)", fontWeight: strong ? 700 : 600, fontSize: strong ? 14 : 13, fontFamily: "var(--font-mono, monospace)", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{value}</span>
    </div>
  );
}

function esc(s: string): string {
  return String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
}
