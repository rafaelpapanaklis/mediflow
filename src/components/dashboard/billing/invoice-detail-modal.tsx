"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { cfdiAvisoPersistente, cfdiImpideReintento } from "@/lib/cfdi-avisos";
import { Printer, FileText, CreditCard, CheckCircle2, Pencil, Tag, XCircle, Undo2, Trash2, Receipt, Download, MessageCircle, Wallet, HandCoins, Clock } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { BadgeNew } from "@/components/ui/design-system/badge-new";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatDate } from "@/lib/utils";
// Dinero CON centavos: `formatCurrency` redondea a pesos enteros
// (maximumFractionDigits: 0) y este modal enseña importes de factura, no
// KPIs. Una factura de $2,447.25 salía con las columnas sumando $2,449 y un
// TOTAL de $2,447, y un concepto de $0.50 se leía "$1". `fmtMXNdec` es el
// mismo formateador que ya usa la LISTA de facturas y el PDF, así que los
// tres sitios a un clic de distancia dicen por fin el mismo número.
import { fmtMXNdec } from "@/lib/format";
import { useT } from "@/i18n/i18n-provider";
import { PaymentModal, type PaymentInvoice } from "./payment-modal";
import { esPlanAPlazos, montoSugeridoDeCobro } from "@/lib/invoices/plan-de-pagos";
import { abrirCobroClasicoAlAbrir, montoDelCobroAlAbrir } from "./cobrar-en-factura-core";
import { facturaEditableEnEditor } from "@/components/billing/editar-factura";
import { receptorInicial } from "@/lib/orthodontics/receptor-responsable";
import { useResponsableDeFactura } from "@/components/dashboard/plan-de-pagos/use-responsable-cfdi";
import { todayLocalISO } from "@/lib/billing/paid-at";
// Ropa del diseño nuevo (solo con `rediseno`): tokens del menú de dos niveles
// y las clases que visten este modal y su familia. Ver factura-rediseno/.
import { CLASES_FACTURA_REDISENO, clasesFactura as c } from "@/components/dashboard/factura-rediseno/raiz";
import { ConfirmacionFactura } from "@/components/dashboard/factura-rediseno/confirmacion";
// Una sola ventana (solo con `rediseno`): el cobro y el descuento viven DENTRO
// del detalle en vez de abrir otro diálogo. Ver factura-un-popup/.
import { CLASES_UN_POPUP, CLASE_CUERPO_CON_COBRO } from "@/components/dashboard/factura-un-popup/raiz";
import { useCobro } from "@/components/dashboard/factura-un-popup/use-cobro";
import { useFrenoCajaCerrada } from "./aviso-caja-cerrada";
import { AvisoCajaCerrada } from "./aviso-caja-cerrada.component";
// El plan de pagos de una factura a plazos (ws1-t2): por qué cuota va, y a cuál
// va lo que se está cobrando. Derivado; sin condiciones a plazos no pinta nada.
import { BloquePlan } from "@/components/dashboard/plan-de-pagos/bloque-plan";
import { DestinoDelAbono } from "@/components/dashboard/plan-de-pagos/destino-abono";
import { useCondicionesDeFactura } from "@/components/dashboard/plan-de-pagos/use-condiciones";
import { usePagosConCfdi } from "@/components/dashboard/plan-de-pagos/use-pagos-cfdi";
import { PaymentCfdiButton } from "./payment-cfdi-button";
import { SeccionCobro, DescuentoEnLinea, enfocarMontoAlAbrir } from "@/components/dashboard/factura-un-popup/seccion-cobro";
import { InvoiceCfdiBadge } from "./invoice-cfdi-badge";
// Mercado Pago como método de pago (ws1-t1): el método en el cobro y el bloque
// «ver / copiar link». Sin cuenta conectada no se monta nada.
import { LinkMercadoPago, useCobroMercadoPago } from "./link-mercado-pago";
// Pedir anticipo por Mercado Pago o transferencia desde la factura (ws1-t3 fase 1-2).
import { ModalPedirAnticipo } from "./modal-pedir-anticipo";
// Diseño (ws1-t5): la fila «Anticipo» del resumen y el renglón de acciones
// de anticipo/recibo. Solo ropa.
import ant from "@/components/dashboard/cobros-inventario-rediseno/anticipo.module.css";
// Registrar anticipo recibido (ws1-t3 fase 2).
import { ModalRegistrarAnticipo } from "./modal-registrar-anticipo";
import { AnularAnticipo } from "./anular-anticipo";
import { AvisoDineroCitaCancelada } from "./aviso-dinero-cita-cancelada";
import { ultimaMarca } from "@/lib/anticipos/cita-cancelada-core";
import { invoiceStatusBadge } from "./invoice-status";
import { REGIMENES_FISCALES, USOS_CFDI, FORMAS_PAGO_SAT } from "@/lib/cfdi-catalogs";
import { derivePaymentForm, resolveTaxMode, type CfdiTaxMode } from "@/lib/invoice-totals";
import { pagadoEsSoloAnticipo } from "@/lib/patient-credit-core";

const METHOD_LABEL_KEYS: Record<string, string> = {
  cash: "clinical.invoiceDetail.methodCash", debit: "clinical.invoiceDetail.methodDebit", credit: "clinical.invoiceDetail.methodCredit",
  transfer: "clinical.invoiceDetail.methodTransfer", check: "clinical.invoiceDetail.methodCheck", refund: "clinical.invoiceDetail.methodRefund", other: "clinical.invoiceDetail.methodOther",
  mercadopago: "clinical.invoiceDetail.methodMercadoPago",
  anticipo: "clinical.invoiceDetail.methodAnticipo",
};

interface Invoice {
  id: string;
  patientId?: string; // presente en las facturas reales; opcional por seguridad de tipos
  invoiceNumber: string;
  total: number;
  paid: number;
  balance: number;
  status: string;
  discount?: number;
  subtotal?: number;
  paymentMethod?: string | null;
  cfdiUuid?: string | null;
  notes?: string | null;
  items?: any[];
  payments?: any[];
  taxRate?: number | null;
  taxIncluded?: boolean | null;
  createdAt: string | Date;
  // Datos fiscales del paciente para pre-llenar el CFDI (opcional).
  patient?: {
    rfcPaciente?: string | null;
    razonSocialPac?: string | null;
    regimenFiscalPac?: string | null;
    cpPaciente?: string | null;
  } | null;
}

interface InvoiceDetailModalProps {
  open: boolean;
  invoice: Invoice | null;
  patientName: string;
  onClose: () => void;
  // Re-fetch invoices in parent. Llamado tras cualquier acción exitosa.
  onMutated: () => Promise<void> | void;
  /**
   * Acción a abrir junto con el modal. "cfdi" despliega directo el formulario
   * de timbrado — lo usa el botón "Timbrar" de las listas de facturas (Caja y
   * ficha del paciente) para no obligar a un segundo click. Se ignora si la
   * factura ya está timbrada, es borrador o está cancelada.
   */
  initialAction?: "cfdi" | null;
  /**
   * Clinic.cfdiTaxMode ("exempt" | "iva16") del server component que monta el
   * modal. Pre-llena el selector de impuestos del timbrado de forma SÍNCRONA.
   *
   * Antes se resolvía en DOS fases: el primer render ponía "exento" y solo el
   * .then() de GET /api/cfdi/usage lo corregía. Eso era una CARRERA: en una
   * clínica "iva16", quien llenaba los datos fiscales y pulsaba Timbrar antes
   * de que respondiera ese GET —o con la red caída, porque el .catch() vacío
   * dejaba el "exento" para siempre— mandaba taxMode:"exento" explícito, y el
   * server respeta el valor explícito por encima de su propia derivación
   * (api/cfdi/route.ts). Resultado: CFDI emitido EXENTO en una clínica que
   * causa IVA. Un dato de pantalla jamás debe decidir el régimen fiscal.
   *
   * (El endpoint es admin-only, pero eso NO agrava el caso: POST /api/cfdi usa
   * el MISMO requireAdmin, así que quien recibe 403 en usage tampoco puede
   * timbrar. La carrera era real para el admin, que es justo quien timbra.)
   *
   * OBLIGATORIA a propósito (sin `?`): tsconfig no está en strict, así que esto
   * garantiza que un montaje nuevo no pueda OMITIRLA — no protege de pasarle un
   * valor undefined, que sin strictNullChecks compila igual.
   */
  clinicTaxMode: string | null;
  /**
   * Interruptor `menu-dos-niveles` de la clínica, leído en el servidor por
   * quien monta el modal (Caja, la Agenda nueva, el expediente). Con `true`
   * el detalle y todos sus diálogos van vestidos con el diseño nuevo; con
   * `false` (el valor por defecto) cada nodo lleva la cadena de clases de
   * siempre, byte por byte. La LÓGICA no cambia con él: cada botón hace
   * exactamente lo mismo.
   */
  rediseno?: boolean;
  /**
   * ws1-t4 — «Cobrar» SIEMPRE abre esta ventana completa (nunca la de cobro
   * suelta). Quien la abre desde un botón de cobro (agenda, ficha, Caja,
   * Cobranza de ortodoncia…) pasa `abrirCobro`: con el diseño nuevo el panel
   * «Registrar pago» ya va desplegado de por sí y solo se enfoca el monto;
   * sin él, se abre encima la ventana de cobro de siempre en cuanto se sabe
   * que la sesión puede cobrar (nunca antes: sin permiso no hay cobro).
   */
  abrirCobro?: boolean;
  /**
   * ws1-t4 — el monto con que nace «Monto a cobrar» cuando quien abre sabe
   * QUÉ se cobra (la cuota vencida del caso, la mensualidad de un hermano,
   * el control…): el MISMO número que antes le pasaba a la ventana suelta.
   * Sin él (`undefined`) manda el cálculo propio de la factura (sus
   * condiciones a plazos, o el saldo). Se clampea al saldo, como siempre.
   */
  montoSugerido?: number;
  /**
   * ws1-t4 — se llama en vez de `onClose` cuando se REGISTRÓ un pago desde
   * esta ventana (lo usa el cobro encadenado de hermanos para pasar a la
   * siguiente factura). Sin él, registrar un pago cierra como siempre.
   */
  onCobrado?: () => void;
  /**
   * ws1-t4 — «Editar factura»: abre el EDITOR (conceptos, precios,
   * descuentos) de ESTA factura. Solo sale en un borrador sin pagos ni CFDI
   * (`facturaEditableEnEditor`, la regla del PATCH) y con billing.edit. Sin
   * él, no hay botón (se sigue con «Editar precio», como siempre).
   */
  onEditar?: (invoice: any) => void;
}

type SubAction = null | "refund" | "edit-price" | "discount" | "cancel" | "cfdi";

