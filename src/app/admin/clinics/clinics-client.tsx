"use client";

/**
 * /admin/clinics — la lista (rediseño ws1-t2, 26-sep-2026).
 *
 * Menos texto, más jerarquía: chips de estado, barras de consumo, una línea
 * de metadato por celda. Nada de lo que se DECIDE cambió: el veredicto de cada
 * clínica sigue saliendo de `evaluarSaludClinica` (@/lib/admin/salud-clinica),
 * el MRR de `computeMrr` (plan_configs) y las tres acciones (+30, +14,
 * suspender) llaman al mismo endpoint con el mismo cuerpo.
 *
 * Orden por defecto: ÚLTIMA COMPRA (el último pago de suscripción cobrado;
 * si nunca pagó, su alta, y va detrás). Se puede cambiar desde el selector.
 */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Search, ArrowDownWideNarrow, ArrowUpNarrowWide, Upload } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import toast from "react-hot-toast";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { AvatarNew } from "@/components/ui/design-system/avatar-new";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { PlanStatusBadge } from "@/components/admin/plan-status-badge";
import { includedBranchesHint, mrrBreakdownHint, type AdminMrr } from "@/lib/admin/mrr-core";
import { conservedMonthlyPrice } from "@/lib/billing/plan-overrides";
import {
  evaluarSaludClinica,
  resumirCartera,
  ordenarPorAtencion,
  ETIQUETA_ESTADO_OPERATIVO,
  DIAS_VENTANA_ACTIVIDAD,
  DIAS_APAGADA,
  MINUTOS_EN_LINEA,
  type SaludClinica,
  type Severidad,
  type NivelActividad,
} from "@/lib/admin/salud-clinica";
import {
  bytesCortos, cercaDelTope, compararUltimaCompraDesc, metodoDePago, tokensCortos, ultimaCompra, type UsoClinica,
} from "@/lib/admin/uso-core";
import { fechaAdmin } from "@/lib/admin/zona-horaria";
import {
  ETIQUETA_ESTADO_MODULO,
  ETIQUETA_ORIGEN,
  modulosEnUso,
  resumenMrrModulos,
  type EstadoModulo,
  type ModuloDeClinica,
  type MrrModulos,
} from "@/lib/admin/modulos-core";
import { BarraUso, Chip, Vacio, type TonoChip } from "@/components/admin/rediseno/piezas";
import type { OrigenClinicaDTO } from "@/lib/ads/origen";
import css from "./clinics.module.css";

/** Una fila del roster: la clínica más sus agregados de actividad, pago y consumo. */
export interface FilaClinica {
  id: string;
  name: string;
  slug: string;
  specialty: string;
  country: string;
  plan: string;
  trialEndsAt: Date | string;
  createdAt: Date | string;
  subscriptionStatus: string | null;
  nextBillingDate: Date | string | null;
  monthlyPrice: number | null;
  /** Condiciones conservadas (PR #425): el precio mensual que sigue pagando si no cambió de plan. */
  planOverrideFor?: string | null;
  priceMxnMonthlyOverride?: number | null;
  aiTokensUsed: number | null;
  aiTokensLimit: number | null;
  cancelRequested: boolean | null;
  paymentMethodCollected?: boolean | null;
  paymentMethodType?: string | null;
  paymentMethodLast4?: string | null;
  preferredPaymentMethod?: string | null;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  paypalSubscriptionId?: string | null;
  _count: { patients: number; users: number; appointments: number };
  users: Array<{ email: string | null; firstName: string | null; lastName: string | null }>;
  citasPasadas: number;
  citasVentana: number;
  citasFuturas: number;
  citasVentanaPrevia: number;
  facturasVentana: number;
  facturasVentanaPrevia: number;
  notasVentana: number;
  notasVentanaPrevia: number;
  enLinea: boolean;
  ultimaCitaAt: Date | string | null;
  proximaCitaAt: Date | string | null;
  ultimoAccesoAt: Date | string | null;
  pagosRegistrados: number;
  ultimoPagoAt: Date | string | null;
  totalPagado: number;
  /** Sede incluida en el plan de su clínica madre: no paga aparte, vale $0. */
  sedeIncluida: boolean;
  /** Consumo y cupos (@/lib/admin/uso-clinica). Ausente = no se midió. */
  uso?: UsoClinica;
  /**
   * Módulos que tiene o tuvo (@/lib/admin/modulos): cuáles, cómo los paga y
   * cuánto. Ausente = no se pudo leer (no es «no tiene ninguno»).
   */
  modulos?: ModuloDeClinica[];
  /** De dónde llegó (@/lib/admin/origen-clinica): «Meta · campaña · anuncio», «Google Ads», «Orgánico». */
  origen?: OrigenClinicaDTO;
}

