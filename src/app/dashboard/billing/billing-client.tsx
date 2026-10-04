"use client";
import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Plus, CheckCircle2, Clock, AlertCircle, FileText, Search, X, Wallet,
} from "lucide-react";
import { KpiCard }   from "@/components/ui/design-system/kpi-card";
import { CardNew }   from "@/components/ui/design-system/card-new";
import { BadgeNew }  from "@/components/ui/design-system/badge-new";
import { AvatarNew } from "@/components/ui/design-system/avatar-new";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { fmtMXN, fmtMXNdec, formatRelativeDate } from "@/lib/format";
import { InvoiceDetailModal } from "@/components/dashboard/billing/invoice-detail-modal";
import { InvoiceCfdiBadge } from "@/components/dashboard/billing/invoice-cfdi-badge";
import { invoiceStatusBadge, isVoidedInvoice } from "@/components/dashboard/billing/invoice-status";
import { InvoiceEditorModal } from "@/components/billing/invoice-editor-modal";
import { useT, useLocale } from "@/i18n/i18n-provider";
import { QueCuenta, useQueCuenta } from "@/components/dashboard/que-cuenta";
import { montoSugeridoDeCobro } from "@/lib/invoices/plan-de-pagos";
import type { CondicionesPago } from "@/lib/quotes/condiciones-pago";
import { todayLocalISO } from "@/lib/billing/paid-at";
// La ficha de factura del diseño nuevo (solo con `rediseno`): lo bueno de
// Presupuestos. Ver components/dashboard/factura-ficha-rediseno/.
import { FichasFactura } from "@/components/dashboard/factura-ficha-rediseno/fichas-factura";
import { borradorDesdeFactura, type BorradorDeFactura } from "@/components/dashboard/factura-ficha-rediseno/datos";

// Mapa de estados de factura → fuente única invoice-status.ts, compartida con
// la ficha del paciente y el modal de detalle (la divergencia entre copias
// locales fue el origen del bug MF-0151).

const STATUS_FILTERS = [
  { value: "all",      labelKey: "billing.billingClient.filterAll" },
  { value: "pending",  labelKey: "billing.billingClient.filterPending" },
  { value: "paid",     labelKey: "billing.billingClient.filterPaid" },
  { value: "overdue",  labelKey: "billing.billingClient.filterOverdue" },
  { value: "draft",    labelKey: "billing.billingClient.filterDraft" },
];

interface Props {
  invoices:      any[];
  patients:      any[];
  totalPaid:     number;
  /** ws1-t2: lo pagado antes de DaleControl (historia migrada), ya restado de `totalPaid`. */
  historiaMigrada?: number;
  totalPending:  number;
  totalOverdue:  number;
  monthInvoices: number;
  /** Facturas de la clínica en TOTAL: `invoices` trae solo las 100 más recientes. */
  totalInvoices?: number;
  /**
   * Lo vencido de cada factura que tiene algo vencido (`invoiceId` → pesos), de
   * `computeReceivables` (src/lib/caja.ts): la MISMA cuenta del KPI «Vencido».
   * Cubre TODAS las facturas por cobrar de la clínica, no solo las 100 de la
   * lista, así que también sirve para los resultados de la búsqueda remota.
   */
  overdueByInvoice?: Record<string, number>;
  /** true = `computeReceivables` tocó su techo de lectura: KPIs parciales. */
  receivablesIncompleto?: boolean;
  /** Saldo a favor total de la clínica (SUM patient_credits). 0 si no hay. */
  creditTotal?:  number;
  clinic:        { facturApiEnabled: boolean; rfcEmisor: string | null; cfdiTaxMode?: string | null };
  /** true = FACTURAPI_ENV=live → el timbrado va al SAT con validez fiscal. */
  cfdiLive?:     boolean;
  /** Interruptor `menu-dos-niveles` (lo pasa Caja): viste el detalle de factura,
   *  Registrar pago y Nueva factura con el diseño nuevo. Apagado, todo igual. */
  rediseno?:     boolean;
  /** ws1-t4: la sesión tiene billing.edit — «Editar» abre el editor de la factura. */
  puedeEditarFacturas?: boolean;
}

function patientNameOf(inv: any): string {
  return `${inv.patient?.firstName ?? ""} ${inv.patient?.lastName ?? ""}`.trim() || "—";
}