export function InvoiceDetailModal({ open, invoice: invoiceProp, patientName, onClose, onMutated, initialAction = null, clinicTaxMode, rediseno = false, abrirCobro = false, montoSugerido: montoSugeridoDeQuienAbre, onCobrado, onEditar }: InvoiceDetailModalProps) {
  const t = useT();
  const router = useRouter();
  const confirmDialog = useConfirm();
  // ws1-t1 (M2): «Registrar anticipo recibido» cambia `paid`/`balance`/status
  // de la factura, pero el objeto `invoice` es un PROP del padre (la fila que
  // clicaron en la lista) — `onMutated()` refresca ESA lista, no este prop ya
  // capturado, así que el modal seguía mostrando Pagado/Saldo viejos hasta
  // cerrar y reabrir. En vez de depender de que los 5 sitios que montan este
  // modal (Caja, Agenda, ficha del paciente…) sepan resincronizar su prop,
  // el modal trae su propia factura fresca tras esa acción y la usa por
  // encima del prop mientras siga abierto para el mismo id.
  const [facturaViva, setFacturaViva] = useState<Invoice | null>(null);
  useEffect(() => { setFacturaViva(null); }, [invoiceProp?.id, open]);
  const invoice = facturaViva ?? invoiceProp;
  const refrescarFactura = useCallback(async () => {
    if (!invoiceProp?.id) return;
    try {
      const r = await fetch(`/api/invoices/${invoiceProp.id}`);
      if (!r.ok) return;
      const fresca = await r.json();
      setFacturaViva(fresca);
    } catch {
      // Silencioso: la próxima apertura del modal trae el dato fresco igual.
    }
  }, [invoiceProp?.id]);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [sub, setSub] = useState<SubAction>(null);
  const [busy, setBusy] = useState(false);
  // `cx(vieja, nueva)`: con el interruptor encendido, la clase del diseño
  // nuevo; apagado, la cadena de siempre tal cual.
  // ELIGE una de las dos, nunca las junta: con el interruptor la cadena vieja
  // (y su `font-mono`) no llega al DOM. Lo vigila factura-rediseno.test.ts.
  const cx = (vieja: string, nueva: string) => (rediseno ? nueva : vieja);
  // «¿Marcar pagada?» y «¿Eliminar borrador?» del diseño nuevo
  // (factura-rediseno/confirmacion.tsx). Con el interruptor apagado nunca
  // deja de ser null: sigue el useConfirm global, como siempre.
  const [confirmacion, setConfirmacion] = useState<null | "mark-paid" | "delete-draft">(null);

  // Sub-form state — se resetea al abrir cada sub-modal.
  const [refundAmount, setRefundAmount] = useState("");
  const [refundReason, setRefundReason] = useState("");
  const [editTotal,    setEditTotal]    = useState("");
  const [discountAmt,  setDiscountAmt]  = useState("");
  const [cancelReason, setCancelReason] = useState("");

  // CFDI — formulario fiscal del receptor + estado de timbrado optimista.
  const [fiscal, setFiscal] = useState({ rfc: "", nombre: "", regimen: "612", cp: "", uso: "D01", email: "", formaPago: "03", impuestos: "exento" as CfdiTaxMode });
  const [stampedUuid, setStampedUuid] = useState<string | null>(null);
  const [cfdiId, setCfdiId] = useState<string | null>(null);
  // Consumo CFDI del mes (contador discreto en el sub-form + aviso de excedente).
  const [cfdiQuota, setCfdiQuota] = useState<{ used: number; included: number } | null>(null);
  // Ambiente de timbrado (boolean que expone /api/cfdi/usage). null = todavía no
  // se sabe: no se afirma nada sobre validez fiscal hasta tenerlo.
  const [cfdiLive, setCfdiLive] = useState<boolean | null>(null);
  // La respuesta del contador puede llegar tarde: si para entonces el sub-form
  // se cerró o se abrió el de otra factura, se descarta en vez de pintar cifras
  // de una apertura anterior.
  const cfdiInvoiceRef = useRef<string | null>(null);
  // Saldo pendiente → el CFDI sale como PUE; exige confirmación explícita.
  const [pueOk, setPueOk] = useState(false);
  // Error de integridad total↔conceptos (409 del server) → aviso con CTA.
  const [cfdiMismatch, setCfdiMismatch] = useState<string | null>(null);
  // Qué bloqueó el timbrado: cambia solo la acción del aviso (corregir la factura
  // vs. sólo cerrar cuando lo que falta se resuelve en Configuración).
  const [cfdiBlockCode, setCfdiBlockCode] = useState<string | null>(null);

  // El modal no se desmonta entre facturas: al cambiar de factura limpia el
  // estado de timbrado para no arrastrarlo a otra factura.
  useEffect(() => { setStampedUuid(null); setCfdiId(null); setPueOk(false); setCfdiMismatch(null); setCfdiBlockCode(null); }, [invoice?.id]);
  // La pregunta del diseño nuevo no sobrevive ni a un cambio de factura ni a
  // un cierre del modal desde fuera: si no, la siguiente apertura saldría con
  // «¿Marcar pagada?» ya abierto sobre otra factura. Con el interruptor apagado
  // el estado ya es null y esto no cambia nada.
  useEffect(() => { setConfirmacion(null); }, [invoice?.id, open]);

  // initialAction="cfdi" → abre el sub-form de timbrado al montar. Corre después
  // del reset de arriba (mismo orden de declaración) y se auto-descarta si la
  // factura ya está timbrada, es borrador o está cancelada. openCfdiForm es una
  // function declaration (hoisted), así que es válida aquí.
  useEffect(() => {
    if (!open || initialAction !== "cfdi" || !invoice) return;
    if (invoice.cfdiUuid || invoice.status === "DRAFT" || invoice.status === "CANCELLED") return;
    openCfdiForm();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialAction, invoice?.id]);

  // UNA SOLA VENTANA (diseño nuevo). Con el interruptor y una factura que se
  // puede cobrar —las mismas que hoy enseñan «Cobrar ahora» / «Cobrar pago»—
  // el formulario de la segunda ventana va dentro del detalle, ya desplegado, y
  // el botón del pie pasa a ser «Registrar pago»: un clic en vez de dos.
  // `useCobro` hace el MISMO POST que PaymentModal, con el mismo cuerpo, y al
  // terminar corre el mismo handlePaymentSuccess. Con el interruptor apagado
  // `cobrable` es false: el hook no hace nada y sigue saliendo PaymentModal.
  // H14: los botones de cobro solo con el permiso real de la sesión (lo trae
  // /api/invoices/[id]/permisos-cobro). Arrancan en false: el lado seguro mientras responde.
  const [puedeCobrar, setPuedeCobrar] = useState(false);
  const [puedeTimbrar, setPuedeTimbrar] = useState(false);
  // H14 (2.ª parte): «Editar precio»/descuento/«Eliminar borrador» (billing.edit) y
  // «Cancelar factura»/«Reembolsar» (billing.refund), como los exigen sus rutas.
  const [puedeEditar, setPuedeEditar] = useState(false);
  const [puedeReembolsar, setPuedeReembolsar] = useState(false);
  // H15 (opción A, ws1-t4): la cita de esta factura se canceló con dinero
  // pagado y falta decidir (o está por reembolsar): no se ofrece cobrar más de
  // un servicio que ya no va a ocurrir. El aviso de abajo dice qué hacer.
  const marcaCita = ultimaMarca(invoice?.notes);
  const citaCanceladaConDinero = invoice?.status !== "CANCELLED" && (marcaCita === "pendiente" || marcaCita === "reembolso");
  const cobrable = rediseno && puedeCobrar && !citaCanceladaConDinero && !!invoice && ["DRAFT", "PENDING", "PARTIAL", "OVERDUE"].includes(invoice.status);
  // ws1-t10 (H68): antes solo se leían las condiciones con el diseño nuevo
  // (para BloquePlan). El monto inicial del cobro las necesita EN LOS DOS
  // caminos — con y sin el interruptor, `PaymentModal` de abajo también abre
  // con el saldo completo si no sabe que la factura es a plazos.
  const condicionesPago = useCondicionesDeFactura(invoice?.id, open);
  // ws1-t10 (punto 9): en la factura de un caso de ortodoncia con responsable de
  // pago, el CFDI se precarga con los datos del TUTOR, no con los del niño.
  const responsableDePago = useResponsableDeFactura(invoice?.id, open);
  const [fiscalOrigen, setFiscalOrigen] = useState<"responsable" | "paciente">("paciente");
  // ws1-t10 (H68): la mensualidad o lo vencido, no el saldo completo del
  // tratamiento. 0 sin condiciones a plazos: cada consumidor cae al saldo.
  // ws1-t4: si quien abre ya sabe qué se cobra, manda su número (el mismo que
  // antes recibía la ventana suelta); si no, el de las condiciones.
  const montoSugerido = montoDelCobroAlAbrir(
    montoSugeridoDeQuienAbre,
    invoice ? montoSugeridoDeCobro(condicionesPago, invoice.total, invoice.paid, todayLocalISO()) : 0,
  );
  const cobro = useCobro({
    abierta: open,
    factura: cobrable && invoice ? { id: invoice.id, balance: invoice.balance } : null,
    confirmarAntes: invoice?.status === "DRAFT",
    alOcupar: setBusy,
    alCobrar: handlePaymentSuccess,
    montoSugerido,
  });
  // H25: «Marcar pagada» también cobra en efectivo (todo el saldo): mismo aviso de caja cerrada.
  const frenoMarkPaid = useFrenoCajaCerrada(open && !!invoice && invoice.status !== "PAID" && invoice.status !== "CANCELLED", true);
  // CFDI por pago (ws1-t1): solo tiene sentido pintarlo donde YA se pinta el
  // plan de pagos (rediseno) — sin eso no hay "cuota 3 de 18" que explicar.
  const { cfdiPorPago, recargarCfdiPorPago } = usePagosConCfdi(invoice?.id, open && rediseno);
  // ¿La clínica cobra con Mercado Pago? (ws1-t1) Sin cuenta: false, y nada cambia.
  // `true`, no `open`: se pregunta al montar la ficha, no al abrir el modal.
  // Preguntarlo al abrir hacía que el botón de Mercado Pago apareciera de golpe
  // cuando el usuario ya estaba eligiendo método (23-sep-2026).
  const mpDisponible = useCobroMercadoPago(true);
  // ws1-t3 fase 1 — cuánto de `invoice.paid` vino de un anticipo del panel:
  // solo lectura, para el desglose Total / Anticipo / Pendiente. Se calla
  // (queda en 0) si la ruta falla o la factura no tiene ninguno.
  const [anticipoPagado, setAnticipoPagado] = useState(0);
  // ws1-t1 (M3, B2): el anticipo PENDING de esta factura, si lo hay — para
  // prellenar «Registrar anticipo recibido» con ESE monto (no el saldo
  // completo) y para avisar en el diálogo de «Cancelar factura».
  const [anticipoPendiente, setAnticipoPendiente] = useState<{ id: string; amount: number; metodo: string } | null>(null);
  const [pidiendoAnticipo, setPidiendoAnticipo] = useState(false);
  const [registrandoAnticipo, setRegistrandoAnticipo] = useState(false);
  // QA t2 (fase 2): los botones «Pedir anticipo»/«Registrar anticipo
  // recibido» se deciden por el PERMISO real de la sesión (billing.deposit/
  // billing.charge), no por el rol ni sin mirar nada. Arrancan en `false` —
  // el lado seguro mientras este GET no responde — y el MISMO fetch que ya
  // traía `anticipoPagado` los trae también, sin un segundo viaje.
  const [puedeDepositar, setPuedeDepositar] = useState(false);
  const [puedeRegistrarAnticipo, setPuedeRegistrarAnticipo] = useState(false);
  const [puedeEnviarRecibo, setPuedeEnviarRecibo] = useState(false);
  const [enviandoRecibo, setEnviandoRecibo] = useState(false);
  // ws1-t1 (M2, M3): un tick propio para volver a pedir este GET tras «Pedir
  // anticipo» / «Registrar anticipo recibido» sin esperar a que cambie
  // `invoice?.id` (que no cambia: es la MISMA factura con otro anticipo).
  const [anticipoTick, setAnticipoTick] = useState(0);
  useEffect(() => {
    if (!open || !invoice?.id) { setAnticipoPagado(0); setAnticipoPendiente(null); setPuedeDepositar(false); setPuedeRegistrarAnticipo(false); setPuedeEnviarRecibo(false); return; }
    let vivo = true;
    // H16 (revisión final, ws1-t4): al cambiar de factura (o recargar), fuera lo
    // de la ANTERIOR mientras responde el servidor. Antes quedaban su permiso
    // de registrar y su pendiente: «Registrar anticipo recibido» se podía
    // pulsar sin el pendiente de ESTA factura cargado.
    setAnticipoPendiente(null); setPuedeDepositar(false); setPuedeRegistrarAnticipo(false); setPuedeEnviarRecibo(false);
    fetch(`/api/invoices/${invoice.id}/anticipo`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!vivo) return;
        setAnticipoPagado(typeof d?.anticipoPagado === "number" ? d.anticipoPagado : 0);
        setAnticipoPendiente(
          d?.pendiente && typeof d.pendiente.amount === "number"
            ? { id: d.pendiente.id, amount: d.pendiente.amount, metodo: d.pendiente.metodo }
            : null,
        );
        setPuedeDepositar(d?.puedeDepositar === true);
        setPuedeRegistrarAnticipo(d?.puedeRegistrar === true);
        setPuedeEnviarRecibo(d?.puedeEnviarRecibo === true);
      })
      .catch(() => { if (vivo) { setAnticipoPagado(0); setAnticipoPendiente(null); setPuedeDepositar(false); setPuedeRegistrarAnticipo(false); setPuedeEnviarRecibo(false); } });
    return () => { vivo = false; };
  }, [open, invoice?.id, anticipoTick]);

  // H14 — permisos de cobro de ESTA sesión, de su propio endpoint (no del de
  // anticipos). Falla cerrado: sin respuesta buena, los botones no salen.
  useEffect(() => {
    setPuedeCobrar(false); setPuedeTimbrar(false); setPuedeEditar(false); setPuedeReembolsar(false);
    if (!open || !invoice?.id) return;
    let vivo = true;
    fetch(`/api/invoices/${invoice.id}/permisos-cobro`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (vivo) { setPuedeCobrar(d?.puedeCobrar === true); setPuedeTimbrar(d?.puedeTimbrar === true); setPuedeEditar(d?.puedeEditar === true); setPuedeReembolsar(d?.puedeReembolsar === true); } })
      .catch(() => {});
    return () => { vivo = false; };
  }, [open, invoice?.id]);

  // ws1-t4 — «Cobrar» sin el diseño nuevo: la ventana completa y, encima, la
  // de cobro de siempre, UNA vez por apertura y solo cuando el permiso ya
  // respondió que sí. Con el diseño nuevo no hace falta: el cobro ya está
  // dentro. Un borrador no se abre solo (confirmarlo es una escritura): ahí
  // se pulsa «Cobrar ahora» del pie, como siempre.
  const cobroClasicoAbiertoRef = useRef<string | null>(null);
  useEffect(() => { if (!open) cobroClasicoAbiertoRef.current = null; }, [open]);
  useEffect(() => {
    if (!open || !invoice?.id) return;
    if (!abrirCobroClasicoAlAbrir({ abrirCobro, rediseno, puedeCobrar, citaCanceladaConDinero, status: invoice.status })) return;
    if (cobroClasicoAbiertoRef.current === invoice.id) return;
    cobroClasicoAbiertoRef.current = invoice.id;
    setPaymentOpen(true);
  }, [open, invoice?.id, invoice?.status, abrirCobro, rediseno, puedeCobrar, citaCanceladaConDinero]);

  // «Enviar recibo» (ws1-t3 fase 3): nunca automático, solo al pulsarlo.
  const enviarRecibo = useCallback(async () => {
    if (!invoice?.id || enviandoRecibo) return;
    setEnviandoRecibo(true);
    try {
      const res = await fetch(`/api/invoices/${invoice.id}/send-receipt`, { method: "POST" });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(out?.error ?? "No se pudo enviar el recibo.");
        return;
      }
      toast.success("Recibo enviado por WhatsApp.");
    } finally {
      setEnviandoRecibo(false);
    }
  }, [invoice?.id, enviandoRecibo]);
  // Hay un link vigente de esta factura (lo avisa el bloque del link): entonces
  // «Enviar por WhatsApp» lo pide y el aviso lo lleva.
  const [hayLinkMp, setHayLinkMp] = useState(false);
  useEffect(() => { setHayLinkMp(false); }, [invoice?.id, open]);
  // El descuento en línea arranca con el de la factura, igual que openSub()
  // al abrir su diálogo. Solo en el diseño nuevo.
  useEffect(() => {
    if (cobrable && open) setDiscountAmt(String(invoice?.discount ?? 0));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cobrable, open, invoice?.id, invoice?.discount]);

  if (!invoice) return null;

  const status = invoice.status;
  const isPending  = status === "PENDING" || status === "PARTIAL" || status === "OVERDUE";
  const isPaid     = status === "PAID";
  const isCancelled = status === "CANCELLED";
  // DRAFT: factura recién creada (vía autoInvoice / from-appointment). Antes
  // de cobrar requiere "Confirmar" para pasar a PENDING. El usuario puede
  // editar precio/descuento o eliminar el borrador completo desde aquí.
  const isDraft    = status === "DRAFT";
  const canEditPrice = (isPending || isDraft) && invoice.paid === 0 && puedeEditar;
  // Lo pagado es SOLO el saldo a favor aplicado al emitirla: se puede cancelar
  // y ese dinero vuelve a favor del paciente (el servidor lo vuelve a decidir).
  const soloAnticipo = !invoice.cfdiUuid && pagadoEsSoloAnticipo(invoice.paid, invoice.payments);
  const s = invoiceStatusBadge(status);

  // CFDI: uuid efectivo (prop o timbrado optimista) y si aplica facturar.
  const effectiveUuid  = stampedUuid ?? invoice.cfdiUuid ?? null;
  const canInvoiceCfdi = !isDraft && !isCancelled;

  // Una sola ventana: la ropa extra del detalle y el botón que cobra.
  const ropaUnPopup = cobrable ? CLASES_UN_POPUP : "";
  const ropaCuerpo  = cobrable ? CLASE_CUERPO_CON_COBRO : "";
  // El descuento se ofrece donde hoy sale su botón: borrador, o pendiente sin pagos.
  const admiteDescuento = cobrable && (isDraft || canEditPrice);
  // Escrito pero sin aplicar: cobrar así lo ignoraría, así que «Registrar
  // pago» espera a que se aplique (o se deje como estaba).
  const descuentoPendiente = admiteDescuento && Number(discountAmt || 0) !== (invoice.discount ?? 0);
  // Con Mercado Pago elegido no hay «Registrar pago»: el link está en la sección
  // y el pago lo registra el webhook al acreditarse (ws1-t1).
  const cobroPorMercadoPago = cobrable && mpDisponible && cobro.method === "mercadopago";
  const botonRegistrarPago = !puedeCobrar || citaCanceladaConDinero || cobroPorMercadoPago ? null : (
    <ButtonNew variant="primary" icon={<CreditCard size={14} aria-hidden />} onClick={cobro.submit} disabled={busy || cobro.saving || cobro.isInvalid || descuentoPendiente}>
      {cobro.saving ? t("clinical.paymentModal.registering") : t("clinical.paymentModal.registerPaymentBtn", { amount: cobro.amountNum ? " · " + fmtMXNdec(cobro.amountNum) : "" })}
    </ButtonNew>
  );

  function openSub(which: Exclude<SubAction, null>) {
    setRefundAmount(String(invoice?.paid ?? 0));
    setRefundReason("");
    setEditTotal(String(invoice?.total ?? 0));
    setDiscountAmt(String(invoice?.discount ?? 0));
    setCancelReason("");
    setSub(which);
  }

  // Abre el sub-form de datos fiscales, pre-llenado con los del paciente si
  // existen. Forma de pago = derivada de los pagos reales (editable); impuestos
  // = resueltos de una sola vez con la factura y la preferencia de la clínica
  // (`clinicTaxMode`, prop del server), igual que hace BillingClient. Todo queda
  // editable factura por factura desde el selector.
  function openCfdiForm() {
    const p = invoice?.patient;
    const inicial = receptorInicial(
      { rfc: p?.rfcPaciente ?? "", nombre: p?.razonSocialPac ?? "", regimen: p?.regimenFiscalPac ?? "", cp: p?.cpPaciente ?? "" },
      responsableDePago,
    );
    setFiscalOrigen(inicial.origen);
    setFiscal({
      rfc:     inicial.datos.rfc,
      nombre:  inicial.datos.nombre,
      regimen: inicial.datos.regimen,
      cp:      inicial.datos.cp,
      uso:     "D01",
      email:   "",
      formaPago: derivePaymentForm(invoice?.payments, invoice?.paymentMethod),
      // resolveTaxMode respeta la factura por encima de la clínica: si
      // internamente ya se le agregó IVA al paciente, sale iva16 pase lo que
      // pase. El `?? null` es cinturón y tirantes: si la prop faltara en runtime
      // (montaje viejo que se escapara del type-check) el resultado sigue siendo
      // determinista — el del propio desglose de la factura, exento si no trae.
      impuestos: resolveTaxMode(invoice ?? {}, clinicTaxMode ?? null),
    });
    // Este GET es SOLO informativo: consumo del mes ("CFDI este mes: N/M") y
    // ambiente de timbrado. Best-effort — si tarda, falla o contesta 403, no se
    // pinta el contador y ya. Los impuestos NO salen de aquí: nada asíncrono
    // puede tocar el régimen fiscal del comprobante (antes este .then() era el
    // que lo corregía, y quien timbraba antes de su respuesta emitía exento).
    setCfdiQuota(null);
    setCfdiLive(null);
    const openedFor = invoice?.id ?? null;
    cfdiInvoiceRef.current = openedFor;
    fetch("/api/cfdi/usage")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d || cfdiInvoiceRef.current !== openedFor) return;
        setCfdiQuota({ used: d.used, included: d.included });
        if (typeof d.live === "boolean") setCfdiLive(d.live);
      })
      .catch(() => {});
    setPueOk(false);
    setCfdiMismatch(null);
    setCfdiBlockCode(null);
    setSub("cfdi");
  }

  // Timbra el CFDI: (a) guarda los fiscales en el paciente para reusarlos y
  // (b) llama a POST /api/cfdi. Optimista: no cierra el modal, muestra descargas.
  async function handleStampCfdi() {
    if (!invoice) return;
    const rfc    = fiscal.rfc.trim().toUpperCase();
    const nombre = fiscal.nombre.trim();
    const cp     = fiscal.cp.trim();
    if (!rfc || !nombre || !fiscal.regimen || !cp) {
      toast.error(t("clinical.invoiceDetail.fiscalRequired"));
      return;
    }
    setBusy(true);
    try {
      // (a) Persistir fiscales en el paciente (best-effort, no bloquea el timbrado).
      // Con responsable de pago los fiscales son SUYOS: guardarlos en el niño
      // le pondría el RFC del tutor a su ficha.
      if (fiscalOrigen === "responsable") {
        fetch(`/api/invoices/${invoice.id}/receptor-responsable`, {
          method:  "PUT",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ rfc, nombre, regimen: fiscal.regimen, cp }),
        }).catch(() => {});
      } else if (invoice.patientId) {
        fetch(`/api/patients/${invoice.patientId}`, {
          method:  "PATCH",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ rfcPaciente: rfc, razonSocialPac: nombre, regimenFiscalPac: fiscal.regimen, cpPaciente: cp }),
        }).catch(() => {});
      }

      // (b) Timbrar.
      const res = await fetch("/api/cfdi", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          invoiceId:   invoice.id,
          receptor:    { rfc, nombre, regimenFiscal: fiscal.regimen, cp, email: fiscal.email.trim() || undefined },
          usoCfdi:     fiscal.uso,
          paymentForm: fiscal.formaPago,
          taxMode:     fiscal.impuestos,
          confirmUnpaidPue: pueOk === true ? true : undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // Avisos que NO pueden ir en un toast fugaz (lista en lib/cfdi-avisos):
        //  · total ≠ suma de conceptos → CTA para corregir la factura;
        //  · Live sin la organización lista → dice qué falta, es accionable;
        //  · el CFDI SÍ se timbró pero no se pudo guardar → trae el UUID y pide
        //    NO volver a timbrar. Es el más importante de los tres: se queda
        //    hasta que lo cierren y, mientras, el botón de timbrar no responde.
        if (cfdiAvisoPersistente(data.code)) {
          // Ya timbrado: el UUID queda además en la ficha (insignia, UUID con
          // copiar, y sin botón de timbrar), para volver a verlo tras cerrar.
          if (cfdiImpideReintento(data.code) && typeof data.uuid === "string") setStampedUuid(data.uuid);
          setCfdiBlockCode(data.code);
          setCfdiMismatch(data.error ?? t("clinical.invoiceDetail.operationError"));
          return;
        }
        throw new Error(data.error ?? t("clinical.invoiceDetail.operationError"));
      }

      setStampedUuid(data.uuid ?? null);
      setCfdiId(data.cfdiId ?? null);
      setSub(null);
      toast.success(t("clinical.invoiceDetail.cfdiStampedToast"));
      // El SAT timbró por un importe distinto al de la factura. El CFDI ya está
      // emitido y no se deshace, así que no se puede bloquear nada: se avisa a
      // quien timbró, con tiempo suficiente para leerlo, antes de que entregue el
      // comprobante. El detalle queda además en el audit log.
      if (data.warning?.code === "CFDI_STAMPED_TOTAL_DIFFERS" && data.warning.message) {
        toast.error(data.warning.message, { duration: 15000 });
      }
      // Al superar el cupo del mes: se timbra igual y se avisa que es adicional.
      if (data.quota && data.quota.overage > 0) {
        toast(
          t("clinical.invoiceDetail.cfdiOverageToast", {
            price: fmtMXNdec((data.quota.overagePriceCents ?? 0) / 100),
          }),
          { icon: "🧾", duration: 6000 },
        );
      }
      await onMutated(); // refresca la lista del parent sin cerrar el modal
    } catch (err: any) {
      toast.error(err.message ?? t("common.genericError"));
    } finally {
      setBusy(false);
    }
  }

  // Resuelve el cfdiId de una factura ya timbrada (para descargar PDF/XML).
  async function resolveCfdiId(): Promise<string | null> {
    if (cfdiId) return cfdiId;
    if (!invoice) return null;
    try {
      const res = await fetch(`/api/cfdi?invoiceId=${encodeURIComponent(invoice.id)}`);
      if (!res.ok) return null;
      const arr = await res.json();
      const id = Array.isArray(arr) && arr[0]?.id ? (arr[0].id as string) : null;
      if (id) setCfdiId(id);
      return id;
    } catch { return null; }
  }

  async function downloadCfdi(format: "pdf" | "xml") {
    const id = await resolveCfdiId();
    if (!id) { toast.error(t("clinical.invoiceDetail.cfdiDownloadError")); return; }
    window.open(`/api/cfdi/${id}/${format}`, "_blank");
  }

  async function callApi(
    path: string,
    method: "POST" | "PATCH" | "DELETE",
    body?: any,
    successMsg?: string | ((respuesta: any) => string),
  ) {
    if (!invoice) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/invoices/${invoice.id}${path}`, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? t("clinical.invoiceDetail.operationError"));
      }
      const respuesta = typeof successMsg === "function" ? await res.json().catch(() => ({})) : null;
      toast.success(
        (typeof successMsg === "function" ? successMsg(respuesta) : successMsg)
          ?? t("clinical.invoiceDetail.operationSuccess"),
      );
      setSub(null);
      await onMutated();
      onClose();
      // Forzamos refresh del segmento server-rendered actual además de la
      // revalidatePath del endpoint. Así la página que monta el modal
      // (patient-detail, billing, home) refleja la mutación sin que el
      // parent tenga que cablear router.refresh() en onMutated.
      router.refresh();
    } catch (err: any) {
      toast.error(err.message ?? t("common.genericError"));
    } finally {
      setBusy(false);
    }
  }

  // La llamada al servidor de «Marcar pagada»: la MISMA con y sin interruptor.
  function ejecutarMarkPaid() {
    return callApi("/mark-paid", "POST", {}, t("clinical.invoiceDetail.markPaidSuccess"));
  }

  async function handleMarkPaid(sinAviso?: unknown) {
    // Caja cerrada: se avisa ANTES de preguntar «¿Marcar pagada?» (no bloquea).
    if (sinAviso !== true && (await frenoMarkPaid.frenar())) return;
    frenoMarkPaid.ocultar();
    // Diseño nuevo: pregunta ConfirmacionFactura (abajo) y su botón corre
    // ejecutarMarkPaid, lo mismo que aquí tras el confirm de siempre.
    if (rediseno) { setConfirmacion("mark-paid"); return; }
    if (!(await confirmDialog({
      title: t("clinical.invoiceDetail.markPaid"),
      description: t("clinical.invoiceDetail.markPaidConfirm", { balance: fmtMXNdec(invoice!.balance) }),
      confirmText: t("clinical.invoiceDetail.markPaid"),
      cancelText: t("common.cancel"),
    }))) return;
    await ejecutarMarkPaid();
  }

  // Aviso de saldo por WhatsApp. No muta la factura: no se llama onMutated ni
  // se cierra el modal — el éxito enlaza al hilo del Inbox.
  async function handleSendWhatsApp(forzar = false) {
    if (!invoice) return;
    setBusy(true);
    try {
      // Se cobra por Mercado Pago (trato, método o link vigente): el aviso lleva el link (ws1-t1).
      const pedirLink = mpDisponible && (hayLinkMp || condicionesPago?.metodo === "mercadopago" || invoice.paymentMethod === "mercadopago");
      const cuerpo = { ...(pedirLink ? { linkPago: true } : {}), ...(forzar ? { forzar: true } : {}) };
      const res = await fetch(`/api/invoices/${invoice.id}/send-whatsapp`, Object.keys(cuerpo).length > 0
        ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo) }
        : { method: "POST" });
      const data = await res.json().catch(() => ({}));
      // ws1-t4 #82: ya salió un aviso de cobro hoy — se pregunta antes de mandar otro.
      if (res.status === 409 && data.code === "AVISO_YA_ENVIADO") {
        setBusy(false);
        if (await confirmDialog({
          title: t("clinical.invoiceDetail.sendWhatsApp"),
          description: data.error,
          confirmText: "Mandar de todos modos",
          cancelText: t("common.cancel"),
        })) await handleSendWhatsApp(true);
        return;
      }
      if (!res.ok) throw new Error(data.error ?? t("clinical.invoiceDetail.operationError"));
      // Iba con link de Mercado Pago y el link no viajó (ventana cerrada, MP caído…).
      if (typeof data.avisoLink === "string" && data.avisoLink) {
        toast(`${t("facturaMp.enviadoSinLink")} ${data.avisoLink}`, { duration: 10000 });
      }
      const inboxHref = `/dashboard/inbox${(data.patientId ?? invoice.patientId) ? `?patientId=${data.patientId ?? invoice.patientId}` : ""}`;
      toast.success(
        <span>
          {t("clinical.invoiceDetail.waSentToast")}{" "}
          <a href={inboxHref} className="underline font-bold">{t("clinical.invoiceDetail.waViewInbox")}</a>
        </span>,
        { duration: 6000 },
      );
    } catch (err: any) {
      // El motivo puede ser largo (plantilla en revisión, sin método de pago…):
      // más duración para alcanzar a leerlo.
      toast.error(err.message ?? t("common.genericError"), { duration: 8000 });
    } finally {
      setBusy(false);
    }
  }

  async function handleCancel() {
    // Si lo pagado era el saldo a favor aplicado, el servidor dice cuánto volvió a favor.
    const mensajeCancelada = (r: any) => r?.anticipoDevuelto > 0
      ? t("clinical.invoiceDetail.cancelSuccessAnticipo", { monto: fmtMXNdec(r.anticipoDevuelto) })
      : t("clinical.invoiceDetail.cancelSuccess");
    await callApi("/cancel", "POST", { reason: cancelReason.trim() || undefined }, mensajeCancelada);
  }

  async function handleRefund() {
    const amount = Number(refundAmount);
    if (!amount || amount <= 0) { toast.error(t("clinical.invoiceDetail.invalidAmount")); return; }
    if (amount > invoice!.paid) { toast.error(t("clinical.invoiceDetail.exceedsPaid")); return; }
    await callApi("/refund", "POST", { amount, reason: refundReason.trim() || undefined }, t("clinical.invoiceDetail.refundSuccess"));
  }

  async function handleEditPrice() {
    const total = Number(editTotal);
    if (!isFinite(total) || total < 0) { toast.error(t("clinical.invoiceDetail.invalidTotal")); return; }
    await callApi("/edit-price", "POST", { total }, t("clinical.invoiceDetail.priceUpdated"));
  }

  async function handleDiscount() {
    const discount = Number(discountAmt);
    if (!isFinite(discount) || discount < 0) { toast.error(t("clinical.invoiceDetail.invalidDiscount")); return; }
    await callApi("/edit-price", "POST", { discount }, t("clinical.invoiceDetail.discountApplied"));
  }

  // "Cobrar ahora" sobre un DRAFT: confirma el borrador (DRAFT → PENDING) y
  // abre el PaymentModal inmediatamente. El snapshot local del invoice
  // queda DRAFT pero el server ya está PENDING, así que el POST de payment
  // lo acepta. router.refresh() actualiza la lista del parent al cerrar.
  async function handleConfirmAndPay() {
    if (!invoice) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/invoices/${invoice.id}/confirm`, { method: "POST" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? t("clinical.invoiceDetail.confirmError"));
      }
      // Al confirmarse recibió el saldo a favor del paciente: lo que queda por
      // cobrar ya no es el total del borrador. No se abre el cobro con la cifra
      // vieja; se avisa y se refresca para cobrar sobre la nueva.
      const confirmada = await res.json().catch(() => ({}));
      if (confirmada?.anticipoAplicado > 0) {
        toast(t("clinical.invoiceDetail.anticipoAplicadoAlConfirmar", {
          monto: fmtMXNdec(confirmada.anticipoAplicado),
          resta: fmtMXNdec(confirmada.balance ?? 0),
        }), { duration: 10000 });
        await onMutated();
        onClose();
        router.refresh();
        return;
      }
      // router.refresh() removido: causaba race con el refresh post-payment
      // de handlePaymentSuccess. El refresh ocurre al cerrar el PaymentModal.
      setPaymentOpen(true);
    } catch (err: any) {
      toast.error(err.message ?? t("common.genericError"));
    } finally {
      setBusy(false);
    }
  }

  // La llamada al servidor de «Eliminar borrador»: la MISMA con y sin interruptor.
  function ejecutarDeleteDraft() {
    return callApi("", "DELETE", undefined, t("clinical.invoiceDetail.draftDeleted"));
  }

  async function handleDeleteDraft() {
    if (!invoice) return;
    if (rediseno) { setConfirmacion("delete-draft"); return; }
    if (!(await confirmDialog({
      title: t("clinical.invoiceDetail.deleteDraft"),
      description: t("clinical.invoiceDetail.deleteDraftConfirm", { number: invoice.invoiceNumber }),
      confirmText: t("clinical.invoiceDetail.deleteDraft"),
      cancelText: t("common.cancel"),
      variant: "danger",
    }))) return;
    await ejecutarDeleteDraft();
  }

  function handlePaymentSuccess() {
    setPaymentOpen(false);
    onMutated();
    if (onCobrado) onCobrado(); else onClose();
    router.refresh();
  }

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
        <DialogContent onOpenAutoFocus={cobrable ? enfocarMontoAlAbrir : undefined} className={cx("max-w-lg bg-card text-foreground border border-border", `${CLASES_FACTURA_REDISENO} ${c.modal} ${ropaUnPopup}`)}>
          <DialogHeader className={rediseno ? c.cabecera : undefined}>
            <DialogTitle className={cx("text-foreground font-bold flex items-center gap-3 flex-wrap", c.titulo)}>
              <span className={cx("font-mono", c.folio)}>{invoice.invoiceNumber}</span>
              <BadgeNew tone={s.tone} dot>{t(s.labelKey)}</BadgeNew>
              {/* Timbrada: el mismo badge de la lista (Caja y ficha) para que el
                  estado fiscal se lea de inmediato al abrir la factura. */}
              {effectiveUuid && <InvoiceCfdiBadge cfdiUuid={effectiveUuid} />}
            </DialogTitle>
          </DialogHeader>

          <div className={cx("px-6 py-4 space-y-4 flex-1 overflow-y-auto min-h-0", `${c.cuerpo} ${ropaCuerpo}`)}>
            {/* Resumen — usa tokens de tema (bg-muted/40, border-border, text-muted-foreground) */}
            <div className={cx("bg-muted/40 border border-border rounded-lg p-3 text-xs space-y-1.5 text-foreground", c.resumen)}>
              <div className={cx("flex justify-between", c.resumenFila)}><span className={cx("text-muted-foreground", c.rotulo)}>{t("clinical.invoiceDetail.patient")}</span><span className={cx("font-medium", c.valor)}>{patientName}</span></div>
              <div className={cx("flex justify-between", c.resumenFila)}><span className={cx("text-muted-foreground", c.rotulo)}>{t("common.date")}</span><span className={rediseno ? c.valor : undefined}>{formatDate(invoice.createdAt)}</span></div>
              {(invoice.discount ?? 0) > 0 && (
                <>
                  <div className={cx("flex justify-between", c.resumenFila)}><span className={cx("text-muted-foreground", c.rotulo)}>{t("clinical.invoiceDetail.subtotal")}</span><span className={rediseno ? c.cifra : undefined}>{fmtMXNdec(invoice.subtotal ?? invoice.total + (invoice.discount ?? 0))}</span></div>
                  <div className={cx("flex justify-between", c.resumenFila)}><span className={cx("text-muted-foreground", c.rotulo)}>{t("clinical.invoiceDetail.discount")}</span><span className={rediseno ? `${c.cifra} ${c.cifraAlerta}` : undefined} style={rediseno ? undefined : { color: "var(--warning)" }}>−{fmtMXNdec(invoice.discount ?? 0)}</span></div>
                </>
              )}
              <div className={cx("flex justify-between", c.resumenFila)}><span className={cx("text-muted-foreground", c.rotulo)}>{t("common.total")}</span><span className={cx("font-bold", `${c.cifra} ${c.cifraTotal}`)}>{fmtMXNdec(invoice.total)}</span></div>
              <div className={cx("flex justify-between", c.resumenFila)}><span className={cx("text-muted-foreground", c.rotulo)}>{t("clinical.invoiceDetail.paid")}</span><span className={cx("font-bold", `${c.cifra} ${c.cifraExito}`)} style={rediseno ? undefined : { color: "var(--success)" }}>{fmtMXNdec(invoice.paid)}</span></div>
              {/* ws1-t3 fase 1 — cuánto de lo pagado es anticipo. Solo se pinta
                  si hay alguno: no añade ruido a una factura sin anticipo. */}
              {anticipoPagado > 0 && (
                // Diseño (ws1-t5): sangrada bajo «Pagado» y con la cifra más
                // ligera — es una PARTE de lo pagado, no un importe más que
                // sumar. El número es el mismo de antes.
                <div className={`${cx("flex justify-between", c.resumenFila)} ${ant.subfila}`}>
                  <span className={`${cx("text-muted-foreground", c.rotulo)} ${ant.subfilaRotulo}`}>
                    <Wallet size={12} strokeWidth={1.75} aria-hidden /> Anticipo
                  </span>
                  <span className={`${rediseno ? c.cifra : ""} ${ant.subfilaCifra}`}>{fmtMXNdec(anticipoPagado)}</span>
                </div>
              )}
              {/* N15 (QA ronda 4): antes solo se enteraba de un anticipo
                  PENDING quien abría «Cancelar» o «Registrar anticipo» — el
                  resumen de arriba no lo mencionaba y parecía una factura
                  sin nada en curso. */}
              {anticipoPendiente && (
                <div className={`${cx("flex justify-between", c.resumenFila)} ${ant.subfila}`}>
                  <span className={`${cx("text-muted-foreground", c.rotulo)} ${ant.subfilaRotulo}`}>
                    <Clock size={12} strokeWidth={1.75} aria-hidden /> Anticipo pendiente
                  </span>
                  <span className={`${rediseno ? c.cifra : ""} ${ant.subfilaCifra}`}>{fmtMXNdec(anticipoPendiente.amount)}</span>
                </div>
              )}
              {/* Saldo. Cancelar NO pone `balance` a 0 en BD (solo cambia el
                  status y exige paid == 0), así que una factura anulada llega
                  aquí con balance == total y se pintaba en rojo como si se
                  debiera. En cancelada el saldo exigible es 0: se muestra $0 en
                  neutro. El Total de arriba sigue diciendo lo que se facturó. */}
              <div className={cx("flex justify-between", c.resumenFila)}>
                <span className={cx("text-muted-foreground", c.rotulo)}>{t("clinical.invoiceDetail.balance")}</span>
                <span
                  className={isCancelled ? cx("font-bold text-muted-foreground", `${c.cifra} ${c.cifraApagada}`) : cx("font-bold", `${c.cifra} ${c.cifraPeligro}`)}
                  style={isCancelled || rediseno ? undefined : { color: "var(--danger)" }}
                >
                  {fmtMXNdec(isCancelled ? 0 : invoice.balance)}
                </span>
              </div>
              {invoice.paymentMethod && (
                <div className={cx("flex justify-between", c.resumenFila)}><span className={cx("text-muted-foreground", c.rotulo)}>{t("clinical.invoiceDetail.method")}</span><span className={cx("capitalize", `capitalize ${c.valor}`)}>{METHOD_LABEL_KEYS[invoice.paymentMethod] ? t(METHOD_LABEL_KEYS[invoice.paymentMethod]) : invoice.paymentMethod}</span></div>
              )}
              {effectiveUuid && (
                <div className={cx("flex justify-between gap-2 items-center", c.resumenFila)}>
                  <span className={cx("text-muted-foreground", c.rotulo)}>CFDI UUID</span>
                  <span className={cx("flex items-center gap-2 min-w-0", c.uuid)}>
                    <span className={cx("font-mono text-[10px] truncate", c.uuidTexto)}>{effectiveUuid}</span>
                    {/* Enlace directo: el CFDI se ve sin tener que buscar los
                        botones de descarga del pie del modal. */}
                    <button
                      type="button"
                      onClick={() => downloadCfdi("pdf")}
                      disabled={busy}
                      className={cx("flex-shrink-0 inline-flex items-center gap-1 text-[10px] font-bold underline underline-offset-2 hover:opacity-80 disabled:opacity-50", c.enlace)}
                      style={rediseno ? undefined : { color: "var(--info, var(--brand))" }}
                    >
                      <Download size={11} aria-hidden /> {t("clinical.invoiceDetail.viewCfdi")}
                    </button>
                  </span>
                </div>
              )}
              {isCancelled && invoice.notes && (
                <div className={cx("pt-2 border-t border-border mt-2", c.resumenNotas)}>
                  <span className={cx("text-muted-foreground text-[10px] uppercase tracking-wide", c.seccionTitulo)}>{t("common.notes")}</span>
                  <p className={cx("text-[11px] mt-1 whitespace-pre-line", c.notasTexto)}>{invoice.notes}</p>
                </div>
              )}
              {/* H15 (opción A, ws1-t4): la cita se canceló con dinero pagado. */}
              <AvisoDineroCitaCancelada
                invoiceId={invoice.id}
                notas={invoice.notes}
                pagado={invoice.paid}
                estado={invoice.status}
                puedeCobrar={puedeCobrar}
                onListo={() => { void onMutated(); void refrescarFactura(); setAnticipoTick((n) => n + 1); }}
              />
            </div>

            {/* Ver / copiar el link de Mercado Pago (ws1-t1): solo si la clínica
                cobra con Mercado Pago y la factura ya tiene link o su trato dice
                Mercado Pago. Con el método elegido en el cobro, el link ya está ahí. */}
            {mpDisponible && isPending && !cobroPorMercadoPago && (
              <LinkMercadoPago
                key={invoice.id}
                invoiceId={invoice.id}
                modo="detalle"
                sugerido={condicionesPago?.metodo === "mercadopago" || invoice.paymentMethod === "mercadopago"}
                bloqueado={busy}
                alCambiar={(l) => setHayLinkMp(!!l)}
              />
            )}

            {/* Diseño (ws1-t5): las tres acciones de anticipo y recibo van en UN
                renglón (antes cada una ocupaba el ancho entero, una debajo
                de otra) y con el botón de la familia de la factura. Cada
                una conserva su condición y su permiso, tal cual. */}
            <div className={ant.accionesFactura}>
            {/* Pedir anticipo (ws1-t3 fase 1): por un importe PARCIAL, distinto
                del link de arriba (que cobra el saldo completo). Mientras la
                factura tenga saldo por cobrar. Gateado por el PERMISO real de
                la sesión (billing.deposit vía el GET de arriba — QA t2, fase
                2), no "sin mirar nada": un READONLY o un permiso a medida sin
                billing.deposit ya no lo ve. */}
            {isPending && puedeDepositar && (
              <button
                type="button"
                onClick={() => setPidiendoAnticipo(true)}
                disabled={busy}
                className={cx("inline-flex items-center gap-2 text-xs font-bold px-3 py-2 rounded-lg border border-border bg-card hover:bg-muted/40 disabled:opacity-50", c.boton)}
              >
                <Wallet size={14} aria-hidden /> Pedir anticipo
              </button>
            )}

            {/* Registrar anticipo recibido (ws1-t3 fase 2): efectivo,
                transferencia o terminal — el dinero YA está, no hay link que
                esperar. Gateado por "billing.charge" (billing.deposit no
                basta: registrar dinero recibido es cobrar). */}
            {isPending && puedeRegistrarAnticipo && (
              <button
                type="button"
                onClick={() => setRegistrandoAnticipo(true)}
                disabled={busy}
                className={cx("inline-flex items-center gap-2 text-xs font-bold px-3 py-2 rounded-lg border border-border bg-card hover:bg-muted/40 disabled:opacity-50", c.boton)}
              >
                <HandCoins size={14} aria-hidden /> Registrar anticipo recibido
              </button>
            )}

            {/* «Enviar recibo» (ws1-t3 fase 3): confirma un pago YA recibido
                (cualquier método). Nunca automático — solo al pulsarlo. Solo
                con algo pagado y el permiso de enviar WhatsApp. */}
            {invoice.paid > 0 && puedeEnviarRecibo && (
              <button
                type="button"
                onClick={enviarRecibo}
                disabled={busy || enviandoRecibo}
                className={cx("inline-flex items-center gap-2 text-xs font-bold px-3 py-2 rounded-lg border border-border bg-card hover:bg-muted/40 disabled:opacity-50", c.boton)}
              >
                <MessageCircle size={14} aria-hidden /> {enviandoRecibo ? "Enviando…" : "Enviar recibo"}
              </button>
            )}

            {/* H7 (revisión final, ws1-t4): un anticipo registrado por error
                se anula con motivo; solo con permiso de cobro (lo decide su
                GET). Se pinta solo si hay alguno anulable. */}
            <AnularAnticipo
              invoiceId={invoice.id}
              abierta={open}
              recarga={anticipoTick}
              onListo={() => { void onMutated(); void refrescarFactura(); setAnticipoTick((n) => n + 1); }}
              className={cx("inline-flex items-center gap-2 text-xs font-bold px-3 py-2 rounded-lg border border-border bg-card hover:bg-muted/40 disabled:opacity-50", c.boton)}
            />
            </div>

            {/* Conceptos */}
            {Array.isArray(invoice.items) && invoice.items.length > 0 && (
              <div>
                <h3 className={cx("text-[11px] font-bold text-muted-foreground uppercase tracking-wide mb-1.5", c.seccionTitulo)}>{t("clinical.invoiceDetail.lineItems")}</h3>
                <div className={cx("bg-card border border-border rounded-lg divide-y divide-border", c.lista)}>
                  {invoice.items.map((it: any, i: number) => (
                    <div key={i} className={cx("px-3 py-2 flex items-center justify-between text-xs", c.fila)}>
                      <div className={cx("min-w-0", c.filaTextos)}>
                        <div className={cx("font-medium truncate text-foreground", c.filaTitulo)}>{it.description ?? it.name ?? t("clinical.invoiceDetail.lineItemFallback", { n: i + 1 })}</div>
                        {(it.quantity ?? 1) !== 1 && (
                          <div className={cx("text-[10px] text-muted-foreground", c.filaDetalle)}>{it.quantity} × {fmtMXNdec(it.unitPrice ?? 0)}</div>
                        )}
                      </div>
                      <div className={cx("font-mono font-bold text-foreground", c.cifra)}>{fmtMXNdec(it.total ?? 0)}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Un borrador todavía no debe nada: sin bloque (ni «vencidas»). */}
            {rediseno && !isCancelled && !isDraft && (
              <BloquePlan condiciones={condicionesPago} total={invoice.total} pagado={invoice.paid} />
            )}

            {/* Pagos registrados — refunds aparecen con method="refund" en rojo */}
            {Array.isArray(invoice.payments) && invoice.payments.length > 0 && (
              <div>
                <h3 className={cx("text-[11px] font-bold text-muted-foreground uppercase tracking-wide mb-1.5", c.seccionTitulo)}>{t("clinical.invoiceDetail.movements")}</h3>
                <div className={cx("bg-card border border-border rounded-lg divide-y divide-border", c.lista)}>
                  {invoice.payments.map((p: any) => {
                    const isRefund = p.method === "refund";
                    // CFDI por pago (ws1-t1): solo en facturas a plazos, solo
                    // cobros reales (no reembolsos), y solo donde ya se pinta
                    // el plan de pagos — sin eso "mensualidad 3 de 18" no
                    // significa nada en pantalla.
                    const admiteCfdiPorPago = rediseno && !isCancelled && !isDraft && !isRefund && condicionesPago?.modo === "plazos";
                    return (
                      <div key={p.id} className={cx("px-3 py-2 flex flex-col gap-1", c.fila)}>
                        <div className="flex items-center justify-between">
                          <div className={cx("min-w-0", c.filaTextos)}>
                            <div className={rediseno ? `${c.filaTitulo} ${isRefund ? c.cifraPeligro : ""}` : `font-medium ${isRefund ? "" : "text-foreground"}`} style={isRefund && !rediseno ? { color: "var(--danger)" } : undefined}>
                              {METHOD_LABEL_KEYS[p.method] ? t(METHOD_LABEL_KEYS[p.method]) : (p.method ?? "—")}
                            </div>
                            <div className={cx("text-[10px] text-muted-foreground", c.filaDetalle)}>
                              {formatDate(p.paidAt)}
                              {p.reference ? ` · ${p.reference}` : ""}
                              {p.notes ? ` · ${p.notes}` : ""}
                            </div>
                          </div>
                          <div className={cx("font-mono font-bold", `${c.cifra} ${isRefund ? c.cifraPeligro : c.cifraExito}`)} style={rediseno ? undefined : { color: isRefund ? "var(--danger)" : "var(--success)" }}>
                            {isRefund ? "−" : ""}{fmtMXNdec(p.amount)}
                          </div>
                        </div>
                        {admiteCfdiPorPago && (
                          <PaymentCfdiButton
                            paymentId={p.id}
                            amount={p.amount}
                            method={p.method}
                            clinicTaxMode={clinicTaxMode}
                            defaultReceptor={receptorInicial(
                              { rfc: invoice.patient?.rfcPaciente ?? "", nombre: invoice.patient?.razonSocialPac ?? "", regimen: invoice.patient?.regimenFiscalPac ?? "", cp: invoice.patient?.cpPaciente ?? "" },
                              responsableDePago,
                            ).datos}
                            cfdi={cfdiPorPago[p.id]}
                            onStamped={() => { recargarCfdiPorPago(); onMutated(); }}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Una sola ventana: el cobro (y el descuento) aquí dentro, ya
                desplegado. Solo con el interruptor; sin él esto no pinta nada. */}
            {cobrable && (
              <SeccionCobro
                cobro={cobro}
                bloqueado={busy}
                mercadoPago={mpDisponible ? { invoiceId: invoice.id, alCambiar: (l) => setHayLinkMp(!!l) } : null}
                bajoElMonto={
                  <DestinoDelAbono invoiceId={invoice.id} total={invoice.total} pagado={invoice.paid} importe={cobro.isOverpay ? 0 : cobro.amountNum || 0} activo={open} condiciones={condicionesPago} />
                }
                descuento={admiteDescuento ? (
                  <DescuentoEnLinea
                    subtotal={invoice.subtotal ?? invoice.total + (invoice.discount ?? 0)}
                    valor={discountAmt}
                    alCambiar={setDiscountAmt}
                    alAplicar={handleDiscount}
                    ocupado={busy}
                    pendiente={descuentoPendiente}
                  />
                ) : undefined}
              />
            )}
          </div>

          <DialogFooter className={cx("flex flex-wrap gap-2", c.pie)}>
            {/* BORRADOR — antes de cobrar requiere "Confirmar". Cobrar ahora
                hace ambos pasos (confirm + payment) en un click. */}
            {isDraft && (
              <>
                {/* Diseño nuevo: el formulario ya está arriba, así que este
                    botón registra el pago (confirmando antes el borrador). */}
                {rediseno ? botonRegistrarPago : puedeCobrar && !citaCanceladaConDinero && (
                <ButtonNew variant="primary" icon={<CreditCard size={14} aria-hidden />} onClick={handleConfirmAndPay} disabled={busy}>
                  {t("clinical.invoiceDetail.chargeNow", { amount: fmtMXNdec(invoice.total) })}
                </ButtonNew>
                )}
                {/* ws1-t4: «Editar factura» abre el editor con los conceptos. */}
                {onEditar && puedeEditar && facturaEditableEnEditor({ ...invoice, cfdiUuid: effectiveUuid }) && (
                <ButtonNew variant="secondary" icon={<Pencil size={14} aria-hidden />} onClick={() => onEditar(invoice)} disabled={busy}>
                  {t("billing.invoiceEditor.editButton")}
                </ButtonNew>
                )}
                {puedeEditar && (
                <ButtonNew variant="secondary" icon={<Pencil size={14} aria-hidden />} onClick={() => openSub("edit-price")} disabled={busy}>
                  {t("clinical.invoiceDetail.editPrice")}
                </ButtonNew>
                )}
                {/* Diseño nuevo: el descuento es una fila de la sección de cobro. */}
                {!rediseno && puedeEditar && (
                <ButtonNew variant="secondary" icon={<Tag size={14} aria-hidden />} onClick={() => openSub("discount")} disabled={busy}>
                  {t("clinical.invoiceDetail.applyDiscount")}
                </ButtonNew>
                )}
                {puedeEditar && (
                <ButtonNew variant="danger" icon={<Trash2 size={14} aria-hidden />} onClick={handleDeleteDraft} disabled={busy}>
                  {t("clinical.invoiceDetail.deleteDraft")}
                </ButtonNew>
                )}
              </>
            )}

            {/* PENDIENTE / PARCIAL */}
            {/* ws1-t4 (decisión de Rafael): con pagos también se edita — no timbrada ni
                cancelada; el total no baja de lo pagado (lo decide el servidor). */}
            {!isDraft && onEditar && puedeEditar && facturaEditableEnEditor({ ...invoice, cfdiUuid: effectiveUuid }) && (
              <ButtonNew variant="secondary" icon={<Pencil size={14} aria-hidden />} onClick={() => onEditar(invoice)} disabled={busy}>
                {t("billing.invoiceEditor.editButton")}
              </ButtonNew>
            )}

            {isPending && (
              <>
                {rediseno ? botonRegistrarPago : puedeCobrar && !citaCanceladaConDinero && (
                <ButtonNew variant="primary" icon={<CreditCard size={14} aria-hidden />} onClick={() => setPaymentOpen(true)} disabled={busy}>
                  {t("clinical.invoiceDetail.collectPayment", { amount: fmtMXNdec(invoice.balance) })}
                </ButtonNew>
                )}
                {/* «Marcar pagada» liquida TODO el saldo de un clic. En una factura a
                    plazos eso borra el calendario de cuotas por un descuido (ws1-t4 #69):
                    ahí se cobra con «Cobrar», que pide el monto (y si de verdad es
                    todo, se teclea todo). */}
                {frenoMarkPaid.visible && (
                  <div style={{ flexBasis: "100%", width: "100%" }}>
                    <AvisoCajaCerrada onCobrarDeTodosModos={() => void handleMarkPaid(true)} ocupado={busy} />
                  </div>
                )}
                {puedeCobrar && !citaCanceladaConDinero && !esPlanAPlazos(condicionesPago) && (
                  <ButtonNew variant="secondary" icon={<CheckCircle2 size={14} aria-hidden />} onClick={() => void handleMarkPaid()} disabled={busy}>
                    {t("clinical.invoiceDetail.markPaid")}
                  </ButtonNew>
                )}
                {puedeEnviarRecibo && (
                <ButtonNew variant="secondary" icon={<MessageCircle size={14} aria-hidden />} onClick={() => handleSendWhatsApp()} disabled={busy}>
                  {t("clinical.invoiceDetail.sendWhatsApp")}
                </ButtonNew>
                )}
                {canEditPrice && (
                  <>
                    <ButtonNew variant="secondary" icon={<Pencil size={14} aria-hidden />} onClick={() => openSub("edit-price")} disabled={busy}>
                      {t("clinical.invoiceDetail.editPrice")}
                    </ButtonNew>
                    {!rediseno && (
                    <ButtonNew variant="secondary" icon={<Tag size={14} aria-hidden />} onClick={() => openSub("discount")} disabled={busy}>
                      {t("clinical.invoiceDetail.applyDiscount")}
                    </ButtonNew>
                    )}
                  </>
                )}
                {puedeReembolsar && (invoice.paid === 0 || soloAnticipo) && (
                  <ButtonNew variant="danger" icon={<XCircle size={14} aria-hidden />} onClick={() => openSub("cancel")} disabled={busy}>
                    {t("clinical.invoiceDetail.cancelInvoice")}
                  </ButtonNew>
                )}
              </>
            )}

            {/* PAGADA */}
            {isPaid && (
              <>
                {puedeReembolsar && (
                <ButtonNew variant="danger" icon={<Undo2 size={14} aria-hidden />} onClick={() => openSub("refund")} disabled={busy}>
                  {t("clinical.invoiceDetail.refund")}
                </ButtonNew>
                )}
                {/* Pagada SOLO con el saldo a favor: cancelarla lo devuelve a favor. */}
                {puedeReembolsar && soloAnticipo && (
                  <ButtonNew variant="danger" icon={<XCircle size={14} aria-hidden />} onClick={() => openSub("cancel")} disabled={busy}>
                    {t("clinical.invoiceDetail.cancelInvoice")}
                  </ButtonNew>
                )}
                {effectiveUuid && (
                  <ButtonNew variant="secondary" icon={<FileText size={14} aria-hidden />} onClick={() => {
                    navigator.clipboard.writeText(effectiveUuid).catch(() => {});
                    toast.success(t("clinical.invoiceDetail.cfdiUuidCopied"));
                  }}>
                    {t("clinical.invoiceDetail.copyCfdiUuid")}
                  </ButtonNew>
                )}
              </>
            )}

            {/* CFDI — facturar, o descargar PDF/XML si ya está timbrada */}
            {canInvoiceCfdi && (
              effectiveUuid ? (
                <>
                  <ButtonNew variant="secondary" icon={<Download size={14} aria-hidden />} onClick={() => downloadCfdi("pdf")} disabled={busy}>
                    {t("clinical.invoiceDetail.downloadPdf")}
                  </ButtonNew>
                  <ButtonNew variant="secondary" icon={<Download size={14} aria-hidden />} onClick={() => downloadCfdi("xml")} disabled={busy}>
                    {t("clinical.invoiceDetail.downloadXml")}
                  </ButtonNew>
                </>
              ) : puedeTimbrar && (
                <ButtonNew variant="secondary" icon={<Receipt size={14} aria-hidden />} onClick={openCfdiForm} disabled={busy}>
                  {t("clinical.invoiceDetail.cfdiInvoiceBtn")}
                </ButtonNew>
              )
            )}

            {/* Imprimir comprobante A4 en pestaña nueva (ya no window.print()) */}
            <ButtonNew variant="secondary" icon={<Printer size={14} aria-hidden />} onClick={() => window.open(`/api/invoices/${invoice.id}/print`, "_blank")}>
              {t("common.print")}
            </ButtonNew>

            <ButtonNew variant="ghost" onClick={onClose}>{t("common.close")}</ButtonNew>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Sub-modal: Reembolsar */}
      <Dialog open={sub === "refund"} onOpenChange={(o) => { if (!o && !busy) setSub(null); }}>
        <DialogContent className={cx("max-w-md bg-card text-foreground border border-border", `${CLASES_FACTURA_REDISENO} ${c.modal} ${c.modalEstrecho}`)}>
          <DialogHeader className={rediseno ? c.cabecera : undefined}>
            <DialogTitle className={cx("text-foreground font-bold", c.titulo)}>{t("clinical.invoiceDetail.refundInvoiceTitle", { number: invoice.invoiceNumber })}</DialogTitle>
          </DialogHeader>
          <div className={cx("px-6 py-4 space-y-3 flex-1 overflow-y-auto min-h-0", c.cuerpo)}>
            <p className={cx("text-xs text-muted-foreground", c.texto)}>{t("clinical.invoiceDetail.totalPaidLabel")} <span className={cx("font-mono font-bold text-foreground", c.cifra)}>{fmtMXNdec(invoice.paid)}</span></p>
            <div className={cx("space-y-1.5", c.campo)}>
              <Label>{t("clinical.invoiceDetail.refundAmountLabel")}</Label>
              <Input type="number" step="0.01" min={0} value={refundAmount} onChange={(e) => setRefundAmount(e.target.value)} autoFocus />
            </div>
            <div className={cx("space-y-1.5", c.campo)}>
              <Label>{t("clinical.invoiceDetail.reason")}</Label>
              <textarea
                className="input-new"
                style={{ resize: "none", minHeight: 60 }}
                placeholder={t("clinical.invoiceDetail.refundReasonPlaceholder")}
                value={refundReason} onChange={(e) => setRefundReason(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter className={rediseno ? c.pie : undefined}>
            <ButtonNew variant="ghost" onClick={() => setSub(null)} disabled={busy}>{t("common.cancel")}</ButtonNew>
            <ButtonNew variant="danger" onClick={handleRefund} disabled={busy}>
              {busy ? t("clinical.invoiceDetail.processing") : t("clinical.invoiceDetail.refundAmountBtn", { amount: fmtMXNdec(Number(refundAmount) || 0) })}
            </ButtonNew>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Sub-modal: Editar precio */}
      <Dialog open={sub === "edit-price"} onOpenChange={(o) => { if (!o && !busy) setSub(null); }}>
        <DialogContent className={cx("max-w-md bg-card text-foreground border border-border", `${CLASES_FACTURA_REDISENO} ${c.modal} ${c.modalEstrecho}`)}>
          <DialogHeader className={rediseno ? c.cabecera : undefined}>
            <DialogTitle className={cx("text-foreground font-bold", c.titulo)}>{t("clinical.invoiceDetail.editPrice")}</DialogTitle>
          </DialogHeader>
          <div className={cx("px-6 py-4 space-y-3 flex-1 overflow-y-auto min-h-0", c.cuerpo)}>
            <p className={cx("text-xs text-muted-foreground", c.texto)}>{t("clinical.invoiceDetail.currentTotalLabel")} <span className={cx("font-mono font-bold text-foreground", c.cifra)}>{fmtMXNdec(invoice.total)}</span></p>
            <div className={cx("space-y-1.5", c.campo)}>
              <Label>{t("clinical.invoiceDetail.newTotalLabel")}</Label>
              <Input type="number" step="0.01" min={0} value={editTotal} onChange={(e) => setEditTotal(e.target.value)} autoFocus />
            </div>
            <p className={cx("text-[11px] text-muted-foreground", c.ayuda)}>{t("clinical.invoiceDetail.editPriceHelper")}</p>
          </div>
          <DialogFooter className={rediseno ? c.pie : undefined}>
            <ButtonNew variant="ghost" onClick={() => setSub(null)} disabled={busy}>{t("common.cancel")}</ButtonNew>
            <ButtonNew variant="primary" onClick={handleEditPrice} disabled={busy}>{busy ? t("common.saving") : t("clinical.invoiceDetail.savePrice")}</ButtonNew>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Sub-modal: Aplicar descuento */}
      <Dialog open={sub === "discount"} onOpenChange={(o) => { if (!o && !busy) setSub(null); }}>
        <DialogContent className={cx("max-w-md bg-card text-foreground border border-border", `${CLASES_FACTURA_REDISENO} ${c.modal} ${c.modalEstrecho}`)}>
          <DialogHeader className={rediseno ? c.cabecera : undefined}>
            <DialogTitle className={cx("text-foreground font-bold", c.titulo)}>{t("clinical.invoiceDetail.applyDiscount")}</DialogTitle>
          </DialogHeader>
          <div className={cx("px-6 py-4 space-y-3 flex-1 overflow-y-auto min-h-0", c.cuerpo)}>
            <p className={cx("text-xs text-muted-foreground", c.texto)}>{t("clinical.invoiceDetail.currentSubtotalLabel")} <span className={cx("font-mono font-bold text-foreground", c.cifra)}>{fmtMXNdec(invoice.subtotal ?? invoice.total + (invoice.discount ?? 0))}</span></p>
            <div className={cx("space-y-1.5", c.campo)}>
              <Label>{t("clinical.invoiceDetail.discountMxnLabel")}</Label>
              <Input type="number" step="0.01" min={0} value={discountAmt} onChange={(e) => setDiscountAmt(e.target.value)} autoFocus />
            </div>
            <p className={cx("text-[11px] text-muted-foreground", c.ayuda)}>{t("clinical.invoiceDetail.discountHelper")}</p>
          </div>
          <DialogFooter className={rediseno ? c.pie : undefined}>
            <ButtonNew variant="ghost" onClick={() => setSub(null)} disabled={busy}>{t("common.cancel")}</ButtonNew>
            <ButtonNew variant="primary" onClick={handleDiscount} disabled={busy}>{busy ? t("clinical.invoiceDetail.applying") : t("clinical.invoiceDetail.applyDiscount")}</ButtonNew>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Sub-modal: Cancelar factura */}
      <Dialog open={sub === "cancel"} onOpenChange={(o) => { if (!o && !busy) setSub(null); }}>
        <DialogContent className={cx("max-w-md bg-card text-foreground border border-border", `${CLASES_FACTURA_REDISENO} ${c.modal} ${c.modalEstrecho}`)}>
          <DialogHeader className={rediseno ? c.cabecera : undefined}>
            <DialogTitle className={cx("text-foreground font-bold", c.titulo)}>{t("clinical.invoiceDetail.cancelInvoiceTitle", { number: invoice.invoiceNumber })}</DialogTitle>
          </DialogHeader>
          <div className={cx("px-6 py-4 space-y-3 flex-1 overflow-y-auto min-h-0", c.cuerpo)}>
            <p className={cx("text-xs text-muted-foreground", c.texto)}>{t("clinical.invoiceDetail.cancelWarning")}</p>
            {/* ws1-t1 (B2): cancelar cierra el anticipo pendiente (y, si
                apartaba una cita, quita el apartado) — que no se lea como
                sorpresa a mitad de la confirmación. */}
            {anticipoPendiente && (
              <p className={cx("text-xs text-muted-foreground", c.texto)} role="alert">
                {t("clinical.invoiceDetail.cancelWarningAnticipo", { monto: fmtMXNdec(anticipoPendiente.amount) })}
              </p>
            )}
            <div className={cx("space-y-1.5", c.campo)}>
              <Label>{t("clinical.invoiceDetail.reasonOptional")}</Label>
              <textarea
                className="input-new"
                style={{ resize: "none", minHeight: 60 }}
                placeholder={t("clinical.invoiceDetail.cancelReasonPlaceholder")}
                value={cancelReason} onChange={(e) => setCancelReason(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter className={rediseno ? c.pie : undefined}>
            <ButtonNew variant="ghost" onClick={() => setSub(null)} disabled={busy}>{t("common.back")}</ButtonNew>
            <ButtonNew variant="danger" onClick={handleCancel} disabled={busy}>
              {busy ? t("clinical.invoiceDetail.cancelling") : t("clinical.invoiceDetail.confirmCancellation")}
            </ButtonNew>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Sub-modal: Facturar CFDI — datos fiscales del receptor */}
      <Dialog open={sub === "cfdi"} onOpenChange={(o) => { if (!o && !busy) setSub(null); }}>
        <DialogContent className={cx("max-w-md bg-card text-foreground border border-border", `${CLASES_FACTURA_REDISENO} ${c.modal} ${c.modalEstrecho}`)}>
          <DialogHeader className={rediseno ? c.cabecera : undefined}>
            <DialogTitle className={cx("text-foreground font-bold", c.titulo)}>{t("clinical.invoiceDetail.cfdiFormTitle")}</DialogTitle>
          </DialogHeader>
          <div className={cx("px-6 py-4 space-y-3 flex-1 overflow-y-auto min-h-0", c.cuerpo)}>
            <div className={cx("flex items-center justify-between gap-2", c.entreDos)}>
              <p className={cx("text-xs text-muted-foreground", c.texto)}>
                {cfdiLive === null
                  ? t("clinical.invoiceDetail.cfdiFormHelpNeutral")
                  : cfdiLive
                    ? t("clinical.invoiceDetail.cfdiFormHelpLive")
                    : t("clinical.invoiceDetail.cfdiFormHelp")}
              </p>
              {cfdiQuota && (
                <span className={cx("text-[11px] whitespace-nowrap", c.contador)} style={rediseno ? undefined : { color: "var(--text-3)" }}>
                  {t("clinical.invoiceDetail.cfdiMonthCounter", { used: cfdiQuota.used, included: cfdiQuota.included })}
                </span>
              )}
            </div>
            {cfdiMismatch && (
              <div
                className={cx("rounded-lg px-3 py-2 text-[11px] space-y-2", `${c.aviso} ${c.avisoPeligro}`)}
                style={rediseno ? undefined : {
                  background: "var(--danger-soft, rgba(225,29,72,0.08))",
                  border: "1px solid var(--danger)",
                  color: "var(--danger)",
                }}
              >
                <p>{cfdiMismatch}</p>
                <ButtonNew variant="secondary" size="sm" onClick={() => { setCfdiMismatch(null); setCfdiBlockCode(null); setSub(null); }}>
                  {cfdiBlockCode === "CFDI_LIVE_NOT_READY" || cfdiImpideReintento(cfdiBlockCode)
                    ? t("clinical.invoiceDetail.cfdiNotReadyDismiss")
                    : t("clinical.invoiceDetail.cfdiMismatchReview")}
                </ButtonNew>
              </div>
            )}
            {invoice.balance > 0 && (
              <div
                className={cx("rounded-lg px-3 py-2 text-[11px] space-y-2", `${c.aviso} ${c.avisoAlerta}`)}
                style={rediseno ? undefined : {
                  background: "var(--warning-soft)",
                  border: "1px solid var(--warning-border-strong)",
                  color: "var(--warning-strong)",
                }}
              >
                <p>{t("clinical.invoiceDetail.cfdiBalanceWarning")}</p>
                {/* Bloqueo suave: sin esta confirmación explícita el server
                    rechaza el timbrado de facturas con saldo (409 CFDI_UNPAID_PUE). */}
                <label className={cx("flex items-start gap-2 cursor-pointer font-medium", c.casilla)}>
                  <input type="checkbox" className={rediseno ? undefined : "mt-0.5"} checked={pueOk} onChange={(e) => setPueOk(e.target.checked)} />
                  <span>{t("clinical.invoiceDetail.cfdiUnpaidConfirm")}</span>
                </label>
              </div>
            )}
            {fiscalOrigen === "responsable" && responsableDePago && (
              <p className={cx("text-[11px]", c.texto)} data-cfdi-responsable>
                Datos del responsable de pago: <strong>{responsableDePago.nombreCompleto}</strong>
                {responsableDePago.parentesco ? ` (${responsableDePago.parentesco})` : ""}. El comprobante sale a su nombre, no al del paciente; lo que captures aquí se guarda en el responsable.
              </p>
            )}
            <div className={cx("space-y-1.5", c.campo)}>
              <Label>{t("clinical.invoiceDetail.fiscalRfc")}</Label>
              <Input value={fiscal.rfc} onChange={(e) => setFiscal(f => ({ ...f, rfc: e.target.value.toUpperCase() }))}
                className={cx("font-mono uppercase", "uppercase")} maxLength={13} autoFocus />
            </div>
            <div className={cx("space-y-1.5", c.campo)}>
              <Label>{t("clinical.invoiceDetail.fiscalName")}</Label>
              <Input value={fiscal.nombre} onChange={(e) => setFiscal(f => ({ ...f, nombre: e.target.value }))} />
            </div>
            <div className={cx("grid grid-cols-2 gap-3", c.rejilla2)}>
              <div className={cx("space-y-1.5", c.campo)}>
                <Label>{t("clinical.invoiceDetail.fiscalRegimen")}</Label>
                <select className="input-new"
                  value={fiscal.regimen} onChange={(e) => setFiscal(f => ({ ...f, regimen: e.target.value }))}>
                  {REGIMENES_FISCALES.map(r => <option key={r.clave} value={r.clave}>{r.clave} — {r.descripcion}</option>)}
                </select>
              </div>
              <div className={cx("space-y-1.5", c.campo)}>
                <Label>{t("clinical.invoiceDetail.fiscalCp")}</Label>
                <Input value={fiscal.cp} onChange={(e) => setFiscal(f => ({ ...f, cp: e.target.value.replace(/\D/g, "") }))}
                  className={rediseno ? undefined : "font-mono"} maxLength={5} />
              </div>
            </div>
            <div className={cx("space-y-1.5", c.campo)}>
              <Label>{t("clinical.invoiceDetail.fiscalUso")}</Label>
              <select className="input-new"
                value={fiscal.uso} onChange={(e) => setFiscal(f => ({ ...f, uso: e.target.value }))}>
                {USOS_CFDI.map(u => <option key={u.clave} value={u.clave}>{u.clave} — {u.descripcion}</option>)}
              </select>
            </div>
            <div className={cx("grid grid-cols-2 gap-3", c.rejilla2)}>
              <div className={cx("space-y-1.5", c.campo)}>
                <Label>{t("clinical.invoiceDetail.cfdiPaymentFormLabel")}</Label>
                <select className="input-new"
                  value={fiscal.formaPago} onChange={(e) => setFiscal(f => ({ ...f, formaPago: e.target.value }))}>
                  {FORMAS_PAGO_SAT.map(fp => <option key={fp.clave} value={fp.clave}>{fp.clave} — {fp.descripcion}</option>)}
                </select>
              </div>
              <div className={cx("space-y-1.5", c.campo)}>
                <Label>{t("clinical.invoiceDetail.cfdiTaxesLabel")}</Label>
                <select className="input-new"
                  value={fiscal.impuestos}
                  onChange={(e) => setFiscal(f => ({ ...f, impuestos: e.target.value as CfdiTaxMode }))}>
                  <option value="exento">{t("clinical.invoiceDetail.cfdiTaxExempt")}</option>
                  <option value="iva16">{t("clinical.invoiceDetail.cfdiTaxIva16")}</option>
                </select>
              </div>
            </div>
            <div className={cx("space-y-1.5", c.campo)}>
              <Label>{t("clinical.invoiceDetail.fiscalEmail")}</Label>
              <Input type="email" value={fiscal.email} onChange={(e) => setFiscal(f => ({ ...f, email: e.target.value }))} />
            </div>
          </div>
          <DialogFooter className={rediseno ? c.pie : undefined}>
            <ButtonNew variant="ghost" onClick={() => setSub(null)} disabled={busy}>{t("common.cancel")}</ButtonNew>
            <ButtonNew variant="primary" onClick={handleStampCfdi} disabled={busy || cfdiImpideReintento(cfdiBlockCode) || (invoice.balance > 0 && !pueOk)}>
              {busy ? t("clinical.invoiceDetail.stamping") : t("clinical.invoiceDetail.stampCfdiBtn")}
            </ButtonNew>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* «¿Marcar pagada?» / «¿Eliminar borrador?» con el diseño nuevo. Solo se
          monta con el interruptor; apagado, la pregunta la sigue haciendo el
          useConfirm global. El botón de aceptar corre la MISMA llamada. */}
      {rediseno && (
        <ConfirmacionFactura
          abierta={confirmacion !== null}
          titulo={confirmacion === "delete-draft" ? t("clinical.invoiceDetail.deleteDraft") : t("clinical.invoiceDetail.markPaid")}
          descripcion={confirmacion === "delete-draft"
            ? t("clinical.invoiceDetail.deleteDraftConfirm", { number: invoice.invoiceNumber })
            : t("clinical.invoiceDetail.markPaidConfirm", { balance: fmtMXNdec(invoice.balance) })}
          textoConfirmar={confirmacion === "delete-draft" ? t("clinical.invoiceDetail.deleteDraft") : t("clinical.invoiceDetail.markPaid")}
          textoCancelar={t("common.cancel")}
          peligro={confirmacion === "delete-draft"}
          ocupado={busy}
          onCancelar={() => setConfirmacion(null)}
          onConfirmar={() => {
            const cual = confirmacion;
            setConfirmacion(null);
            if (cual === "mark-paid") void ejecutarMarkPaid();
            if (cual === "delete-draft") void ejecutarDeleteDraft();
          }}
        />
      )}

      {/* PaymentModal compartido — el de Commit 1 */}
      <PaymentModal
        rediseno={rediseno}
        open={paymentOpen}
        invoice={paymentOpen ? {
          id: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
          total: invoice.total,
          paid: invoice.paid,
          balance: invoice.balance,
          status: invoice.status,
          patientName,
        } : null}
        onClose={() => setPaymentOpen(false)}
        onSuccess={handlePaymentSuccess}
        montoSugerido={montoSugerido}
      />

      <ModalPedirAnticipo
        open={pidiendoAnticipo}
        onClose={() => setPidiendoAnticipo(false)}
        origen="factura"
        id={invoice.id}
        onListo={() => { void onMutated(); setAnticipoTick((n) => n + 1); }}
      />

      <ModalRegistrarAnticipo
        open={registrandoAnticipo}
        onClose={() => setRegistrandoAnticipo(false)}
        invoiceId={invoice.id}
        saldo={invoice.balance}
        anticipoPendiente={anticipoPendiente}
        onListo={() => { void onMutated(); void refrescarFactura(); setAnticipoTick((n) => n + 1); }}
      />
    </>
  );
}