const TONO_ORIGEN: Record<OrigenClinicaDTO["canal"], TonoChip> = {
  meta: "info", google: "brand", otro: "neutral", organico: "neutral",
};

interface Props {
  clinics: FilaClinica[];
  /** Precios de lista desde plan_configs. NUNCA un número escrito a mano. */
  planPrices: Record<string, number>;
  /** MRR ya calculado por la fuente única (@/lib/admin/mrr). */
  mrr: AdminMrr;
  /** Lo que entra por módulos, aparte de los planes. `null`/ausente = no se pudo medir. */
  mrrModulos?: MrrModulos | null;
  /** El "ahora" del servidor: así SSR e hidratación cuentan los mismos días. */
  ahoraISO: string;
  /** Lo que no se pudo medir del consumo, para decirlo. */
  avisosUso?: string[];
}

type ClaveFiltro = "todas" | "atencion" | "apagadas" | "trial-vencido" | "cobro-fallido" | "vencidas" | "tope" | "modulos" | "pruebas";
type ClaveOrden  = "compra" | "atencion" | "nombre" | "actividad" | "pacientes" | "alta" | "plan" | "renueva";

const LLAVE_PREFERENCIAS = "admin-clinics-preferencias-v2";

const ORDENES: Array<{ id: ClaveOrden; label: string }> = [
  { id: "compra",    label: "Última compra" },
  { id: "atencion",  label: "Atención" },
  { id: "renueva",   label: "Próxima renovación" },
  { id: "alta",      label: "Alta" },
  { id: "actividad", label: "Actividad" },
  { id: "pacientes", label: "Pacientes" },
  { id: "plan",      label: "Plan" },
  { id: "nombre",    label: "Nombre" },
];

const TONO_ESTADO: Record<string, TonoChip> = {
  "pagando":        "success",
  "cobro-fallido":  "danger",
  "trial-vigente":  "info",
  "trial-vencido":  "danger",
  "pago-pendiente": "warning",
  "vencida":        "danger",
  "prueba":         "neutral",
};

const TONO_SEVERIDAD: Record<Severidad, TonoChip> = { critico: "danger", alto: "warning", medio: "info" };

const ETIQUETA_ACTIVIDAD: Record<NivelActividad, string> = {
  "activa": "Activa", "nueva": "Nueva", "enfriandose": "Enfriándose", "apagada": "Apagada", "sin-estrenar": "Sin estrenar",
};

/** Estado operativo que se espera de cada veredicto del gate; si no coinciden, se enseña también el del gate. */
const ESTADO_ESPERADO: Record<string, string[]> = {
  active:   ["pagando"],
  past_due: ["cobro-fallido"],
  trial:    ["trial-vigente", "pago-pendiente", "prueba"],
  expired:  ["vencida", "prueba"],
};

function gateDiscrepa(salud: SaludClinica): boolean {
  return !(ESTADO_ESPERADO[salud.plan.kind] ?? []).includes(salud.estadoOperativo);
}

const TONO_MODULO: Record<EstadoModulo, TonoChip> = {
  "activo": "success", "baja-programada": "warning", "cobro-fallido": "danger", "vencido": "neutral", "cancelado": "neutral",
};

/** «$129.00/mes», «cortesía» o el estado cuando no está pagando. Importes de clinic_modules, sin IVA. */
function pagoDeModulo(m: ModuloDeClinica): string {
  if (m.estado === "cobro-fallido") return "cobro fallido";
  if (m.origen === "cortesia") return "cortesía";
  if (m.aporteMensual > 0) return `${formatCurrency(m.aporteMensual, "MXN")}/mes`;
  return "sin importe";
}

/** Todo lo que hay que saber del módulo, para el `title` del chip. */
function detalleDeModulo(m: ModuloDeClinica): string {
  const partes = [`${m.moduleName}: ${ETIQUETA_ESTADO_MODULO[m.estado]}`, ETIQUETA_ORIGEN[m.origen]];
  if (m.origen !== "cortesia" && m.pagado > 0) {
    partes.push(`paga ${formatCurrency(m.pagado, "MXN")} ${m.ciclo === "annual" ? "al año" : "al mes"}, sin IVA`);
  }
  if (m.hasta) {
    const hasta = fechaAdmin(m.hasta);
    if (hasta) partes.push(m.estado === "baja-programada" ? `se da de baja el ${hasta}` : m.origen === "tarjeta" ? `renueva el ${hasta}` : `hasta el ${hasta}`);
  }
  return partes.join(" · ");
}

function planTono(plan: string): TonoChip {
  return plan === "CLINIC" ? "brand" : plan === "PRO" ? "info" : "neutral";
}