export function BillingClient({ invoices: initial, patients, totalPaid, historiaMigrada = 0, totalPending, totalOverdue, monthInvoices, totalInvoices, overdueByInvoice, receivablesIncompleto = false, creditTotal = 0, clinic, cfdiLive = false, rediseno = false, puedeEditarFacturas = false }: Props) {
  const t = useT();
  const qc = useQueCuenta();
  const locale = useLocale();
  const router = useRouter();
  const [invoices, setInvoices] = useState(initial);
  const [search, setSearch]     = useState("");
  const [status, setStatus]     = useState<string>("all");

  // Sync local state cuando router.refresh() trae props nuevos del server.
  // useState(initial) solo toma el valor en mount, así que sin esto las
  // mutaciones pierden la actualización después de un router.refresh().
  useEffect(() => { setInvoices(initial); }, [initial]);

  // Búsqueda en TODA la clínica (FIN-04). El servidor manda solo las 100
  // facturas más recientes; filtrar sobre ellas contestaba "Sin resultados" a
  // un folio viejo que sí existe. Con texto en el buscador se consulta
  // GET /api/invoices (search + paginación de 20); sin texto, la lista local.
  // El filtro «Vencidas» también va al servidor (`status=overdue`): allá se
  // decide con `computeReceivables` sobre TODAS las facturas de la clínica, no
  // sobre las 100 cargadas. Si el servidor falla se vuelve al filtro local.
  const [remote, setRemote] = useState<{
    invoices: any[]; total: number; page: number; limit: number;
    /** true = la lista ya viene filtrada a «Vencidas» por el servidor. */
    vencidas: boolean;
    /** Lo vencido de cada fila devuelta (solo con `vencidas`). */
    overdueByInvoice?: Record<string, number>;
  } | null>(null);
  const [page, setPage]           = useState(1);
  const [searching, setSearching] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);
  useEffect(() => {
    const q = search.trim();
    const vencidas = status === "overdue";
    if (!q && !vencidas) { setRemote(null); setSearching(false); return; }
    const ctrl = new AbortController();
    setSearching(true);
    const params = new URLSearchParams({ page: String(page) });
    if (q) params.set("search", q);
    if (vencidas) params.set("status", "overdue");
    const timer = setTimeout(() => {
      fetch(`/api/invoices?${params.toString()}`, { signal: ctrl.signal })
        .then(async (res) => {
          if (!res.ok) throw new Error(String(res.status));
          const data = await res.json();
          setRemote({
            invoices: Array.isArray(data.invoices) ? data.invoices : [],
            total:    Number(data.total) || 0,
            page:     Number(data.page)  || 1,
            limit:    Number(data.limit) || 20,
            vencidas,
            overdueByInvoice: data.overdueByInvoice && typeof data.overdueByInvoice === "object" ? data.overdueByInvoice : undefined,
          });
          setSearching(false);
        })
        .catch((err) => {
          if (err?.name === "AbortError") return;
          setRemote(null);
          setSearching(false);
        });
    }, 300);
    return () => { clearTimeout(timer); ctrl.abort(); };
  }, [search, status, page, refreshTick]);

  // Vencida = tiene algo vencido según `computeReceivables` (fila 87): a plazos,
  // si alguna cuota ya pasó sin pagarse; un cargo de control de ortodoncia,
  // según su vencimiento; de un solo pago, por `dueDate`. El mismo criterio que
  // el KPI «Vencido» de arriba — aquí no se vuelve a decidir. NUNCA por status
  // OVERDUE: nadie lo escribe. Sin el mapa del servidor no se marca nada.
  // Una fila que llegó por el filtro «Vencidas» del servidor trae su propio
  // vencido (misma función), por si es más nueva que el mapa de la página.
  const overdueAmount = (inv: any): number =>
    overdueByInvoice?.[inv?.id] ?? remote?.overdueByInvoice?.[inv?.id] ?? 0;
  const isOverdue = (inv: any) => overdueAmount(inv) > 0;

  // Modals
  const [showNew, setShowNew]                     = useState(false);
  const [detailInvoice, setDetailInvoice]         = useState<any | null>(null);
  // ws1-t4: «Registrar pago» de la fila abre la ventana COMPLETA de la factura
  // (el detalle de arriba) con el pago ya abierto — antes, la de cobro suelta.
  // `null` = se abrió el detalle con un clic en la fila (sin cobro). Un número
  // = se abrió para cobrar, con ese monto sugerido. ws1-t10 (H68): la
  // mensualidad o lo vencido, si es a plazos — 0 (saldo completo) si no.
  const [cobroMontoSugerido, setCobroMontoSugerido] = useState<number | null>(null);
  // ws1-t4: «Editar» (tarjeta o detalle) de un borrador sin pagos → el EDITOR.
  const [editando, setEditando] = useState<any | null>(null);
  function abrirCobroDeFila(inv: any, condiciones: CondicionesPago | null) {
    setCobroMontoSugerido(montoSugeridoDeCobro(condiciones, inv.total, inv.paid, todayLocalISO()));
    setDetailInvoice(inv);
  }
  // C-45 (auditoría de uso): «Timbrar» abre el formulario del detalle de la factura.
  const [abrirTimbrado, setAbrirTimbrado] = useState(false);
  // «Duplicar» de la ficha (solo diseño nuevo): Nueva factura abre con el mismo
  // paciente, los mismos conceptos y el mismo trato. Apagado, siempre null.
  const [duplicar, setDuplicar] = useState<{ patientId: string; patientName: string; borrador: BorradorDeFactura } | null>(null);

  // C-45 (auditoría de uso, ws1-t4): «Timbrar» ya no tiene formulario propio. Abre el del
  // DETALLE de la factura, el único: mismos valores por defecto, «Paciente extranjero»,
  // aviso del mes de cobro y de la global antes de timbrar, y un diálogo que cierra con Escape.
  function openCfdiModal(inv: any) {
    setCobroMontoSugerido(null);
    setAbrirTimbrado(true);
    setDetailInvoice(inv);
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    // Con resultados del servidor, el texto ya se filtró allá (folio, nombre o
    // apellido); aquí solo se aplica el segmento de estado.
    const source: any[] = remote ? remote.invoices : invoices;
    return source.filter(inv => {
      if (status !== "all") {
        const match =
          status === "pending" ? ["PENDING", "PARTIAL"].includes(inv.status) :
          status === "paid"    ? inv.status === "PAID" :
          // Con `remote.vencidas` el servidor ya filtró con la misma regla.
          status === "overdue" ? (remote?.vencidas ? true : isOverdue(inv)) :
          status === "draft"   ? inv.status === "DRAFT" : true;
        if (!match) return false;
      }
      if (!q || remote) return true;
      const name = `${inv.patient?.firstName ?? ""} ${inv.patient?.lastName ?? ""}`.toLowerCase();
      return name.includes(q) || (inv.invoiceNumber ?? "").toLowerCase().includes(q);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoices, remote, search, status, overdueByInvoice]);

  // Refresh tras una mutación de factura. router.refresh() re-corre el server
  // component con los revalidatePath que dispararon los endpoints; el
  // useEffect arriba propaga el prop nuevo al state local. Si hay una búsqueda
  // en curso, también se vuelve a pedir al servidor (la fila mutada puede
  // estar solo en los resultados remotos).
  function refresh() {
    router.refresh();
    setRefreshTick(n => n + 1);
  }

  // ws1-t10 (H68): tabla vieja (sin `menu-dos-niveles`) — sin las condiciones
  // ya cargadas por `FichasFactura`, se leen aquí ANTES de abrir el cobro
  // para que el campo no nazca en el saldo completo de una factura a plazos.
  async function openPaymentForRow(e: React.MouseEvent, inv: any) {
    e.stopPropagation();  // el clic es «Registrar pago», no el de la fila
    const condiciones = await fetch(`/api/invoices/condiciones?ids=${encodeURIComponent(inv.id)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d?.condiciones?.[inv.id] ?? null)
      .catch(() => null);
    abrirCobroDeFila(inv, condiciones);
  }

  return (
    <div style={{ padding: "clamp(14px, 1.6vw, 28px)", maxWidth: 1400, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 22, gap: 24, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: "clamp(16px, 1.4vw, 22px)", letterSpacing: "-0.02em", color: "var(--text-1)", fontWeight: 600, margin: 0 }}>{t("billing.billingClient.title")}</h1>
          <p style={{ color: "var(--text-3)", fontSize: 13, marginTop: 4 }}>
            {t("billing.billingClient.subtitle", { count: totalInvoices ?? invoices.length })}
          </p>
        </div>
        <ButtonNew variant="primary" icon={<Plus size={14} />} onClick={() => setShowNew(true)}>
          {t("billing.billingClient.newInvoice")}
        </ButtonNew>
      </div>

      {/* KPIs */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 14, marginBottom: 20 }}>
        {/* ws1-t2 (auditoría de uso C-21, C-23): cada cifra dice qué cuenta. «Pagado en facturas» no es
            el ingreso de un periodo (ese vive en Finanzas) y «Facturas del mes» es la «Ventas» de Finanzas. */}
        <KpiCard label={t("billing.billingClient.kpiTotalCollected")} value={fmtMXN(totalPaid)}       icon={CheckCircle2} hint={qc("cajaPagado")} />
        <KpiCard label={t("billing.billingClient.kpiToCollect")}      value={fmtMXN(totalPending)}    icon={Clock} hint={qc("porCobrar")} />
        <KpiCard label={t("billing.billingClient.kpiOverdue")}        value={fmtMXN(totalOverdue)}    icon={AlertCircle} hint={qc("cajaVencido")} />
        <KpiCard label={t("billing.billingClient.kpiThisMonth")}      value={String(monthInvoices)}   icon={FileText} hint={qc("cajaFacturasMes")} />
        {creditTotal > 0 && (
          <KpiCard label={t("billing.billingClient.kpiCredit")}       value={fmtMXN(creditTotal)}     icon={Wallet} />
        )}
      </div>
      {/* ws1-t2: «Total cobrado» es lo cobrado en DaleControl; la historia migrada va aparte. */}
      {historiaMigrada > 0 && (
        <p style={{ margin: "-10px 0 16px", fontSize: 12, color: "var(--text-3)" }}>
          <QueCuenta clave="cajaHistoriaMigrada" vars={{ monto: fmtMXN(historiaMigrada) }} />
        </p>
      )}
      {receivablesIncompleto && (
        <p style={{ margin: "-10px 0 16px", fontSize: 12, color: "var(--text-3)" }}>
          {t("billing.billingClient.partialReceivables")}
        </p>
      )}

      {/* Filters */}
      <div style={{ display: "flex", gap: 8, marginBottom: 18, flexWrap: "wrap", alignItems: "center" }}>
        <div className="search-field">
          <Search size={14} />
          <input
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
            placeholder={t("billing.billingClient.searchPlaceholder")}
          />
        </div>
        {(search.trim() || status === "overdue") && (
          <span style={{ color: "var(--text-3)", fontSize: 12 }} aria-live="polite">
            {searching
              ? t("billing.billingClient.searching")
              : remote
                ? t("billing.billingClient.searchResults", { count: remote.total })
                : null}
          </span>
        )}
        {/* En móvil (390 px) los cinco botones miden 461 px: el segmentado se desliza POR SU CUENTA (scroll propio)
            y no empuja la página entera hacia los lados. */}
        <div
          className="segment-new"
          style={{ maxWidth: "100%", minWidth: 0, overflowX: "auto", overscrollBehaviorX: "contain", scrollbarWidth: "none" }}
        >
          {STATUS_FILTERS.map(f => (
            <button
              key={f.value}
              type="button"
              onClick={() => { setStatus(f.value); setPage(1); }}
              className={`segment-new__btn ${status === f.value ? "segment-new__btn--active" : ""}`}
              style={{ flexShrink: 0, whiteSpace: "nowrap" }}
            >
              {t(f.labelKey)}
            </button>
          ))}
        </div>
      </div>

      {/* Diseño nuevo: cada factura es una FICHA como la de presupuesto (folio,
          chips, importe grande, la frase del trato y las acciones). Mismos
          callbacks que la tabla de abajo, que sigue siendo la de siempre. */}
      {rediseno ? (
        <FichasFactura
          facturas={filtered}
          facturApiEnabled={clinic.facturApiEnabled}
          conPaciente
          estaVencida={isOverdue}
          montoVencido={overdueAmount}
          // Las dos reglas de la tabla de abajo, tal cual: `canPay` y «Timbrar».
          // H9 (revisión final, ws1-t4): una CANCELADA no se timbra — ni aquí ni
          // en la tabla; el servidor (POST /api/cfdi) ya la rechazaba.
          puedeCobrar={(inv) => !["PAID", "CANCELLED"].includes(inv.status) && inv.status !== "DRAFT"}
          // C-53: «Timbrar» solo en notas con algo cobrado (con $0 no hay nada que facturar).
          puedeTimbrar={(inv) => !isVoidedInvoice(inv) && (Number(inv.paid) || 0) > 0.005}
          textoCobrar={t("billing.billingClient.registerPayment")}
          textoVacio={invoices.length === 0 ? t("billing.billingClient.emptyNoInvoices") : t("billing.billingClient.emptyNoResults")}
          onAbrir={(inv) => { setCobroMontoSugerido(null); setDetailInvoice(inv); }}
          onEditar={(inv) => setEditando(inv)}
          puedeEditar={puedeEditarFacturas}
          onCobrar={(inv, condiciones) => abrirCobroDeFila(inv, condiciones)}
          onTimbrar={(inv) => openCfdiModal(inv)}
          onDuplicar={(inv, condiciones) => {
            setDuplicar({
              patientId: inv.patientId ?? inv.patient?.id ?? "",
              patientName: patientNameOf(inv),
              borrador: borradorDesdeFactura(inv, condiciones),
            });
            setShowNew(true);
          }}
        />
      ) : (
      <CardNew noPad>
        {filtered.length === 0 ? (
          <div style={{ padding: "48px 24px", textAlign: "center", color: "var(--text-3)", fontSize: 13 }}>
            {invoices.length === 0 ? t("billing.billingClient.emptyNoInvoices") : t("billing.billingClient.emptyNoResults")}
          </div>
        ) : (
          // La tabla tiene 9 columnas: su min-content (~1150px) no cabe en el
          // ancho util del panel a 1280 (1031px). `.card` (CardNew) trae
          // overflow:hidden, asi que sin este envoltorio las columnas de CFDI y
          // accion se recortaban sin barra para alcanzarlas. Mismo patron que
          // src/app/dashboard/compras/[orderId]/page.tsx.
          <div style={{ overflowX: "auto" }}>
            <table className="table-new">
              <thead>
                <tr>
                  <th>{t("billing.billingClient.thFolio")}</th>
                  <th>{t("billing.billingClient.thPatient")}</th>
                  <th>{t("common.date")}</th>
                  <th style={{ textAlign: "right" }}>{t("common.total")}</th>
                  <th style={{ textAlign: "right" }}>{t("billing.billingClient.thPaid")}</th>
                  <th style={{ textAlign: "right" }}>{t("billing.billingClient.thBalance")}</th>
                  <th>{t("common.status")}</th>
                  <th>{t("billing.billingClient.thCfdi")}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(inv => {
                  // La píldora dice "Vencido" cuando la factura LO ESTÁ (`isOverdue`:
                  // la regla de `computeReceivables`), aunque su status siga en
                  // PENDING/PARTIAL.
                  const badge = invoiceStatusBadge(isOverdue(inv) ? "OVERDUE" : inv.status);
                  const fullName = patientNameOf(inv);
                  const isDraft = inv.status === "DRAFT";
                  const canPay  = !["PAID", "CANCELLED"].includes(inv.status) && !isDraft;
                  return (
                    <tr
                      key={inv.id}
                      onClick={() => { setCobroMontoSugerido(null); setDetailInvoice(inv); }}
                      style={{ cursor: "pointer" }}
                    >
                      <td className="mono" style={{ color: "var(--text-2)" }}>
                        {isDraft && "📝 "}{inv.invoiceNumber}
                      </td>
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <AvatarNew name={fullName} size="sm" />
                          <span style={{ color: "var(--text-1)" }}>{fullName}</span>
                        </div>
                      </td>
                      <td className="mono" style={{ color: "var(--text-2)" }}>
                        {formatRelativeDate(inv.createdAt)}
                      </td>
                      <td className="mono" style={{ textAlign: "right", color: "var(--text-1)" }}>
                        {fmtMXNdec(inv.total)}
                      </td>
                      <td className="mono" style={{ textAlign: "right", color: "var(--success)" }}>
                        {fmtMXNdec(inv.paid)}
                      </td>
                      <td className="mono" style={{ textAlign: "right", color: inv.balance > 0 ? "var(--warning)" : "var(--text-3)" }}>
                        {fmtMXNdec(inv.balance)}
                        {overdueAmount(inv) > 0 && (
                          <div style={{ fontSize: 11, color: "var(--danger)" }}>
                            {t(badge.labelKey)} {fmtMXNdec(overdueAmount(inv))}
                          </div>
                        )}
                      </td>
                      <td>
                        <BadgeNew tone={badge.tone} dot>{t(badge.labelKey)}</BadgeNew>
                      </td>
                      <td onClick={(e) => e.stopPropagation()}>
                        {/* Indicador compartido con la ficha del paciente — ver
                            invoice-cfdi-badge.tsx (mismo badge/botón en ambas). */}
                        <InvoiceCfdiBadge
                          cfdiUuid={inv.cfdiUuid}
                          facturApiEnabled={clinic.facturApiEnabled}
                          onStamp={isVoidedInvoice(inv) || !((Number(inv.paid) || 0) > 0.005) ? undefined : () => openCfdiModal(inv)}
                        />
                      </td>
                      <td
                        style={{ textAlign: "right", whiteSpace: "nowrap" }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {canPay ? (
                          <button
                            type="button"
                            onClick={(e) => openPaymentForRow(e, inv)}
                            className="btn-new btn-new--ghost btn-new--sm"
                          >
                            {t("billing.billingClient.registerPayment")}
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardNew>
      )}

      {/* Paginación de la búsqueda en servidor (20 por página). */}
      {remote && remote.total > remote.limit && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap", padding: "10px 4px", fontSize: 12.5, color: "var(--text-3)" }}>
          <span>
            {t("billing.billingClient.searchPaging", {
              from: (remote.page - 1) * remote.limit + 1,
              to:   Math.min(remote.page * remote.limit, remote.total),
            })}
          </span>
          <div style={{ display: "flex", gap: 6 }}>
            <button
              type="button"
              className="btn-new btn-new--ghost btn-new--sm"
              disabled={searching || remote.page <= 1}
              onClick={() => setPage(p => Math.max(1, p - 1))}
            >
              {t("billing.billingClient.prevPage")}
            </button>
            <button
              type="button"
              className="btn-new btn-new--ghost btn-new--sm"
              disabled={searching || remote.page * remote.limit >= remote.total}
              onClick={() => setPage(p => p + 1)}
            >
              {t("billing.billingClient.nextPage")}
            </button>
          </div>
        </div>
      )}

      {/* Nueva factura — MISMO editor que la ficha del paciente (tarifario,
       *  descuento por línea y global, doctor atribuido, IVA). Aquí además elige
       *  paciente porque Caja no parte de una ficha. */}
      <InvoiceEditorModal
        rediseno={rediseno}
        open={showNew}
        patients={patients}
        clinicTaxMode={clinic.cfdiTaxMode}
        // Solo al duplicar (diseño nuevo): paciente fijo y conceptos ya puestos.
        patientId={duplicar?.patientId || undefined}
        patientName={duplicar?.patientName}
        inicial={duplicar?.borrador ?? null}
        onClose={() => { setShowNew(false); setDuplicar(null); }}
        onCreated={(inv) => {
          setInvoices(prev => [inv, ...prev]);
          setShowNew(false);
          setDuplicar(null);
          refresh();
        }}
      />

      {/* Detalle de factura — mismo componente que en /dashboard/patients/[id]
       *  Acciones: Cobrar, Marcar pagada, Editar precio, Aplicar descuento,
       *  Cancelar, Reembolsar, Imprimir, Copiar UUID. */}
      <InvoiceDetailModal
        rediseno={rediseno}
        open={detailInvoice !== null}
        invoice={detailInvoice}
        patientName={detailInvoice ? patientNameOf(detailInvoice) : ""}
        onClose={() => { setDetailInvoice(null); setCobroMontoSugerido(null); setAbrirTimbrado(false); }}
        onMutated={refresh}
        initialAction={abrirTimbrado ? "cfdi" : null}
        clinicTaxMode={clinic.cfdiTaxMode ?? null}
        // ws1-t4: abierto desde «Registrar pago» de la fila → el pago ya abierto.
        abrirCobro={cobroMontoSugerido !== null}
        montoSugerido={cobroMontoSugerido ?? undefined}
        // ws1-t4: «Editar factura» del detalle (borrador sin pagos) → el editor.
        onEditar={puedeEditarFacturas ? (inv) => { setDetailInvoice(null); setCobroMontoSugerido(null); setEditando(inv); } : undefined}
      />

      {/* ws1-t4: «Editar» abre el editor con los conceptos de ESA factura. */}
      {editando && (
        <InvoiceEditorModal
          rediseno={rediseno}
          open
          patientId={editando.patientId ?? editando.patient?.id ?? undefined}
          patientName={patientNameOf(editando)}
          clinicTaxMode={clinic.cfdiTaxMode}
          editar={editando}
          onClose={() => setEditando(null)}
          onCreated={() => {}}
          onGuardada={(guardada) => {
            setInvoices((prev) => prev.map((i) => (i.id === guardada?.id ? { ...i, ...guardada } : i)));
            setEditando(null);
            refresh();
          }}
        />
      )}

    </div>
  );
}
