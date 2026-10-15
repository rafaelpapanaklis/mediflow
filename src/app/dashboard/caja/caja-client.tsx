"use client";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Wallet, TrendingUp, Percent, Receipt, ArrowDownCircle, Banknote,
  Lock, Printer, X, ChevronDown, ChevronRight, History,
  CreditCard, Download, AlertTriangle, KeyRound, Clock, Undo2,
} from "lucide-react";
import toast from "react-hot-toast";
import { KpiCard }   from "@/components/ui/design-system/kpi-card";
import { CardNew }   from "@/components/ui/design-system/card-new";
import { BadgeNew }  from "@/components/ui/design-system/badge-new";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { fmtMXNdec } from "@/lib/format";
import { useLocale, useT } from "@/i18n/i18n-provider";
import { useQueCuenta } from "@/components/dashboard/que-cuenta";
import { textosDinero } from "@/lib/dinero/textos";
import { descuentoUnaVezPorFactura } from "@/lib/dinero/caja-core";
import { BillingClient } from "../billing/billing-client";
import type { CajaState, CajaHistoryRow } from "@/lib/caja";
import { dayKeyIn, staleShiftOf } from "@/lib/caja-turno";
import { CLASES_CAJA_REDISENO, clasesCaja } from "@/components/dashboard/caja-rediseno/raiz";
import { CajaNueva } from "@/components/dashboard/caja-rediseno/caja-nueva";
import { fechaHoraPanel, fechaPanel } from "@/lib/formato-fecha-panel";
import { metodoCanonico } from "@/lib/dinero/metodo-pago";
import { netoDelDia } from "@/lib/dinero/caja-dia";
import { reembolsosEnEfectivoDelCorte, type MovimientosDelCorte } from "@/lib/dinero/corte-del-historial";
import { AvisoAnticiposPorRevisar, type Item as AnticipoPorRevisar } from "@/components/dashboard/billing/aviso-anticipos-por-revisar";
import { AjustesDineroCaja, CobrosFueraDeCorte } from "@/components/dashboard/billing/caja-fuera-de-corte";
import { AvisoCobrosAutomaticos } from "@/components/cobro-automatico/AvisoCobrosAutomaticos";
import { ListaMensualidades } from "@/components/specialties/orthodontics/cobranza/ListaMensualidades";
import type { CobroPorRevisar } from "@/lib/cobro-automatico/servicio.server";
import avisosCaja from "@/components/dashboard/caja-rediseno/avisos-caja.module.css";
import { ModalCambiarPin, OlvidePin } from "./pin-caja";
import { cuerpoDePinNuevo, validarPinDoble } from "./pin-doble";

interface BillingProps {
  invoices:      any[];
  patients:      any[];
  totalPaid:     number;
  /** ws1-t2: lo pagado antes de DaleControl (historia migrada), ya restado de `totalPaid`. */
  historiaMigrada?: number;
  totalPending:  number;
  totalOverdue:  number;
  monthInvoices: number;
  /** Facturas de la clínica en TOTAL (el arreglo trae solo las 100 más recientes). */
  totalInvoices?: number;
  /** Lo vencido de cada factura (`computeReceivables`): la píldora y el filtro «Vencidas». */
  overdueByInvoice?: Record<string, number>;
  /** true = `computeReceivables` tocó su techo de lectura: KPIs parciales. */
  receivablesIncompleto?: boolean;
  creditTotal:   number;
  clinic:        { facturApiEnabled: boolean; rfcEmisor: string | null; cfdiTaxMode?: string | null };
  /** true = FACTURAPI_ENV=live → el timbrado va al SAT con validez fiscal. */
  cfdiLive?:     boolean;
  /** ws1-t4: la sesión tiene billing.edit — «Editar» abre el editor de la factura. */
  puedeEditarFacturas?: boolean;
}

interface Props {
  caja:     CajaState;
  history:  CajaHistoryRow[];
  timezone: string;
  hasPin:   boolean;
  /** La sesión es el dueño (SUPER_ADMIN): «¿Olvidaste tu PIN?» le dice que lo restablezca él, en su ficha. */
  esSuperAdmin?: boolean;
  billing:  BillingProps;
  /**
   * REDISEÑO DE CAJA — el mismo interruptor por clínica que enciende el menú
   * de dos niveles (`menu-dos-niveles` en `clinic_feature_flags`). Con `true`
   * la raíz lleva los tokens y las clases del diseño nuevo; con `false` (el
   * valor por defecto) no se añade ni una clase y Caja se pinta como hoy.
   * Ropa nueva, no motor nuevo: apertura, corte, retiro y PIN no cambian.
   */
  rediseno?: boolean;
  /** ws1-t5: la sesión tiene settings.edit — puede encender el cierre automático. */
  puedeAjustarCierre?: boolean;
  /**
   * ws1-t2 — las alertas de dinero, traídas en el servidor con la página (las
   * mismas funciones que sus rutas): salen ARRIBA en el primer pintado.
   */
  avisosDeDinero: { anticipos: AnticipoPorRevisar[]; cobrosAutomaticos: CobroPorRevisar[] };
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
  refunds:          number;
  netIncome?:       number;
  cashRefunds?:     number;
  writeOffs?:       number;
  appliedCredit?:   number;
  toCredit?:        number;
  discounts:        number;
  tax:              number;
  withdrawals:      number;
  expectedCash:     number;
  counted:          number;
  variance:         number;
  list:             CajaState["list"];
}

const PIN_RE = /^\d{6}$/;

/** Payment.method de un reembolso (REFUND_METHOD en lib/caja, que no se importa aquí: trae Prisma). */
const REFUND = "refund";
const isRefundRow = (r: { method: string }) => r.method === REFUND;
/** Importe con signo para mostrar: los reembolsos se guardan en POSITIVO y se pintan en negativo. */
const signedAmount = (r: { method: string; amount: number }) => (isRefundRow(r) ? `−${fmtMXNdec(r.amount)}` : fmtMXNdec(r.amount));
/** C-05: «Ingresos del turno» = cobrado − reembolsos reales (la pantalla vieja de un deploy puede no traer netIncome). */
const netoDelTurno = (x: { netIncome?: number; totalIncome: number; refunds: number }) =>
  x.netIncome ?? Math.round((x.totalIncome - x.refunds) * 100) / 100;