export function AdminClinicsClient({ clinics: initial, planPrices, mrr, mrrModulos = null, ahoraISO, avisosUso = [] }: Props) {
  const askConfirm = useConfirm();
  const [clinics, setClinics] = useState(initial);
  const [search, setSearch]   = useState("");
  const [filtro, setFiltro]   = useState<ClaveFiltro>("todas");
  const [orden, setOrden]     = useState<ClaveOrden>("compra");
  const [desc, setDesc]       = useState(true);
  const [loading, setLoading] = useState<string | null>(null);
  const [verTodoTriage, setVerTodoTriage] = useState(false);

  // El "ahora" viene del servidor: si aquí se llamara a new Date(), el número
  // de días del render servidor y el del cliente podrían no coincidir.
  const ahora = useMemo(() => new Date(ahoraISO), [ahoraISO]);

  // Filtro y orden sobreviven a recargar. Se leen DESPUÉS del primer render
  // (en un efecto): leer localStorage durante el render rompería la hidratación.
  useEffect(() => {
    try {
      const crudo = window.localStorage.getItem(LLAVE_PREFERENCIAS);
      if (!crudo) return;
      const p = JSON.parse(crudo);
      if (typeof p.filtro === "string") setFiltro(p.filtro);
      if (typeof p.orden === "string" && ORDENES.some((o) => o.id === p.orden)) setOrden(p.orden);
      if (typeof p.desc === "boolean")  setDesc(p.desc);
    } catch {
      // localStorage bloqueado (modo privado): la pantalla funciona igual.
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(LLAVE_PREFERENCIAS, JSON.stringify({ filtro, orden, desc }));
    } catch {
      /* idem */
    }
  }, [filtro, orden, desc]);

  // EL cálculo, una sola vez por lista. Se rehace cuando una acción cambia una fila.
  const saludPorId = useMemo(() => {
    const m = new Map<string, SaludClinica>();
    for (const c of clinics) {
      m.set(c.id, evaluarSaludClinica({
        id: c.id,
        createdAt: c.createdAt,
        subscriptionStatus: c.subscriptionStatus,
        trialEndsAt: c.trialEndsAt,
        nextBillingDate: c.nextBillingDate,
        cancelRequested: c.cancelRequested,
        pacientes: c._count.patients,
        citasPasadas: c.citasPasadas,
        citasVentana: c.citasVentana,
        facturasVentana: c.facturasVentana,
        notasVentana: c.notasVentana,
        citasVentanaPrevia: c.citasVentanaPrevia,
        facturasVentanaPrevia: c.facturasVentanaPrevia,
        notasVentanaPrevia: c.notasVentanaPrevia,
        enLinea: c.enLinea,
        ultimaCitaAt: c.ultimaCitaAt,
        proximaCitaAt: c.proximaCitaAt,
        ultimoAccesoAt: c.ultimoAccesoAt,
        pagosRegistrados: c.pagosRegistrados,
        ultimoPagoAt: c.ultimoPagoAt,
      }, ahora));
    }
    return m;
  }, [clinics, ahora]);

  const nombrePorId = useMemo(() => new Map(clinics.map((c) => [c.id, c.name])), [clinics]);
  const resumen = useMemo(() => resumirCartera(Array.from(saludPorId.values())), [saludPorId]);
  const triage  = useMemo(() => ordenarPorAtencion(Array.from(saludPorId.values())), [saludPorId]);
  const criticas = triage.filter((s) => s.severidadMaxima === "critico").length;

  const cuentas = useMemo(() => {
    const v = Array.from(saludPorId.values());
    const usoDe = new Map(clinics.map((c) => [c.id, c.uso]));
    return {
      todas:            v.length,
      atencion:         v.filter((s) => s.riesgos.length > 0).length,
      apagadas:         v.filter((s) => s.actividad.nivel === "apagada").length,
      "trial-vencido":  v.filter((s) => s.estadoOperativo === "trial-vencido").length,
      "cobro-fallido":  v.filter((s) => s.estadoOperativo === "cobro-fallido").length,
      vencidas:         v.filter((s) => s.estadoOperativo === "vencida").length,
      tope:             v.filter((s) => !s.esPrueba && cercaDelTope(usoDe.get(s.id))).length,
      modulos:          clinics.filter((c) => modulosEnUso(c.modulos ?? []).length > 0).length,
      pruebas:          v.filter((s) => s.esPrueba).length,
    } as Record<ClaveFiltro, number>;
  }, [saludPorId, clinics]);

  const filtradas = useMemo(() => {
    const q = search.trim().toLowerCase();
    const pasa = (c: FilaClinica) =>
      !q ||
      c.name.toLowerCase().includes(q) ||
      c.slug.toLowerCase().includes(q) ||
      (c.users[0]?.email ?? "").toLowerCase().includes(q) ||
      // «ortodoncia» en el buscador deja las clínicas que tienen ese módulo.
      modulosEnUso(c.modulos ?? []).some((m) => m.moduleName.toLowerCase().includes(q));

    const filas = clinics.filter((c) => {
      if (!pasa(c)) return false;
      const s = saludPorId.get(c.id);
      if (!s) return false;
      switch (filtro) {
        case "atencion":        return s.riesgos.length > 0;
        case "apagadas":        return s.actividad.nivel === "apagada";
        case "trial-vencido":   return s.estadoOperativo === "trial-vencido";
        case "cobro-fallido":   return s.estadoOperativo === "cobro-fallido";
        case "vencidas":        return s.estadoOperativo === "vencida";
        case "tope":            return !s.esPrueba && cercaDelTope(c.uso);
        case "modulos":         return modulosEnUso(c.modulos ?? []).length > 0;
        case "pruebas":         return s.esPrueba;
        default:                return true;
      }
    });

    const signo = desc ? -1 : 1;
    const valor = (c: FilaClinica): number | string => {
      const s = saludPorId.get(c.id)!;
      switch (orden) {
        case "nombre":     return c.name.toLowerCase();
        case "actividad":  return s.actividad.volumen.total;
        case "pacientes":  return c._count.patients;
        case "alta":       return new Date(c.createdAt).getTime();
        case "plan":       return planPrices[c.plan] ?? 0;
        // Sin fecha, al final en cualquier sentido.
        case "renueva":    return c.nextBillingDate ? new Date(c.nextBillingDate).getTime() : Number.POSITIVE_INFINITY * -signo;
        case "atencion":   return s.prioridad;
        default:           return 0;
      }
    };

    return filas.sort((a, b) => {
      if (orden === "compra") {
        const r = compararUltimaCompraDesc(a, b);
        return desc ? r : -r;
      }
      const va = valor(a), vb = valor(b);
      if (typeof va === "string" || typeof vb === "string") {
        return String(va).localeCompare(String(vb), "es") * signo;
      }
      return (va - vb) * signo;
    });
  }, [clinics, saludPorId, search, filtro, orden, desc, planPrices]);

  // ── Acciones. NO se tocan: mismo endpoint, mismo cuerpo, mismo texto. ────

  async function updatePlan(clinicId: string, plan: string) {
    setLoading(clinicId);
    try {
      const res = await fetch(`/api/admin/clinics/${clinicId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan }),
      });
      if (!res.ok) throw new Error();
      setClinics(prev => prev.map(c => c.id === clinicId ? { ...c, plan } : c));
      toast.success("Plan actualizado");
    } catch {
      toast.error("Error al actualizar");
    } finally {
      setLoading(null);
    }
  }

  async function extendTrial(clinicId: string, days: number) {
    setLoading(clinicId);
    try {
      const trialEndsAt = new Date();
      trialEndsAt.setDate(trialEndsAt.getDate() + days);
      const res = await fetch(`/api/admin/clinics/${clinicId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trialEndsAt: trialEndsAt.toISOString() }),
      });
      if (!res.ok) throw new Error();
      setClinics(prev => prev.map(c => c.id === clinicId ? { ...c, trialEndsAt: trialEndsAt.toISOString() } : c));
      toast.success(`Trial extendido ${days} días`);
    } catch {
      toast.error("Error");
    } finally {
      setLoading(null);
    }
  }

  async function suspendClinic(clinicId: string) {
    if (!(await askConfirm({
      title: "¿Suspender esta clínica?",
      description: "Los usuarios verán una pantalla de pago hasta que renueven su suscripción.",
      variant: "warning",
      confirmText: "Suspender",
    }))) return;
    setLoading(clinicId);
    try {
      const past = new Date("2000-01-01");
      await fetch(`/api/admin/clinics/${clinicId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trialEndsAt: past.toISOString() }),
      });
      setClinics(prev => prev.map(c => c.id === clinicId ? { ...c, trialEndsAt: past.toISOString() } : c));
      toast.success("Clínica suspendida");
    } catch {
      toast.error("Error");
    } finally {
      setLoading(null);
    }
  }

  // ── Pintado ──────────────────────────────────────────────────────────────

  const FILTROS: Array<{ id: ClaveFiltro; label: string }> = [
    { id: "todas",          label: "Todas" },
    { id: "atencion",       label: "Atender" },
    { id: "cobro-fallido",  label: "Cobro fallido" },
    { id: "trial-vencido",  label: "Trial vencido" },
    { id: "apagadas",       label: "Apagadas" },
    { id: "vencidas",       label: "Vencidas" },
    { id: "tope",           label: "Cerca del tope" },
    { id: "modulos",        label: "Con módulos" },
    { id: "pruebas",        label: "Pruebas" },
  ];

  const triageVisible = verTodoTriage ? triage : triage.slice(0, 5);
  const etiquetaOrden = ORDENES.find((o) => o.id === orden)?.label ?? "";

  return (
    <div className={`${css.pagina} dcp-pagina`}>
      {/* ── Cabecera ──────────────────────────────────────────────────── */}
      <header className="dcp-cabecera">
        <div>
          <h1 className="dcp-titulo">Clínicas</h1>
          <p className="dcp-sub">
            {resumen.reales} reales
            {resumen.pruebas > 0 && ` · ${resumen.pruebas} de prueba`}
            {resumen.enLinea > 0 && (
              <span title={`Con sesión en el panel en los últimos ${MINUTOS_EN_LINEA} minutos`}>
                {" · "}<span className="dcp-online" style={{ verticalAlign: "1px" }} /> {resumen.enLinea} en línea
              </span>
            )}
          </p>
        </div>
      </header>

      {/* ── Cifras ────────────────────────────────────────────────────── */}
      <div className={css.cifras}>
        <div className={css.cifra}>
          <div className={css.cifraEtiqueta}>Pagando</div>
          <div className={css.cifraValor}>{resumen.porEstado.pagando}</div>
          <div className={css.cifraPie}>de {resumen.reales} reales</div>
        </div>
        <div className={css.cifra}>
          <div className={css.cifraEtiqueta}>MRR</div>
          {/* Planes + módulos. Los módulos salen de lo que cada clínica pagó
              (clinic_modules), no del precio de catálogo; una cortesía vale $0. */}
          <div className={css.cifraValor} data-mrr-total>{formatCurrency(mrr.total + (mrrModulos?.total ?? 0), "MXN")}</div>
          <div className={css.cifraPie}>
            Planes {formatCurrency(mrr.total, "MXN")}: {mrrBreakdownHint(mrr)}
            {mrr.includedBranches > 0 && ` · ${includedBranchesHint(mrr.includedBranches)}`}
          </div>
          <div className={css.cifraPie} data-mrr-modulos>
            {mrrModulos
              ? `Módulos ${formatCurrency(mrrModulos.total, "MXN")}: ${resumenMrrModulos(mrrModulos)}`
              : "Módulos: sin medir (no suman a esta cifra)"}
          </div>
          {/* A QUIÉN cuenta. Esta cifra y la de /admin/clientes usan los mismos
              precios (plan_configs) y la misma regla de cobro, pero NO el mismo
              universo, y sin decirlo las dos pantallas parecen contradecirse. */}
          <div
            className={css.cifraUniverso}
            title="Toda clínica no archivada con subscriptionStatus = active, tenga o no una cuenta dueña viva. /admin/clientes cuenta menos: allí una clínica cuyo dueño se dio de baja no aparece. Las sedes incluidas en el plan de su madre (mismo dueño, sin cobro propio: ni Stripe, ni PayPal, ni fecha de renovación, ni precio negociado) valen $0: ya están pagadas dentro de la suscripción de la madre. Una clínica con su propia suscripción sí suma aunque comparta dueño. Mismo criterio en las dos pantallas."
          >
            Cuenta toda clínica activa no archivada, tenga cuenta dueña o no.
            En Clientes sale menos: allí hace falta un dueño activo.
            Una sede incluida en el plan de la madre vale $0: no suma.
          </div>
        </div>
        <div className={css.cifra}>
          <div className={css.cifraEtiqueta}>En trial</div>
          <div className={css.cifraValor}>{resumen.porEstado["trial-vigente"]}</div>
          <div className={css.cifraPie}>
            {resumen.periodosImplausibles > 0 ? `${resumen.periodosImplausibles} con fecha de fantasía` : "periodo por delante"}
          </div>
        </div>
        <div className={`${css.cifra} ${criticas > 0 ? css.cifraAlerta : ""}`}>
          <div className={css.cifraEtiqueta}>Atender</div>
          <div className={css.cifraValor}>{triage.length}</div>
          <div className={css.cifraPie}>{criticas} crítica{criticas === 1 ? "" : "s"}</div>
        </div>
        <div className={`${css.cifra} ${resumen.porActividad.apagada > 0 ? css.cifraAlerta : ""}`}>
          <div className={css.cifraEtiqueta}>Apagadas</div>
          <div className={css.cifraValor}>{resumen.porActividad.apagada}</div>
          <div className={css.cifraPie}>sin citas en {DIAS_APAGADA}+ días</div>
        </div>
      </div>

      {/* ── Atender hoy ───────────────────────────────────────────────── */}
      <section className="dcp-card" aria-label="Clínicas que exigen atención">
        <header className="dcp-card__head">
          <div>
            <h2 className="dcp-card__title">Atender hoy</h2>
            <div className="dcp-card__sub">
              {triage.length === 0 ? "sin pendientes" : `${triage.length} de ${resumen.reales} · ${criticas} crítica${criticas === 1 ? "" : "s"}`}
            </div>
          </div>
          {triage.length > 5 && (
            <button type="button" className="dcp-enlace" style={{ background: "none", border: "none", cursor: "pointer", font: "inherit" }} onClick={() => setVerTodoTriage((v) => !v)}>
              {verTodoTriage ? "Ver 5" : `Ver las ${triage.length}`}
            </button>
          )}
        </header>
        {triage.length === 0 ? (
          <Vacio>Ninguna clínica en riesgo ahora mismo.</Vacio>
        ) : (
          <ul className="dcp-pend">
            {triageVisible.map((s) => {
              const r = s.riesgos[0];
              return (
                <li key={s.id}>
                  <Link href={`/admin/clinics/${s.id}`} className="dcp-pend__fila" title={r.detalle}>
                    <span className={`dcp-sev dcp-sev--${r.severidad}`} aria-hidden />
                    <span className="dcp-pend__texto">
                      <span className="dcp-pend__clinica">{nombrePorId.get(s.id) ?? s.id}</span>
                      <Chip tono={TONO_SEVERIDAD[r.severidad]} sm>{r.titulo}</Chip>
                      {s.riesgos.length > 1 && <span className="dcp-suave" style={{ fontSize: 12 }}>+{s.riesgos.length - 1}</span>}
                    </span>
                    <span className="dcp-pend__dato">{ETIQUETA_ESTADO_OPERATIVO[s.estadoOperativo]}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* ── Herramientas ──────────────────────────────────────────────── */}
      <div className="dcp-toolbar">
        <div className="dcp-buscar">
          <Search size={14} aria-hidden />
          <input
            className="input-new"
            placeholder="Buscar clínica, slug o email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Buscar clínica"
          />
        </div>
        <div className="dcp-filtros" role="group" aria-label="Filtro">
          {FILTROS.map((f) => (
            <button key={f.id} type="button" className="dcp-filtro" aria-pressed={filtro === f.id} onClick={() => setFiltro(f.id)}>
              {f.label}
              <span className="dcp-filtro__n dcp-num">{cuentas[f.id]}</span>
            </button>
          ))}
        </div>
        <div className="dcp-orden">
          <label htmlFor="orden-clinicas">Ordenar</label>
          {/* Nombre de la A a la Z y renovación de la más cercana a la más lejana; lo demás, de mayor a menor. */}
          <select id="orden-clinicas" className="input-new" value={orden} onChange={(e) => { setOrden(e.target.value as ClaveOrden); setDesc(e.target.value !== "nombre" && e.target.value !== "renueva"); }}>
            {ORDENES.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
          <button type="button" className="icon-btn-new" onClick={() => setDesc((d) => !d)} title={desc ? "De mayor a menor" : "De menor a mayor"} aria-label="Invertir el orden">
            {desc ? <ArrowDownWideNarrow size={15} /> : <ArrowUpNarrowWide size={15} />}
          </button>
        </div>
      </div>

      {/* ── Tabla ─────────────────────────────────────────────────────── */}
      <div className="dcp-tabla dcp-tabla--apilada">
        <div className="dcp-tabla__scroll">
          <table>
            <thead>
              <tr>
                <th>Clínica</th>
                <th>Estado</th>
                <th>Plan</th>
                <th>Módulos</th>
                <th>Origen</th>
                <th>Última compra</th>
                <th>Renueva</th>
                <th>Uso</th>
                <th className="dcp-der">Pacientes</th>
                <th className="dcp-der">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filtradas.map((clinic) => {
                const salud     = saludPorId.get(clinic.id)!;
                const owner     = clinic.users[0];
                const isLoading = loading === clinic.id;
                const riesgo    = salud.riesgos[0];
                const listPrice = planPrices[clinic.plan] ?? 0;
                const negociado = Number(clinic.monthlyPrice ?? 0) > 0 ? Number(clinic.monthlyPrice) : null;
                const incluida  = clinic.sedeIncluida && negociado === null;
                // Lo mismo que vale en el MRR: negociado > sede incluida ($0) > precio conservado > lista.
                const conservado = negociado === null && !incluida ? conservedMonthlyPrice(clinic) : null;
                const compra    = ultimaCompra(clinic);
                const pago      = metodoDePago(clinic);
                // Una fecha de cobro ya pasada no es una renovación: se calla (la vencida ya lo dice su estado).
                const renueva   = clinic.nextBillingDate && new Date(clinic.nextBillingDate) >= ahora ? clinic.nextBillingDate : null;
                const u         = clinic.uso;
                const modulos   = clinic.modulos ? modulosEnUso(clinic.modulos) : null;
                const porModulos = (modulos ?? []).reduce((suma, m) => suma + m.aporteMensual, 0);
                const vol       = salud.actividad.volumen;

                return (
                  <tr key={clinic.id}>
                    <td data-col="Clínica">
                      <div className="dcp-celda-nombre">
                        <AvatarNew name={clinic.name} size="sm" />
                        <div className="dcp-celda-nombre__texto">
                          <Link href={`/admin/clinics/${clinic.id}`} className="dcp-nombre">
                            {clinic.name}
                            {salud.actividad.enLinea && <span className="dcp-online" style={{ marginLeft: 6, verticalAlign: "1px" }} title={`En el panel en los últimos ${MINUTOS_EN_LINEA} minutos`} />}
                          </Link>
                          <div className={css.meta} title={owner?.email ?? undefined}>
                            {owner ? (owner.email ?? `${owner.firstName ?? ""} ${owner.lastName ?? ""}`.trim()) : "sin contacto"}
                            {salud.avisos.esImportacion && <span title="Alta reciente con muchos pacientes: importación, no crecimiento"> · <Upload size={10} style={{ verticalAlign: "-1px" }} /> importación</span>}
                          </div>
                        </div>
                      </div>
                    </td>

                    <td data-col="Estado">
                      <div className={css.pila}>
                        <Chip tono={TONO_ESTADO[salud.estadoOperativo] ?? "neutral"} punto>
                          {ETIQUETA_ESTADO_OPERATIVO[salud.estadoOperativo]}
                        </Chip>
                        {/* Lo que dice el gate, SÓLO cuando no dice lo mismo. */}
                        {gateDiscrepa(salud) && (
                          <span title="Lo que ve la clínica: el gate de acceso todavía la deja entrar">
                            <PlanStatusBadge clinic={clinic} now={ahora} />
                          </span>
                        )}
                        {riesgo ? (
                          <Chip tono={TONO_SEVERIDAD[riesgo.severidad]} sm title={riesgo.detalle}>
                            {riesgo.titulo}{salud.riesgos.length > 1 ? ` +${salud.riesgos.length - 1}` : ""}
                          </Chip>
                        ) : (
                          <span className={css.meta} title={salud.actividad.diasSinCita === null ? "Nunca ha agendado" : `Última cita hace ${salud.actividad.diasSinCita} d`}>
                            {ETIQUETA_ACTIVIDAD[salud.actividad.nivel]}
                            {salud.actividad.diasSinAcceso !== null && ` · panel hace ${salud.actividad.diasSinAcceso} d`}
                          </span>
                        )}
                      </div>
                    </td>

                    <td data-col="Plan">
                      <div className={css.pila}>
                        <Chip tono={planTono(clinic.plan)}>{clinic.plan}</Chip>
                        <span className={`${css.meta} ${css.num}`}>
                          {formatCurrency(incluida ? 0 : negociado ?? conservado ?? listPrice, "MXN")}/mes
                          {negociado !== null && <span title="Precio negociado de esta clínica; manda sobre el del plan"> · negociado</span>}
                          {conservado !== null && <span title="Precio que esta clínica ya tenía antes de los planes nuevos y conserva mientras siga en este plan"> · conservado</span>}
                          {incluida && <span title="Sede incluida en el plan de su clínica madre: no paga aparte y no suma al MRR"> · incluida</span>}
                        </span>
                        <select
                          value={clinic.plan}
                          onChange={(e) => updatePlan(clinic.id, e.target.value)}
                          disabled={isLoading}
                          className={`input-new ${css.selectPlan}`}
                          aria-label={`Plan de ${clinic.name}`}
                        >
                          {Object.keys(planPrices).map((p) => (
                            <option key={p} value={p}>{p} — ${planPrices[p].toLocaleString("es-MX")}/mes</option>
                          ))}
                        </select>
                      </div>
                    </td>

                    <td data-col="Módulos">
                      <div className={css.pila}>
                        {modulos === null ? (
                          <span className={css.sinDato}>sin medir</span>
                        ) : modulos.length === 0 ? (
                          <span className={css.meta}>—</span>
                        ) : (
                          <>
                            {modulos.map((m) => (
                              <Chip key={m.moduleKey} tono={TONO_MODULO[m.estado]} sm title={detalleDeModulo(m)}>
                                {m.moduleName} · {pagoDeModulo(m)}
                              </Chip>
                            ))}
                            {modulos.length > 1 && porModulos > 0 && (
                              <span className={`${css.meta} ${css.num}`}>{formatCurrency(porModulos, "MXN")}/mes en módulos</span>
                            )}
                          </>
                        )}
                      </div>
                    </td>

                    <td data-col="Origen">
                      {clinic.origen ? (
                        <Chip tono={TONO_ORIGEN[clinic.origen.canal]} sm title={clinic.origen.etiqueta}>
                          {clinic.origen.etiqueta}
                        </Chip>
                      ) : (
                        <span className={css.sinDato}>sin medir</span>
                      )}
                    </td>

                    <td data-col="Última compra">
                      <div className={css.celda}>
                        <span className={`dcp-fuerte ${css.num}`}>
                          {compra.fecha ? fechaAdmin(compra.fecha) : "—"}
                          {compra.esAlta && <span className="dcp-suave" title="Nunca ha pagado: es la fecha de alta"> · alta</span>}
                        </span>
                        <span className={`${css.meta} ${css.num}`}>
                          {clinic.pagosRegistrados > 0
                            ? `${clinic.pagosRegistrados} pago${clinic.pagosRegistrados === 1 ? "" : "s"} · ${formatCurrency(clinic.totalPagado, "MXN")}`
                            : "sin pagos"}
                        </span>
                      </div>
                    </td>

                    <td data-col="Renueva">
                      <div className={css.celda}>
                        <span className={`dcp-fuerte ${css.num}`}>{renueva ? fechaAdmin(renueva) : "—"}</span>
                        <span className={css.meta}>{pago.etiqueta}</span>
                      </div>
                    </td>

                    <td data-col="Uso">
                      <div className={css.celda} style={{ minWidth: 132, gap: 6 }}>
                        {u ? (
                          <>
                            <BarraUso label="Disco" usado={u.storageUsado} tope={u.storageTope} fmt={bytesCortos} compacta />
                            {u.tokensTope > 0
                              ? <BarraUso label="IA" usado={u.tokensUsados} tope={u.tokensTope} fmt={tokensCortos} compacta />
                              : <span className={`${css.meta} ${css.num}`}>IA · sin cupo</span>}
                            <span className={`${css.meta} ${css.num}`} title={`${vol.citas} citas · ${vol.facturas} facturas · ${vol.notas} notas en ${DIAS_VENTANA_ACTIVIDAD} días`}>
                              {u.usuarios ?? "—"}{u.usuariosTope !== null ? `/${u.usuariosTope}` : ""} usuarios
                              {u.cfdiUsados !== null && ` · ${u.cfdiUsados}/${u.cfdiIncluidos} CFDI`}
                            </span>
                          </>
                        ) : (
                          <span className={css.sinDato}>sin medir</span>
                        )}
                      </div>
                    </td>

                    <td data-col="Pacientes" className="dcp-der">
                      <div className={css.celda} style={{ alignItems: "flex-end" }}>
                        <span className={`dcp-fuerte ${css.num}`} style={{ fontSize: 14 }}>{clinic._count.patients.toLocaleString("es-MX")}</span>
                        <span className={`${css.volumen} ${css.num}`} title={`Trabajo en ${DIAS_VENTANA_ACTIVIDAD} d`}>
                          <strong>{vol.total}</strong> en 30 d
                        </span>
                      </div>
                    </td>

                    <td data-col="Acciones" className="dcp-der">
                      {/* Los tres botones que YA cambiaban cosas: mismo texto, mismo comportamiento. */}
                      <div className={css.acciones}>
                        <ButtonNew size="sm" variant="secondary" onClick={() => extendTrial(clinic.id, 30)} disabled={isLoading}>
                          +30 días
                        </ButtonNew>
                        <ButtonNew size="sm" variant="secondary" onClick={() => extendTrial(clinic.id, 14)} disabled={isLoading}>
                          +14 días
                        </ButtonNew>
                        <ButtonNew size="sm" variant="ghost" onClick={() => suspendClinic(clinic.id)} disabled={isLoading} style={{ color: "var(--danger)" }}>
                          Suspender
                        </ButtonNew>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filtradas.length === 0 && (
                <tr>
                  <td colSpan={10} className="dcp-tabla__vacio">
                    {search || filtro !== "todas" ? "Ninguna clínica cumple ese filtro." : "No hay clínicas registradas."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="dcp-tabla__pie">
          <span>{filtradas.length} de {clinics.length} clínicas · ordenadas por {etiquetaOrden.toLowerCase()}{orden === "compra" ? " (último pago cobrado; sin pagos, la fecha de alta)" : ""}</span>
          {(resumen.sinRegistroDeAcceso > 0 || avisosUso.length > 0) && (
            <span>
              {resumen.sinRegistroDeAcceso > 0 && `${resumen.sinRegistroDeAcceso} sin sesión de panel registrada (la analítica es reciente)`}
              {avisosUso.length > 0 && ` · sin medir: ${avisosUso.join(", ")}`}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