export function CajaClient({ caja: cajaProp, history, timezone, hasPin: hasPinInitial, esSuperAdmin = false, billing, rediseno = false, puedeAjustarCierre = false, avisosDeDinero }: Props) {
  const t = useT();
  const qc = useQueCuenta();
  const locale = useLocale();
  const txDinero = textosDinero(locale);
  const router = useRouter();
  const searchParams = useSearchParams();

  const [tab, setTab] = useState<"caja" | "facturas">(
    searchParams.get("tab") === "facturas" ? "facturas" : "caja",
  );

  // ¿El usuario ya configuró su PIN de Caja? Puede volverse true tras crearlo.
  const [hasPin, setHasPin] = useState(hasPinInitial);
  // «Cambiar mi PIN» (o «Crear mi PIN» si todavía no tiene): modal propio.
  const [showCambiarPin, setShowCambiarPin] = useState(false);
  // Contenedor de lo que carga en cliente (cierre automático y mensualidades, al final).
  const avisosTardiosRef = useRef<HTMLDivElement | null>(null);
  // El aviso de Hoy lleva aquí con `#mensualidades-ortodoncia`. La lista llega
  // después del primer pintado y ahora está al final de la pantalla: sin esto el
  // navegador (que ya buscó el ancla y no la encontró) no bajaría a ella.
  useEffect(() => {
    if (window.location.hash !== "#mensualidades-ortodoncia") return;
    const contenedor = avisosTardiosRef.current;
    if (!contenedor) return;
    const ir = () => {
      const el = document.getElementById("mensualidades-ortodoncia");
      if (!el) return false;
      el.scrollIntoView({ block: "start" });
      return true;
    };
    if (ir()) return;
    const observador = new MutationObserver(() => { if (ir()) observador.disconnect(); });
    observador.observe(contenedor, { childList: true, subtree: true });
    const limite = window.setTimeout(() => observador.disconnect(), 15000);
    return () => { observador.disconnect(); window.clearTimeout(limite); };
  }, []);
  // El motivo por el que el PIN nuevo de la apertura no se aceptó (no coinciden / no son 6 dígitos).
  const [errorPinApertura, setErrorPinApertura] = useState<string | null>(null);

  // Modals
  const [showOpen, setShowOpen]             = useState(false);
  const [showWithdrawal, setShowWithdrawal] = useState(false);
  const [showClose, setShowClose]           = useState(false);
  const [summary, setSummary]               = useState<CloseSummary | null>(null);
  // C-06 (segunda auditoría): tras el 409 «entró efectivo», el diálogo se queda
  // con la Caja FRESCA (GET /api/caja/current), no con la del render: antes
  // seguía diciendo «Diferencia $0.00» y el segundo clic guardaba un faltante.
  const [cajaFresca, setCajaFresca]         = useState<CajaState | null>(null);
  useEffect(() => { setCajaFresca(null); }, [cajaProp]);
  const caja = cajaFresca ?? cajaProp;
  // N-15 (segunda auditoría): el corte del historial que se está viendo.
  const [corteVisto, setCorteVisto]         = useState<CajaHistoryRow | null>(null);
  // F3 (tercera auditoría): lo que la foto del corte no guarda, pedido al abrirlo.
  const [movCorte, setMovCorte]             = useState<{ id: string; mov: MovimientosDelCorte | null; error: boolean } | null>(null);
  useEffect(() => {
    if (!corteVisto) { setMovCorte(null); return; }
    let vivo = true;
    const id = corteVisto.id;
    setMovCorte({ id, mov: null, error: false });
    fetch(`/api/caja/history/${encodeURIComponent(id)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((mov: MovimientosDelCorte) => { if (vivo) setMovCorte({ id, mov, error: false }); })
      .catch(() => { if (vivo) setMovCorte({ id, mov: null, error: true }); });
    return () => { vivo = false; };
  }, [corteVisto]);
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
  // C-06: el servidor no cerró porque el esperado cambió mientras se contaba.
  const [avisoCierre, setAvisoCierre]       = useState<string | null>(null);
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
    // Sin esta clave el fallback de abajo imprimía "refund" en inglés en el
    // corte, en el resumen impreso y en el CSV.
    refund:   t("cashRegister.methodRefund"),
    // Pago de factura con link de Mercado Pago (ws1-t1): lo registra el webhook.
    mercadopago: t("cashRegister.methodMercadoPago"),
    // Saldo a favor (anticipo) aplicado al emitir la factura: no entra al cajón.
    anticipo: t("cashRegister.methodAnticipo"),
    // QA de Rafael #2: «CARD» (tarjeta sin tipo) y el saldo migrado, en español.
    card: txDinero.caja.metodoTarjeta,
    migrated: txDinero.caja.metodoMigrado,
  };
  const methodLabelOf = (m: string) => METHOD_LABEL[m] ?? METHOD_LABEL[metodoCanonico(m)] ?? m;
  // ws1-t5: un «reembolso» que solo pasó el dinero a saldo a favor se dice así.
  const methodLabel = (m: string, refundMethod?: string | null) =>
    m === REFUND && refundMethod === "saldo_a_favor" ? txDinero.caja.aSaldoFavor : methodLabelOf(m);

  // ── Fechas, SIEMPRE en la zona horaria de la clínica ──────────────────
  // Si `timezone` llegara inválida, Intl lanza RangeError y tumba la página
  // entera; se degrada a la zona del navegador en vez de romper el corte.
  const tz = useMemo(() => {
    try { new Intl.DateTimeFormat("es-MX", { timeZone: timezone }); return timezone; }
    catch { return undefined; }
  }, [timezone]);

  const fmtTime = (iso: string) =>
    new Date(iso).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit", timeZone: tz });
  // F-06 (comprobación final): EL formato del panel («4 oct 2026, 8:36 a.m.»), no «04-oct, 08:36 a.m.».
  const fmtDateTime = (iso: string) => fechaHoraPanel(iso, tz, locale);
  /** "27 jul 2026" — prefijo de día en las filas cuando el turno cruza días (con año, ws1-t9 #9). */
  const fmtDayShort = (iso: string) => fechaPanel(iso, tz, locale);
  /** "Jueves, 27 jul 2026" — encabezado del grupo de día dentro de la tabla. */
  const fmtDayLong = (iso: string) => {
    const dia = new Date(iso).toLocaleDateString("es-MX", { weekday: "long", timeZone: tz });
    return `${dia.charAt(0).toUpperCase()}${dia.slice(1)}, ${fechaPanel(iso, tz, locale)}`;
  };
  /** dd/mm/aaaa y hh:mm de 24 h — para el CSV: Excel sí los parsea como fecha y hora. */
  const fmtDayNumeric = (iso: string) =>
    new Date(iso).toLocaleDateString("es-MX", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: tz });
  const fmtClock24 = (iso: string) =>
    new Date(iso).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: tz });

  // Día natural de la clínica como clave comparable ("2026-07-27"). Se arma con
  // formatToParts y no con un locale prestado (en-CA) para que el formato no
  // dependa de los locales que tenga instalados el navegador. Vive en
  // lib/caja-turno porque Sabina decide el aviso de «sin cortar» con la misma.
  const dayKey = useMemo(() => dayKeyIn(tz), [tz]);

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
  // QA de Rafael #6: el importe del día RESTA los reembolsos reales, como «Cobrado
  // hoy» y el corte (el traspaso a saldo a favor y el saldo aplicado no cuentan).
  const dayAgg = useMemo(() => {
    const filas = new Map<string, typeof caja.list>();
    for (const r of caja.list) {
      const k = dayKey(r.at);
      filas.set(k, [...(filas.get(k) ?? []), r]);
    }
    const m = new Map<string, { count: number; total: number }>();
    for (const [k, lista] of Array.from(filas.entries())) {
      m.set(k, { count: lista.length, total: netoDelDia(lista as Array<{ method: string; amount: number; refundMethod?: string | null }>) });
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
    // 18 h o cambio de día: la regla es de lib/caja-turno y Sabina usa la misma.
    return staleShiftOf(reg.openedAt, nowMs, dayKey);
  }, [reg, nowMs, dayKey]);

  // C-17: el descuento de la factura, una vez por factura (no el prorrateo).
  const descuentoPorFila = useMemo(() => descuentoUnaVezPorFactura(caja.list), [caja.list]);

  // Facturación del día (siempre disponible, con o sin caja abierta).
  // N-01 (segunda auditoría): lo que ENTRÓ hoy (cobros − reembolsos, sin saldo a
  // favor aplicado), la cifra de Finanzas › Hoy. La cuenta vieja (facturado −
  // por cobrar de las facturas creadas hoy) queda solo de respaldo.
  const collectedToday = caja.cobradoHoy ?? Math.max(0, caja.billedToday - caja.pendingToday);

  // Diferencia en vivo dentro del modal de cierre.
  const countedNum = parseFloat(counted);
  const liveVariance = useMemo(() => {
    if (!totals || Number.isNaN(countedNum)) return null;
    return Math.round((countedNum - totals.expectedCash + Number.EPSILON) * 100) / 100;
  }, [countedNum, totals]);

  async function post(url: string, body: any, alFallar?: (data: any) => boolean): Promise<any | null> {
    setBusy(true);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // `alFallar` devuelve true si ya avisó a su manera.
        if (!alFallar?.(data)) toast.error(data?.error || t("cashRegister.errorGeneric"));
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

  // El servidor dice que no hay PIN (se lo restablecieron con la Caja abierta):
  // se vuelve a pedir crearlo, dos veces, en vez de quedarse en «PIN incorrecto».
  function pinFaltaEnServidor(data: any): boolean {
    if (data?.code !== "CAJA_PIN_REQUIRED") return false;
    setHasPin(false);
    setOpenPin(""); setOpenPinConfirm("");
    toast.error(t("cashRegister.pin.restablecido"));
    return true;
  }

  function startOpen() {
    setErrorPinApertura(null);
    // Prefija la apertura con el efectivo de hoy aún no cuadrado (editable).
    setOpeningBalance(caja.suggestedOpening > 0 ? String(caja.suggestedOpening) : "");
    setOpenPin(""); setOpenPinConfirm(""); setOpenWAmount(""); setOpenWReason("");
    setShowOpen(true);
  }

  async function openRegister() {
    const bal = parseFloat(openingBalance);
    if (Number.isNaN(bal) || bal < 0) { toast.error(t("cashRegister.amountInvalid")); return; }
    // Si el usuario aún no tiene PIN, lo crea antes de abrir (open exige PIN) y
    // SIEMPRE dos veces: sin las dos idénticas y de 6 dígitos no se hace nada.
    if (!hasPin) {
      const doble = validarPinDoble(openPin, openPinConfirm);
      if (doble.ok === false) {
        setErrorPinApertura(doble.motivo === "no-coinciden" ? t("cashRegister.pin.noCoinciden") : t("cashRegister.pin.seisDigitos"));
        return;
      }
      setErrorPinApertura(null);
      const setRes = await post("/api/caja/pin", cuerpoDePinNuevo({ pin: openPin, confirmacion: openPinConfirm }));
      if (!setRes) return;
      setHasPin(true);
    } else if (!PIN_RE.test(openPin)) {
      toast.error(t("cashRegister.pin.seisDigitos"));
      return;
    }

    const ok = await post("/api/caja/open", { openingBalance: bal, pin: openPin }, pinFaltaEnServidor);
    if (!ok) return;

    // Retiro inicial opcional en la misma apertura. El PIN es el que se acaba
    // de teclear para abrir: no se le pide dos veces en la misma pantalla.
    const amt = parseFloat(openWAmount);
    if (!Number.isNaN(amt) && amt > 0) {
      await post("/api/caja/withdrawal", { amount: amt, reason: openWReason.trim() || "Retiro de apertura", pin: openPin }, pinFaltaEnServidor);
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
    // Sin PIN no hay retiro: primero lo crea (dos veces), en su propio modal.
    if (!hasPin) { setShowWithdrawal(false); setShowCambiarPin(true); return; }
    if (!PIN_RE.test(wPin)) { toast.error(t("cashRegister.pin.seisDigitos")); return; }
    const ok = await post("/api/caja/withdrawal", { amount: amt, reason: wReason.trim(), pin: wPin }, pinFaltaEnServidor);
    if (!ok) return;
    toast.success(t("cashRegister.toastWithdrawal"));
    setShowWithdrawal(false);
    setWAmount(""); setWReason(""); setWPin("");
    router.refresh();
  }

  async function closeRegister() {
    const cnt = parseFloat(counted);
    if (Number.isNaN(cnt) || cnt < 0) { toast.error(t("cashRegister.amountInvalid")); return; }
    if (!hasPin) { setShowClose(false); setShowCambiarPin(true); return; }
    if (!PIN_RE.test(closePin)) { toast.error(t("cashRegister.pin.seisDigitos")); return; }
    if (!totals || !reg) return;
    setAvisoCierre(null);
    const res = await post("/api/caja/close", {
      countedClosingBalance: cnt,
      closingNotes: closingNotes.trim() || undefined,
      pin: closePin,
      // C-06: el esperado que se está viendo. Si entró efectivo mientras se
      // contaba, el servidor no cierra y aquí se refresca y se pide recontar.
      esperadoVisto: totals.expectedCash,
    }, (data) => {
      if (pinFaltaEnServidor(data)) return true;
      if (data?.code !== "CAJA_ESPERADO_CAMBIO") return false;
      setAvisoCierre(String(data.error ?? ""));
      // El esperado del servidor manda YA (aunque la lectura fresca tarde o falle).
      const esperado = typeof data.expectedCash === "number" ? data.expectedCash : null;
      if (esperado != null && caja.totals) setCajaFresca({ ...caja, totals: { ...caja.totals, expectedCash: esperado } });
      fetch("/api/caja/current", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((fresca: CajaState | null) => { if (fresca?.totals) setCajaFresca(fresca); })
        .catch(() => {});
      return true;
    });
    if (!res) return;
    // Congela el resumen del corte para mostrarlo/imprimirlo (tras refresh reg = null).
    //
    // Se imprime el resumen FRESCO que manda el servidor: `totals` y `caja.list`
    // vienen del render SSR y nadie los refresca (/api/caja/current no lo llama
    // ningún cliente), mientras que el cierre recalcula la ventana con otro
    // reloj. Mezclar los dos sacaba un arqueo que se contradice a sí mismo: un
    // pago de $700 entre el render y el clic imprimía "Esperado $5,000 ·
    // Contado $5,000 · Diferencia −$700", con una diferencia que no estaba en
    // ninguna fila de la tabla impresa.
    //
    // El fallback a los datos del render solo cubre una pestaña abierta durante
    // el deploy, servida por una versión que todavía no manda `summary`.
    setSummary(res.summary ? (res.summary as CloseSummary) : {
      openedAt:         reg.openedAt,
      closedAt:         new Date().toISOString(),
      openingBalance:   totals.openingBalance,
      cashIncome:       totals.cashIncome,
      cardDebitIncome:  totals.cardDebitIncome,
      cardCreditIncome: totals.cardCreditIncome,
      otherIncome:      totals.otherIncome,
      totalIncome:      totals.totalIncome,
      refunds:          totals.refunds,
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
    const header = ["Fecha", "Hora", "Paciente", "Procedimiento", "Método", "Total", txDinero.caja.csvDescuento, "Profesional"];
    const lines = [
      header.join(","),
      ...rows.map(r => [
        cell(fmtDayNumeric(r.at)),
        cell(fmtClock24(r.at)),
        cell(r.patientName),
        cell(r.concept),
        cell(methodLabel(r.method, r.refundMethod)),
        // Reembolso en NEGATIVO: así la suma de la columna en Excel da lo mismo
        // que "Ingresos del turno − Reembolsos" y no infla la venta.
        isRefundRow(r) ? -r.amount : r.amount,
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
      `<tr><td>${multiDay ? fmtDateTime(r.at) : fmtTime(r.at)}</td><td>${esc(r.patientName)}</td><td>${esc(r.concept)}</td><td style="text-align:right">${signedAmount(r)}</td><td>${esc(methodLabel(r.method, r.refundMethod))}</td><td>${esc(r.doctorName)}</td></tr>`,
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
        ${line(t("cashRegister.methodCash"), fmtMXNdec(s.cashIncome))}
        ${line(t("cashRegister.methodDebit"), fmtMXNdec(s.cardDebitIncome))}
        ${line(t("cashRegister.methodCredit"), fmtMXNdec(s.cardCreditIncome))}
        ${s.otherIncome > 0 ? line(esc(t("cashRegister.nueva.otrosMetodos")), fmtMXNdec(s.otherIncome)) : ""}
        ${s.refunds > 0 ? line(t("cashRegister.kpiRefunds"), `−${fmtMXNdec(s.refunds)}`) : ""}
        ${line(t("cashRegister.kpiIncome"), fmtMXNdec(netoDelTurno(s)))}
        ${(s.cashRefunds ?? 0) > 0 ? line(esc(txDinero.caja.reembolsosEfectivo), `−${fmtMXNdec(s.cashRefunds ?? 0)}`) : ""}
        ${(s.appliedCredit ?? 0) > 0 ? line(esc(txDinero.caja.aplicadoSaldo), fmtMXNdec(s.appliedCredit ?? 0)) : ""}
        ${(s.toCredit ?? 0) > 0 ? line(esc(txDinero.caja.aSaldoFavor), fmtMXNdec(s.toCredit ?? 0)) : ""}
        ${line(t("cashRegister.kpiDiscounts"), fmtMXNdec(s.discounts))}
        ${(s.writeOffs ?? 0) !== 0 ? line(esc(txDinero.caja.bajasYReembolsos), fmtMXNdec(s.writeOffs ?? 0)) : ""}
        ${line(t("cashRegister.kpiTax"), fmtMXNdec(s.tax))}
        ${line(t("cashRegister.kpiWithdrawals"), fmtMXNdec(s.withdrawals))}
        ${line(t("cashRegister.expectedCashLabel"), fmtMXNdec(s.expectedCash))}
        ${line(t("cashRegister.countedLabel"), fmtMXNdec(s.counted))}
        ${line(t("cashRegister.varianceLabel"), fmtMXNdec(s.variance))}
      </table>
      <h2>${t("cashRegister.listTitle")}</h2>
      <table class="mov"><thead><tr>
        <th>${multiDay ? t("cashRegister.thDateTime") : t("cashRegister.thTime")}</th><th>${t("cashRegister.thPatient")}</th><th>${t("cashRegister.thConcept")}</th>
        <th style="text-align:right">${txDinero.caja.thCobrado}</th><th>${t("cashRegister.thMethod")}</th><th>${t("cashRegister.thDoctor")}</th>
      </tr></thead><tbody>${rows || `<tr><td colspan="6" style="color:#999">${t("cashRegister.emptyList")}</td></tr>`}</tbody></table>
      <script>window.onload=function(){window.print();}</script>
      </body></html>`;
    const w = window.open("", "_blank", "width=820,height=640");
    if (w) { w.document.write(html); w.document.close(); }
  }

  // N-15 (segunda auditoría): las cifras congeladas de un corte del historial.
  function lineasDelCorte(h: CajaHistoryRow): Array<[string, string, boolean]> {
    const v = (n: number | null) => (n == null ? "—" : fmtMXNdec(n));
    return [
      [t("cashRegister.kpiOpening"), v(h.openingBalance), false],
      [t("cashRegister.methodCash"), v(h.cashIncome), false],
      [txDinero.caja.historialOtros, v(h.otherIncome), false],
      [t("cashRegister.kpiDiscounts"), v(h.discounts), false],
      [t("cashRegister.kpiTax"), v(h.tax), false],
      [t("cashRegister.kpiWithdrawals"), v(h.withdrawals), false],
      // F3: el reembolso en efectivo sí resta del esperado; sin esta línea no sumaba.
      ...(reembolsosEnEfectivoDelCorte(h) > 0
        ? [[txDinero.caja.historialReembolsosEfectivo, `-${fmtMXNdec(reembolsosEnEfectivoDelCorte(h))}`, false] as [string, string, boolean]]
        : []),
      [t("cashRegister.expectedCashLabel"), v(h.expectedCash), true],
      [t("cashRegister.countedLabel"), v(h.countedClosingBalance), true],
      [t("cashRegister.varianceLabel"), v(h.variance), true],
    ];
  }

  /** F3: lo que no mueve el cajón (calculado al abrir el corte), aparte de la cuenta del efectivo. */
  function lineasSinCajon(m: MovimientosDelCorte): Array<[string, string, boolean]> {
    const filas: Array<[string, string, boolean]> = [];
    if (m.refunds > 0) filas.push([txDinero.caja.historialReembolsos, `-${fmtMXNdec(m.refunds)}`, false]);
    if (m.toCredit > 0) filas.push([txDinero.caja.historialASaldo, fmtMXNdec(m.toCredit), false]);
    if (m.appliedCredit > 0) filas.push([txDinero.caja.historialSaldoAplicado, fmtMXNdec(m.appliedCredit), false]);
    if (m.writeOffs > 0) filas.push([txDinero.caja.bajasYReembolsos, fmtMXNdec(m.writeOffs), false]);
    return filas;
  }

  function printCorte(h: CajaHistoryRow) {
    const m = movCorte?.id === h.id ? movCorte.mov : null;
    const filas = [...lineasDelCorte(h), ...(m ? lineasSinCajon(m) : [])]
      .map(([l, val]) => `<tr><td style="padding:2px 12px 2px 0;color:#555">${esc(l)}</td><td style="text-align:right;font-weight:600">${esc(val)}</td></tr>`)
      .join("");
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(txDinero.caja.historialTitulo)}</title>
      <style>body{font-family:system-ui,Arial,sans-serif;padding:24px;color:#111;font-size:13px}h1{font-size:18px;margin:0 0 4px}table{border-collapse:collapse}</style>
      </head><body><h1>${esc(txDinero.caja.historialTitulo)}</h1>
      <div style="color:#666">${fmtDateTime(h.openedAt)} → ${h.closedAt ? fmtDateTime(h.closedAt) : "—"} · ${esc(h.operatorName)}</div>
      <table style="margin-top:12px">${filas}</table>
      ${h.closingNotes ? `<p>${esc(txDinero.caja.historialNotas)}: ${esc(h.closingNotes)}</p>` : ""}
      <p style="color:#666">${esc(txDinero.caja.historialNota)}</p>
      <script>window.onload=function(){window.print();}</script></body></html>`;
    const w = window.open("", "_blank", "width=820,height=640");
    if (w) { w.document.write(html); w.document.close(); }
  }

  const varianceTone = (v: number) => (Math.abs(v) < 0.005 ? "success" : v > 0 ? "info" : "danger");

  // La pestaña Facturas es la misma en los dos caminos (con `rediseno` la
  // viste BillingClient por su cuenta): se monta una vez y se coloca donde toque.
  const facturasNodo = (
    <BillingClient
      invoices={billing.invoices}
      patients={billing.patients}
      totalPaid={billing.totalPaid}
      historiaMigrada={billing.historiaMigrada ?? 0}
      totalPending={billing.totalPending}
      totalOverdue={billing.totalOverdue}
      monthInvoices={billing.monthInvoices}
      totalInvoices={billing.totalInvoices}
      overdueByInvoice={billing.overdueByInvoice}
      receivablesIncompleto={billing.receivablesIncompleto}
      creditTotal={billing.creditTotal}
      clinic={billing.clinic}
      cfdiLive={billing.cfdiLive}
      rediseno={rediseno}
      puedeEditarFacturas={billing.puedeEditarFacturas === true}
    />
  );

  return (
    // Con el interruptor encendido la raíz lleva los tokens y las clases del
    // rediseño (caja-rediseno/); apagado, ni una clase: el árbol es el de hoy.
    <div className={rediseno ? CLASES_CAJA_REDISENO : undefined} style={{ maxWidth: 1400, margin: "0 auto", width: "100%" }}>
      {/* ws1-t1 — «Cambiar mi PIN» (o «Crear mi PIN»): lo PRIMERO de la pantalla,
          alineado con los márgenes del encabezado, y fuera de las dos ramas a
          propósito: con el interruptor encendido o apagado, la misma fila. Su alto
          no depende de nada que cargue después, así que no mueve lo de abajo. */}
      <div style={{ display: "flex", justifyContent: "flex-end", padding: "10px clamp(14px, 1.6vw, 28px) 0" }}>
        <button type="button" className="btn-new btn-new--ghost btn-new--sm" data-cambiar-pin
          style={{ color: "var(--text-1)" }}
          onClick={() => setShowCambiarPin(true)}>
          <KeyRound size={14} strokeWidth={1.75} /> {hasPin ? t("cashRegister.pin.cambiar") : t("cashRegister.pin.crear")}
        </button>
      </div>
      {/* Alertas de DINERO, arriba (ws1-t2): anticipos por revisar (ws1-t3),
          efectivo cobrado fuera de todo corte (ws1-t5, F7) y cobros automáticos
          con tarjeta rechazados por Mercado Pago (ws1-t6). Las tres vienen del
          servidor con la página (props), así que ya están en el primer pintado:
          no aparecen después ni empujan «Abrir caja». Cada una se calla si no hay
          nada; con las tres calladas el contenedor no tiene hijos (`:empty`) y no
          deja hueco. La misma fila y los mismos márgenes con el rediseño y sin él. */}
      <div className={avisosCaja.superior} data-avisos-dinero>
        <AvisoAnticiposPorRevisar items={avisosDeDinero.anticipos} />
        <CobrosFueraDeCorte cobros={caja.fueraDeCorte} cajaAbierta={!!reg} timezone={timezone} />
        <AvisoCobrosAutomaticos items={avisosDeDinero.cobrosAutomaticos} />
      </div>
      {rediseno ? (
        /* CAJA REESTRUCTURADA (ws1-t6): la misma pantalla con cinco bloques en
           vez de veintiséis. Ropa, no motor: recibe las cifras, los
           formateadores y los manejadores de aquí; los modales de abajo son
           los mismos. Con el interruptor apagado no se monta y el árbol de
           `else` es el de siempre, tal cual. */
        <CajaNueva
          caja={caja}
          history={history}
          tab={tab}
          onTab={setTab}
          facturas={facturasNodo}
          staleShift={staleShift}
          collectedToday={collectedToday}
          listMultiDay={listMultiDay}
          dayKey={dayKey}
          dayAgg={dayAgg}
          fmtTime={fmtTime}
          fmtDateTime={fmtDateTime}
          fmtDayShort={fmtDayShort}
          fmtDayLong={fmtDayLong}
          methodLabel={methodLabel}
          isRefundRow={isRefundRow}
          signedAmount={signedAmount}
          varianceTone={varianceTone}
          showHistory={showHistory}
          onToggleHistory={() => setShowHistory(s => !s)}
          onOpen={startOpen}
          onWithdrawal={() => { setWPin(""); setShowWithdrawal(true); }}
          onClose={() => { setAvisoCierre(null); setShowClose(true); }}
          onDownloadCsv={downloadVentasCsv}
          onVerCorte={setCorteVisto}
        />
      ) : (
      <>
      {/* Header + tabs */}
      <div style={{ padding: "clamp(14px, 1.6vw, 28px) clamp(14px, 1.6vw, 28px) 0" }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 20, flexWrap: "wrap", marginBottom: 16 }}>
          <div>
            {/* El título y el subtítulo llevan su tamaño en línea, y un estilo en
                línea no se pisa desde una hoja: con el rediseño van por clase. */}
            <h1
              className={rediseno ? clasesCaja.titulo : undefined}
              style={rediseno ? undefined : { fontSize: "clamp(20px, 1.4vw, 22px)", letterSpacing: "-0.02em", color: "var(--text-1)", fontWeight: 700, margin: 0 }}
            >
              {t("cashRegister.title")}
            </h1>
            <p
              className={rediseno ? clasesCaja.subtitulo : undefined}
              style={rediseno ? undefined : { color: "var(--text-3)", fontSize: 13, marginTop: 4 }}
            >
              {t("cashRegister.subtitle")}
            </p>
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

      {tab === "facturas" ? facturasNodo : (
        <div style={{ padding: "clamp(14px, 1.6vw, 28px)" }}>
          {/* ── Facturación del día (siempre visible) ── */}
          <div style={{ marginBottom: 18 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <Receipt size={16} strokeWidth={1.75} style={{ color: "var(--text-3)" }} />
              <span style={{ color: "var(--text-2)", fontSize: 13.5, fontWeight: 600 }}>Facturación del día</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 14 }}>
              <KpiCard label="Facturado hoy" value={fmtMXNdec(caja.billedToday)}  icon={Receipt} hint={txDinero.caja.facturadoHoyNota} />
              <KpiCard label="Cobrado hoy"   value={fmtMXNdec(collectedToday)}    icon={TrendingUp} hero hint={caja.cobradoHoy != null ? txDinero.caja.cobradoHoyNota : undefined} />
              <KpiCard label="Por cobrar de hoy" value={fmtMXNdec(caja.pendingToday)} icon={Wallet} hint={txDinero.caja.porCobrarHoyNota} />
              <KpiCard
                label="Vencido"
                value={fmtMXNdec(caja.overdueToday)}
                icon={AlertTriangle}
                // Solo si `computeReceivables` tocó su techo de lectura: la cifra es un mínimo.
                // ws1-t2 (C-23): de dónde sale este «Vencido» (toda la clínica, también ortodoncia).
                hint={caja.receivablesIncompleto ? t("billing.billingClient.partialReceivablesShort") : qc("cajaVencido")}
              />
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
                  <ButtonNew variant="primary" icon={<Lock size={16} strokeWidth={1.75} />} onClick={() => { setAvisoCierre(null); setShowClose(true); }}>
                    {t("cashRegister.closeCta")}
                  </ButtonNew>
                </div>
              </div>

              {/* KPIs del turno — incluye desglose de tarjeta débito/crédito */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 14, marginBottom: 8 }}>
                <KpiCard label={t("cashRegister.kpiOpening")}      value={fmtMXNdec(totals.openingBalance)}   icon={Wallet} />
                <KpiCard label={t("cashRegister.kpiIncome")}       value={fmtMXNdec(netoDelTurno(totals))}    icon={TrendingUp} hero />
                <KpiCard label={t("cashRegister.methodCash")}      value={fmtMXNdec(totals.cashIncome)}       icon={Banknote} />
                <KpiCard label={t("cashRegister.methodDebit")}     value={fmtMXNdec(totals.cardDebitIncome)}  icon={CreditCard} />
                <KpiCard label={t("cashRegister.methodCredit")}    value={fmtMXNdec(totals.cardCreditIncome)} icon={CreditCard} />
                {/* Reembolsos del turno: línea propia EN NEGATIVO. Ya no suman
                 *  a "Ingresos del turno" (el servidor los separa), pero la
                 *  clínica tiene que verlos. Solo aparece si hubo alguno. */}
                {totals.refunds > 0 && (
                  <KpiCard label={t("cashRegister.kpiRefunds")}    value={`−${fmtMXNdec(totals.refunds)}`}    icon={Undo2} />
                )}
                {/* ws1-t5: lo reembolsado en efectivo (ya restado del esperado). */}
                {(totals.cashRefunds ?? 0) > 0 && (
                  <KpiCard label={txDinero.caja.reembolsosEfectivo} value={`−${fmtMXNdec(totals.cashRefunds ?? 0)}`} icon={Undo2} />
                )}
                <KpiCard label={t("cashRegister.kpiDiscounts")}    value={fmtMXNdec(totals.discounts)}        icon={Percent} hint={(totals.writeOffs ?? 0) !== 0 ? txDinero.caja.descuentosNota : undefined} />
                {(totals.writeOffs ?? 0) !== 0 && (
                  <KpiCard label={txDinero.caja.bajasYReembolsos} value={fmtMXNdec(totals.writeOffs ?? 0)} icon={Percent} />
                )}
                <KpiCard label={t("cashRegister.kpiTax")}          value={fmtMXNdec(totals.tax)}              icon={Receipt} />
                <KpiCard label={t("cashRegister.kpiWithdrawals")}  value={fmtMXNdec(totals.withdrawals)}      icon={ArrowDownCircle} />
                <KpiCard label={t("cashRegister.kpiExpectedCash")} value={fmtMXNdec(totals.expectedCash)}     icon={Banknote} />
              </div>
              {totals.otherIncome > 0 && (
                <p style={{ color: "var(--text-3)", fontSize: 12, margin: "0 0 18px" }}>
                  Otros métodos (transferencia / cheque / otro):{" "}
                  <span style={{ fontFamily: rediseno ? undefined : "var(--font-mono, monospace)", fontVariantNumeric: "tabular-nums", fontWeight: 600, color: "var(--text-2)" }}>{fmtMXNdec(totals.otherIncome)}</span>
                </p>
              )}
              {/* ws1-t5: movimientos que no son ingreso ni salida de dinero. */}
              {[
                [txDinero.caja.aplicadoSaldo, totals.appliedCredit ?? 0],
                [txDinero.caja.aSaldoFavor, totals.toCredit ?? 0],
                [txDinero.caja.reembolsosSinMetodo, totals.refundsUnknownMethod ?? 0],
              ].filter(([, v]) => (v as number) > 0).map(([label, v]) => (
                <p key={label as string} style={{ color: "var(--text-3)", fontSize: 12, margin: "0 0 8px" }}>
                  {label as string}:{" "}
                  <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 600, color: "var(--text-2)" }}>{fmtMXNdec(v as number)}</span>
                </p>
              ))}

              {/* Retiros del turno */}
              {caja.withdrawals.length > 0 && (
                <CardNew title={t("cashRegister.withdrawalsTitle")} className="mb-4" >
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {caja.withdrawals.map(w => (
                      <div key={w.id} style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 13, borderBottom: "1px solid var(--border-soft)", paddingBottom: 6 }}>
                        {/* El motivo es texto libre del operador: sin minWidth:0
                            empujaba el importe fuera de la tarjeta, que `.card`
                            recorta con overflow:hidden. Cede el motivo (…), nunca
                            la cifra. El title deja leer el motivo completo. */}
                        <span title={`${w.reason} · ${fmtTime(w.recordedAt)} · ${w.recordedByName}`} style={{ color: "var(--text-2)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{w.reason} <span style={{ color: "var(--text-3)" }}>· {fmtTime(w.recordedAt)} · {w.recordedByName}</span></span>
                        <span style={{ color: "var(--danger)", fontWeight: 600, fontFamily: rediseno ? undefined : "var(--font-mono, monospace)", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", flexShrink: 0 }}>−{fmtMXNdec(w.amount)}</span>
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
                            <th style={{ textAlign: "right" }}>{txDinero.caja.thCobrado}</th>
                            <th style={{ textAlign: "right" }}>{txDinero.caja.thDescuentoFactura}</th>
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
                                  <td><BadgeNew tone={isRefundRow(r) ? "danger" : r.method === "cash" ? "success" : "info"}>{methodLabel(r.method, r.refundMethod)}</BadgeNew></td>
                                  <td style={{ textAlign: "right", fontWeight: 600, color: isRefundRow(r) ? "var(--danger)" : "var(--text-1)", whiteSpace: "nowrap", fontFamily: rediseno ? undefined : "var(--font-mono, monospace)", fontVariantNumeric: "tabular-nums" }}>{signedAmount(r)}</td>
                                  <td style={{ textAlign: "right", color: (descuentoPorFila.get(r.paymentId) ?? 0) > 0 ? "var(--danger)" : "var(--text-3)", whiteSpace: "nowrap", fontFamily: rediseno ? undefined : "var(--font-mono, monospace)", fontVariantNumeric: "tabular-nums", fontWeight: (descuentoPorFila.get(r.paymentId) ?? 0) > 0 ? 600 : 400 }}>{(descuentoPorFila.get(r.paymentId) ?? 0) > 0 ? `−${fmtMXNdec(descuentoPorFila.get(r.paymentId) ?? 0)}` : "—"}</td>
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
                            <td style={{ whiteSpace: "nowrap", color: "var(--text-3)" }}>
                              {/* N-15: el corte se abre (y se reimprime) desde aquí. */}
                              <button type="button" onClick={() => setCorteVisto(h)} title={txDinero.caja.historialVer}
                                style={{ background: "none", border: "none", padding: 0, color: "var(--brand)", textDecoration: "underline", cursor: "pointer", font: "inherit" }}>
                                {fmtDateTime(h.openedAt)}
                              </button>
                            </td>
                            <td style={{ whiteSpace: "nowrap", color: "var(--text-3)" }}>{h.closedAt ? fmtDateTime(h.closedAt) : "—"}</td>
                            <td style={{ color: "var(--text-2)" }}>{h.operatorName}</td>
                            <td style={{ textAlign: "right", whiteSpace: "nowrap", fontFamily: rediseno ? undefined : "var(--font-mono, monospace)", fontVariantNumeric: "tabular-nums" }}>{fmtMXNdec(h.openingBalance)}</td>
                            <td style={{ textAlign: "right", whiteSpace: "nowrap", fontFamily: rediseno ? undefined : "var(--font-mono, monospace)", fontVariantNumeric: "tabular-nums" }}>{h.expectedCash == null ? "—" : fmtMXNdec(h.expectedCash)}</td>
                            <td style={{ textAlign: "right", whiteSpace: "nowrap", fontFamily: rediseno ? undefined : "var(--font-mono, monospace)", fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{h.countedClosingBalance == null ? "—" : fmtMXNdec(h.countedClosingBalance)}</td>
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
      </>
      )}

      {/* Lo que se pide a la red DESPUÉS del primer pintado (ws1-t1) y no es una
          alerta de dinero: el ajuste de cierre automático (ws1-t5) y las
          mensualidades de ortodoncia (ws1-t5, R2/R5). Al FINAL de la pantalla no
          tienen nada debajo que mover; cada uno se calla solo si no hay nada y el
          contenedor desaparece vacío (`:empty`), sin dejar hueco. Las alertas de
          dinero ya no están aquí: vienen del servidor y salen arriba (ws1-t2). */}
      <div ref={avisosTardiosRef} className={avisosCaja.tardios} data-avisos-tardios>
        <AjustesDineroCaja puedeCierre={puedeAjustarCierre} />
        <ListaMensualidades />
      </div>

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
                  <KeyRound size={16} strokeWidth={1.75} style={{ color: "var(--brand)" }} /> {hasPin ? t("cashRegister.pin.ingresaTitulo") : t("cashRegister.pin.crearTitulo")}
                </div>
                {!hasPin && (
                  <p style={{ color: "var(--text-3)", fontSize: 12, margin: "0 0 12px" }}>
                    {t("cashRegister.pin.crearAyuda")}
                  </p>
                )}
                <div className="field-new" style={{ marginBottom: 14 }}>
                  <label className="field-new__label">{t("cashRegister.pin.etiqueta")} <span className="req">*</span></label>
                  <input type="password" inputMode="numeric" pattern="\d{6}" maxLength={6} className="input-new" autoFocus
                    style={{ fontFamily: rediseno ? undefined : "var(--font-mono, monospace)", fontVariantNumeric: "tabular-nums", letterSpacing: "0.25em", textAlign: "center", fontSize: 14 }}
                    placeholder="••••••" value={openPin}
                    onChange={e => { setOpenPin(e.target.value.replace(/\D/g, "").slice(0, 6)); setErrorPinApertura(null); }} />
                </div>
                {!hasPin && (
                  <div className="field-new" style={{ marginBottom: 14 }}>
                    <label className="field-new__label">{t("cashRegister.pin.confirmar")} <span className="req">*</span></label>
                    <input type="password" inputMode="numeric" pattern="\d{6}" maxLength={6} className="input-new"
                      style={{ fontFamily: rediseno ? undefined : "var(--font-mono, monospace)", fontVariantNumeric: "tabular-nums", letterSpacing: "0.25em", textAlign: "center", fontSize: 14 }}
                      placeholder="••••••" value={openPinConfirm}
                      onChange={e => { setOpenPinConfirm(e.target.value.replace(/\D/g, "").slice(0, 6)); setErrorPinApertura(null); }} />
                  </div>
                )}
                {!hasPin && errorPinApertura && (
                  <p role="alert" data-pin-error style={{ color: "var(--danger)", fontSize: 12.5, margin: "-6px 0 14px" }}>{errorPinApertura}</p>
                )}
                {hasPin && <OlvidePin esSuperAdmin={esSuperAdmin} />}

                <div className="field-new" style={{ marginBottom: 14 }}>
                  <label className="field-new__label">{t("cashRegister.openingBalanceLabel")}</label>
                  <input type="number" min={0} step="0.01" className="input-new" placeholder="0.00"
                    value={openingBalance} onChange={e => setOpeningBalance(e.target.value)} />
                  <span style={{ color: "var(--text-3)", fontSize: 12, marginTop: 4 }}>
                    {txDinero.caja.sugeridoApertura}{" "}
                    <span style={{ fontFamily: rediseno ? undefined : "var(--font-mono, monospace)", fontVariantNumeric: "tabular-nums", fontWeight: 600, color: "var(--text-2)" }}>{fmtMXNdec(caja.suggestedOpening)}</span>
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
                {hasPin ? (
                  <>
                    <div className="field-new" style={{ marginBottom: 14 }}>
                      <label className="field-new__label" style={{ display: "flex", alignItems: "center", gap: 6 }}><KeyRound size={13} strokeWidth={1.75} /> {t("cashRegister.pin.etiquetaCaja")} <span className="req">*</span></label>
                      <input type="password" inputMode="numeric" pattern="\d{6}" maxLength={6} className="input-new"
                        style={{ fontFamily: rediseno ? undefined : "var(--font-mono, monospace)", fontVariantNumeric: "tabular-nums", letterSpacing: "0.25em", textAlign: "center", fontSize: 14 }}
                        placeholder="••••••" value={wPin}
                        onChange={e => setWPin(e.target.value.replace(/\D/g, "").slice(0, 6))} />
                    </div>
                    <OlvidePin esSuperAdmin={esSuperAdmin} />
                  </>
                ) : (
                  <p role="status" style={{ color: "var(--text-2)", fontSize: 12.5, margin: 0 }}>{t("cashRegister.pin.sinPin")}</p>
                )}
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
                  {/* C-05 (auditoría de uso): las líneas de arriba SUMAN el total
                      (con «otros» — transferencias — y restando los reembolsos). */}
                  <CloseLine label={t("cashRegister.methodCash")}   value={fmtMXNdec(totals.cashIncome)} rediseno={rediseno} />
                  <CloseLine label={t("cashRegister.methodDebit")}  value={fmtMXNdec(totals.cardDebitIncome)} rediseno={rediseno} />
                  <CloseLine label={t("cashRegister.methodCredit")} value={fmtMXNdec(totals.cardCreditIncome)} rediseno={rediseno} />
                  {totals.otherIncome > 0 && (
                    <CloseLine label={t("cashRegister.nueva.otrosMetodos")} value={fmtMXNdec(totals.otherIncome)} rediseno={rediseno} />
                  )}
                  {totals.refunds > 0 && (
                    <CloseLine label={t("cashRegister.kpiRefunds")} value={`−${fmtMXNdec(totals.refunds)}`} rediseno={rediseno} />
                  )}
                  <CloseLine label={t("cashRegister.kpiIncome")}    value={fmtMXNdec(netoDelTurno(totals))} strong rediseno={rediseno} />
                </div>
                {/* Y aparte, la cuenta del efectivo del cajón (no suma al total de arriba). */}
                <div style={{ display: "flex", flexDirection: "column", gap: 2, background: "var(--bg-elev-2)", border: "1px solid var(--border-soft)", borderRadius: "var(--radius)", padding: "8px 12px", marginBottom: 14 }}>
                  <CloseLine label={t("cashRegister.kpiOpening")}   value={fmtMXNdec(totals.openingBalance)} rediseno={rediseno} />
                  <CloseLine label={t("cashRegister.nueva.efectivoCobrado")} value={fmtMXNdec(totals.cashIncome)} rediseno={rediseno} />
                  <CloseLine label={t("cashRegister.kpiWithdrawals")} value={totals.withdrawals > 0 ? `−${fmtMXNdec(totals.withdrawals)}` : fmtMXNdec(0)} rediseno={rediseno} />
                  {(totals.cashRefunds ?? 0) > 0 && (
                    <CloseLine label={`${t("cashRegister.kpiRefunds")} · ${t("cashRegister.methodCash")}`} value={`−${fmtMXNdec(totals.cashRefunds ?? 0)}`} rediseno={rediseno} />
                  )}
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "10px 12px", background: "var(--brand-softer)", border: "1px solid var(--border-soft)", borderRadius: "var(--radius)", marginBottom: 14 }}>
                  <span style={{ color: "var(--text-2)", fontSize: 13, fontWeight: 600 }}>{t("cashRegister.expectedCashLabel")}</span>
                  <span style={{ color: "var(--text-1)", fontWeight: 700, fontSize: 16, fontFamily: rediseno ? undefined : "var(--font-mono, monospace)", fontVariantNumeric: "tabular-nums" }}>{fmtMXNdec(totals.expectedCash)}</span>
                </div>
                {avisoCierre && (
                  <div role="alert" style={{ background: "var(--warning-soft)", border: "1px solid var(--warning-border-strong)", color: "var(--warning-strong)", borderRadius: "var(--radius)", padding: "8px 12px", marginBottom: 14, fontSize: 12.5, fontWeight: 600 }}>
                    {avisoCierre}
                  </div>
                )}
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
                {hasPin ? (
                  <>
                    <div className="field-new" style={{ marginBottom: 14 }}>
                      <label className="field-new__label" style={{ display: "flex", alignItems: "center", gap: 6 }}><KeyRound size={13} strokeWidth={1.75} /> {t("cashRegister.pin.etiquetaCaja")} <span className="req">*</span></label>
                      <input type="password" inputMode="numeric" pattern="\d{6}" maxLength={6} className="input-new"
                        style={{ fontFamily: rediseno ? undefined : "var(--font-mono, monospace)", fontVariantNumeric: "tabular-nums", letterSpacing: "0.25em", textAlign: "center", fontSize: 14 }}
                        placeholder="••••••" value={closePin}
                        onChange={e => setClosePin(e.target.value.replace(/\D/g, "").slice(0, 6))} />
                    </div>
                    <OlvidePin esSuperAdmin={esSuperAdmin} />
                  </>
                ) : (
                  <p role="status" style={{ color: "var(--text-2)", fontSize: 12.5, margin: 0 }}>{t("cashRegister.pin.sinPin")}</p>
                )}
              </div>
              <div className="modal__footer">
                <ButtonNew variant="ghost" type="button" onClick={() => setShowClose(false)}>{t("common.cancel")}</ButtonNew>
                <ButtonNew variant="primary" type="submit" disabled={busy}>{t("cashRegister.closeSubmit")}</ButtonNew>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Modal: un corte del historial (N-15, segunda auditoría): verlo y reimprimirlo ── */}
      {corteVisto && (
        <div className="modal-overlay" onClick={() => setCorteVisto(null)}>
          <div className="modal" onClick={e => e.stopPropagation()} role="dialog" aria-label={txDinero.caja.historialTitulo}>
            <div className="modal__header">
              <div className="modal__title">{txDinero.caja.historialTitulo}</div>
              <button onClick={() => setCorteVisto(null)} type="button" className="btn-new btn-new--ghost btn-new--sm" aria-label={t("common.close")}><X size={16} strokeWidth={1.75} /></button>
            </div>
            <div className="modal__body">
              <div style={{ color: "var(--text-3)", fontSize: 12.5, marginBottom: 14 }}>
                {fmtDateTime(corteVisto.openedAt)} → {corteVisto.closedAt ? fmtDateTime(corteVisto.closedAt) : "—"} · {corteVisto.operatorName}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10, marginBottom: 14 }}>
                {lineasDelCorte(corteVisto).map(([label, valor, fuerte]) => (
                  <SumRow key={label} label={label} value={valor} strong={fuerte} rediseno={rediseno} />
                ))}
              </div>
              {/* F3: reembolsos de otros métodos, saldo a favor y bajas: no mueven el cajón, van aparte. */}
              <div style={{ color: "var(--text-3)", fontSize: 12, fontWeight: 600, margin: "0 0 8px" }}>{txDinero.caja.historialSinCajon}</div>
              {movCorte?.id === corteVisto.id && movCorte.mov ? (
                lineasSinCajon(movCorte.mov).length > 0 ? (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10, marginBottom: 14 }} data-sin-cajon>
                    {lineasSinCajon(movCorte.mov).map(([label, valor, fuerte]) => (
                      <SumRow key={label} label={label} value={valor} strong={fuerte} rediseno={rediseno} />
                    ))}
                  </div>
                ) : (
                  <p style={{ color: "var(--text-3)", fontSize: 12.5, margin: "0 0 14px" }}>{txDinero.caja.historialSinMovimientos}</p>
                )
              ) : (
                <p style={{ color: "var(--text-3)", fontSize: 12.5, margin: "0 0 14px" }} role="status">
                  {movCorte?.error ? txDinero.caja.historialSinDetalle : txDinero.caja.historialCalculando}
                </p>
              )}
              {corteVisto.closingNotes && (
                <p style={{ color: "var(--text-2)", fontSize: 12.5, margin: "0 0 10px" }}>{txDinero.caja.historialNotas}: {corteVisto.closingNotes}</p>
              )}
              <p style={{ color: "var(--text-3)", fontSize: 12, margin: 0 }}>{txDinero.caja.historialNota}</p>
            </div>
            <div className="modal__footer">
              <ButtonNew variant="secondary" type="button" icon={<Printer size={16} strokeWidth={1.75} />} onClick={() => printCorte(corteVisto)}>
                {t("cashRegister.print")}
              </ButtonNew>
              <ButtonNew variant="primary" type="button" onClick={() => setCorteVisto(null)}>{t("common.close")}</ButtonNew>
            </div>
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
              {/* N-15 (segunda auditoría): celdas más anchas, sin recortar «Efectivo esperado». */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10, marginBottom: 18 }}>
                <SumRow label={t("cashRegister.kpiOpening")}      value={fmtMXNdec(summary.openingBalance)} rediseno={rediseno} />
                <SumRow label={t("cashRegister.kpiIncome")}       value={fmtMXNdec(netoDelTurno(summary))} rediseno={rediseno} />
                <SumRow label={t("cashRegister.methodCash")}      value={fmtMXNdec(summary.cashIncome)} rediseno={rediseno} />
                <SumRow label={t("cashRegister.methodDebit")}     value={fmtMXNdec(summary.cardDebitIncome)} rediseno={rediseno} />
                <SumRow label={t("cashRegister.methodCredit")}    value={fmtMXNdec(summary.cardCreditIncome)} rediseno={rediseno} />
                {summary.otherIncome > 0 && (
                  <SumRow label={t("cashRegister.nueva.otrosMetodos")} value={fmtMXNdec(summary.otherIncome)} rediseno={rediseno} />
                )}
                {summary.refunds > 0 && (
                  <SumRow label={t("cashRegister.kpiRefunds")}    value={`−${fmtMXNdec(summary.refunds)}`} rediseno={rediseno} />
                )}
                {(summary.cashRefunds ?? 0) > 0 && (
                  <SumRow label={txDinero.caja.reembolsosEfectivo} value={`−${fmtMXNdec(summary.cashRefunds ?? 0)}`} rediseno={rediseno} />
                )}
                <SumRow label={t("cashRegister.kpiDiscounts")}    value={fmtMXNdec(summary.discounts)} rediseno={rediseno} />
                {(summary.writeOffs ?? 0) !== 0 && (
                  <SumRow label={txDinero.caja.bajasYReembolsos} value={fmtMXNdec(summary.writeOffs ?? 0)} rediseno={rediseno} />
                )}
                {/* N-15: las líneas de saldo a favor que trae el arqueo, también aquí. */}
                {(summary.appliedCredit ?? 0) > 0 && (
                  <SumRow label={txDinero.caja.aplicadoSaldo} value={fmtMXNdec(summary.appliedCredit ?? 0)} rediseno={rediseno} />
                )}
                {(summary.toCredit ?? 0) > 0 && (
                  <SumRow label={txDinero.caja.aSaldoFavor} value={fmtMXNdec(summary.toCredit ?? 0)} rediseno={rediseno} />
                )}
                <SumRow label={t("cashRegister.kpiTax")}          value={fmtMXNdec(summary.tax)} rediseno={rediseno} />
                <SumRow label={t("cashRegister.kpiWithdrawals")}  value={fmtMXNdec(summary.withdrawals)} rediseno={rediseno} />
                <SumRow label={t("cashRegister.expectedCashLabel")} value={fmtMXNdec(summary.expectedCash)} strong rediseno={rediseno} />
                <SumRow label={t("cashRegister.countedLabel")}    value={fmtMXNdec(summary.counted)} strong rediseno={rediseno} />
                <SumRow label={t("cashRegister.varianceLabel")}   value={fmtMXNdec(summary.variance)} strong rediseno={rediseno} />
              </div>
              {summary.list.length > 0 && (
                <div style={{ overflowX: "auto" }}>
                  <table className="table-new">
                    <thead>
                      <tr>
                        <th>{summaryMultiDay ? t("cashRegister.thDateTime") : t("cashRegister.thTime")}</th><th>{t("cashRegister.thPatient")}</th><th>{t("cashRegister.thConcept")}</th>
                        <th style={{ textAlign: "right" }}>{txDinero.caja.thCobrado}</th><th>{t("cashRegister.thMethod")}</th><th>{t("cashRegister.thDoctor")}</th>
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
                          <td style={{ textAlign: "right", fontWeight: 600, whiteSpace: "nowrap", color: isRefundRow(r) ? "var(--danger)" : undefined, fontFamily: rediseno ? undefined : "var(--font-mono, monospace)", fontVariantNumeric: "tabular-nums" }}>{signedAmount(r)}</td>
                          <td>{methodLabel(r.method, r.refundMethod)}</td>
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

      {/* ── Modal: Cambiar mi PIN / Crear mi PIN (el nuevo, dos veces) ── */}
      {showCambiarPin && (
        <ModalCambiarPin
          tienePin={hasPin}
          rediseno={rediseno}
          esSuperAdmin={esSuperAdmin}
          onClose={() => setShowCambiarPin(false)}
          onGuardado={() => { setHasPin(true); setShowCambiarPin(false); }}
        />
      )}
    </div>
  );
}

function SumRow({ label, value, strong, rediseno }: { label: string; value: string; strong?: boolean; rediseno: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "8px 10px", background: "var(--bg-elev-2)", border: "1px solid var(--border-soft)", borderRadius: "var(--radius-sm)" }}>
      {/* La celda del grid puede quedar angosta: si algo cede es la etiqueta,
          nunca el importe (de ahi el flexShrink:0 del segundo span). N-15
          (segunda auditoría): la etiqueta parte en dos renglones en vez de
          cortarse en «Tarjeta, transferencia y ot…». */}
      <span title={label} style={{ color: "var(--text-3)", fontSize: 12.5, minWidth: 0, lineHeight: 1.3, overflowWrap: "anywhere" }}>{label}</span>
      <span style={{ color: "var(--text-1)", fontWeight: strong ? 700 : 600, fontSize: strong ? 14.5 : 13, fontFamily: rediseno ? undefined : "var(--font-mono, monospace)", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", flexShrink: 0 }}>{value}</span>
    </div>
  );
}

function CloseLine({ label, value, strong, rediseno }: { label: string; value: string; strong?: boolean; rediseno: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: strong ? "7px 0 5px" : "5px 0", borderTop: strong ? "1px solid var(--border-soft)" : "none", marginTop: strong ? 4 : 0 }}>
      <span title={label} style={{ color: "var(--text-2)", fontSize: 12.5, fontWeight: strong ? 600 : 400, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
      <span style={{ color: "var(--text-1)", fontWeight: strong ? 700 : 600, fontSize: strong ? 14 : 13, fontFamily: rediseno ? undefined : "var(--font-mono, monospace)", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", flexShrink: 0 }}>{value}</span>
    </div>
  );
}

function esc(s: string): string {
  return String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
}
