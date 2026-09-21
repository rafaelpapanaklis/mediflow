"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Search, AlertOctagon, AlertTriangle, Info, CheckCircle2,
  ArrowDown, ArrowUp, Flame, Snowflake, PowerOff, Sprout, CircleSlash, Upload,
  TrendingUp, TrendingDown, Minus,
} from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { formatRelativeDate } from "@/lib/format";
import toast from "react-hot-toast";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { BadgeNew }  from "@/components/ui/design-system/badge-new";
import { AvatarNew } from "@/components/ui/design-system/avatar-new";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { PlanStatusBadge } from "@/components/admin/plan-status-badge";
import { mrrBreakdownHint, type AdminMrr } from "@/lib/admin/mrr-core";
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
import css from "./clinics.module.css";

/** Una fila del roster: la clínica más sus agregados de actividad y pago. */
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
  aiTokensUsed: number | null;
  aiTokensLimit: number | null;
  cancelRequested: boolean | null;
  paymentMethodCollected?: boolean | null;
  paymentMethodType?: string | null;
  paymentMethodLast4?: string | null;
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
}

interface Props {
  clinics: FilaClinica[];
  /** Precios de lista desde plan_configs. NUNCA un número escrito a mano. */
  planPrices: Record<string, number>;
  /** MRR ya calculado por la fuente única (@/lib/admin/mrr). */
  mrr: AdminMrr;
  /** El "ahora" del servidor: así SSR e hidratación cuentan los mismos días. */
  ahoraISO: string;
}

type ClaveFiltro = "todas" | "atencion" | "apagadas" | "trial-vencido" | "cobro-fallido" | "vencidas" | "pruebas";
type ClaveOrden  = "atencion" | "nombre" | "actividad" | "pacientes" | "alta" | "plan";

const LLAVE_PREFERENCIAS = "admin-clinics-preferencias-v1";

/** Forma + color: el estado no se lee sólo por el color. */
const ICONO_SEVERIDAD: Record<Severidad, typeof AlertOctagon> = {
  critico: AlertOctagon,
  alto:    AlertTriangle,
  medio:   Info,
};

const CLASE_MARCA: Record<Severidad, string> = {
  critico: css.marcaCritico,
  alto:    css.marcaAlto,
  medio:   css.marcaMedio,
};

const ICONO_TENDENCIA = {
  sube:  TrendingUp,
  baja:  TrendingDown,
  igual: Minus,
} as const;

const CLASE_TENDENCIA: Record<string, string> = {
  sube:  css.tendenciaSube,
  baja:  css.tendenciaBaja,
  igual: css.tendenciaIgual,
};

const CLASE_RIESGO: Record<Severidad, string> = {
  critico: css.riesgoCritico,
  alto:    css.riesgoAlto,
  medio:   css.riesgoMedio,
};

const ACTIVIDAD: Record<NivelActividad, {
  etiqueta: string;
  icono: typeof Flame;
  clase: string;
  ancho: string;
}> = {
  "activa":       { etiqueta: "Activa",       icono: Flame,       clase: css.pulsoActiva,      ancho: "100%" },
  "nueva":        { etiqueta: "Nueva",        icono: Sprout,      clase: css.pulsoNueva,       ancho: "45%"  },
  "enfriandose":  { etiqueta: "Enfriándose",  icono: Snowflake,   clase: css.pulsoEnfriandose, ancho: "55%"  },
  "apagada":      { etiqueta: "Apagada",      icono: PowerOff,    clase: css.pulsoApagada,     ancho: "14%"  },
  "sin-estrenar": { etiqueta: "Sin estrenar", icono: CircleSlash, clase: css.pulsoSinEstrenar, ancho: "6%"   },
};

/** El estado operativo con su tono. `prueba` va en gris: no es un cliente. */
const TONO_ESTADO: Record<string, "success" | "warning" | "danger" | "info" | "neutral"> = {
  "pagando":        "success",
  "cobro-fallido":  "danger",
  "trial-vigente":  "info",
  "trial-vencido":  "danger",
  "pago-pendiente": "warning",
  "vencida":        "danger",
  "prueba":         "neutral",
};

/**
 * Estado operativo que se espera de cada veredicto del gate. Cuando coinciden,
 * pintar las dos insignias es repetir la misma frase dos veces; cuando NO
 * coinciden, esa discrepancia es justo lo que hay que ver — el caso de un
 * trial caducado cuyo subscriptionStatus "trialing" le sigue dando acceso.
 */
const ESTADO_ESPERADO: Record<string, string[]> = {
  active:   ["pagando"],
  past_due: ["cobro-fallido"],
  trial:    ["trial-vigente", "pago-pendiente", "prueba"],
  expired:  ["vencida", "prueba"],
};

function gateDiscrepa(salud: SaludClinica): boolean {
  return !(ESTADO_ESPERADO[salud.plan.kind] ?? []).includes(salud.estadoOperativo);
}

export function AdminClinicsClient({ clinics: initial, planPrices, mrr, ahoraISO }: Props) {
  const askConfirm = useConfirm();
  const [clinics, setClinics] = useState(initial);
  const [search, setSearch]   = useState("");
  const [filtro, setFiltro]   = useState<ClaveFiltro>("todas");
  const [orden, setOrden]     = useState<ClaveOrden>("atencion");
  const [desc, setDesc]       = useState(true);
  const [loading, setLoading] = useState<string | null>(null);
  const [verTodoTriage, setVerTodoTriage] = useState(false);

  // El "ahora" viene del servidor: si aquí se llamara a new Date(), el número
  // de días del render servidor y el del cliente podrían no coincidir y React
  // avisaría de un desajuste de hidratación.
  const ahora = useMemo(() => new Date(ahoraISO), [ahoraISO]);

  // Filtro y orden sobreviven a recargar la página. Se leen DESPUÉS del primer
  // render (en un efecto) a propósito: leer localStorage durante el render
  // rompería la hidratación, porque el servidor no tiene ese valor.
  useEffect(() => {
    try {
      const crudo = window.localStorage.getItem(LLAVE_PREFERENCIAS);
      if (!crudo) return;
      const p = JSON.parse(crudo);
      if (typeof p.filtro === "string") setFiltro(p.filtro);
      if (typeof p.orden === "string")  setOrden(p.orden);
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

  // EL cálculo, una sola vez por lista. Se rehace cuando una acción cambia una
  // fila (extender, suspender) para que el veredicto no se quede viejo.
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

  const nombrePorId = useMemo(
    () => new Map(clinics.map((c) => [c.id, c.name])),
    [clinics],
  );

  const resumen = useMemo(
    () => resumirCartera(Array.from(saludPorId.values())),
    [saludPorId],
  );

  const triage = useMemo(
    () => ordenarPorAtencion(Array.from(saludPorId.values())),
    [saludPorId],
  );

  const criticas = triage.filter((s) => s.severidadMaxima === "critico").length;

  const cuentas = useMemo(() => {
    const v = Array.from(saludPorId.values());
    return {
      todas:            v.length,
      atencion:         v.filter((s) => s.riesgos.length > 0).length,
      apagadas:         v.filter((s) => s.actividad.nivel === "apagada").length,
      "trial-vencido":  v.filter((s) => s.estadoOperativo === "trial-vencido").length,
      "cobro-fallido":  v.filter((s) => s.estadoOperativo === "cobro-fallido").length,
      vencidas:         v.filter((s) => s.estadoOperativo === "vencida").length,
      pruebas:          v.filter((s) => s.esPrueba).length,
    } as Record<ClaveFiltro, number>;
  }, [saludPorId]);

  const filtradas = useMemo(() => {
    const q = search.trim().toLowerCase();
    const pasa = (c: FilaClinica) => {
      if (!q) return true;
      return (
        c.name.toLowerCase().includes(q) ||
        c.slug.toLowerCase().includes(q) ||
        (c.users[0]?.email ?? "").toLowerCase().includes(q)
      );
    };

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
        case "pruebas":         return s.esPrueba;
        default:                return true;
      }
    });

    const signo = desc ? -1 : 1;
    const valor = (c: FilaClinica): number | string => {
      const s = saludPorId.get(c.id)!;
      switch (orden) {
        case "nombre":     return c.name.toLowerCase();
        // "Cuánto ha hecho": citas + facturas + notas de la ventana. Para
        // encontrar las muertas está el filtro "Apagadas", que es más directo
        // que ordenar por días sin cita.
        case "actividad":  return s.actividad.volumen.total;
        case "pacientes":  return c._count.patients;
        case "alta":       return new Date(c.createdAt).getTime();
        case "plan":       return planPrices[c.plan] ?? 0;
        default:           return s.prioridad;
      }
    };

    return filas.sort((a, b) => {
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
    { id: "trial-vencido",  label: "Trial vencido" },
    { id: "cobro-fallido",  label: "Cobro fallido" },
    { id: "apagadas",       label: "Apagadas" },
    { id: "vencidas",       label: "Vencidas" },
    { id: "pruebas",        label: "Pruebas" },
  ];

  const COLUMNAS: Array<{ id: ClaveOrden | null; label: string; alineado?: "right" }> = [
    { id: "nombre",    label: "Clínica" },
    { id: null,        label: "Estado" },
    { id: "actividad", label: "Actividad" },
    { id: "atencion",  label: "Riesgo" },
    { id: "plan",      label: "Plan" },
    { id: "pacientes", label: "Pacientes" },
    { id: null,        label: "Tokens IA" },
    { id: null,        label: "Acciones", alineado: "right" },
  ];

  function alternarOrden(id: ClaveOrden) {
    if (orden === id) { setDesc(d => !d); return; }
    setOrden(id);
    // Nombre se lee mejor de la A a la Z; lo demás, de mayor a menor.
    setDesc(id !== "nombre");
  }

  const triageVisible = verTodoTriage ? triage : triage.slice(0, 5);
  const claseBandeja = criticas > 0 ? css.bandejaCritica : triage.length > 0 ? css.bandejaAlta : "";

  return (
    <div className={css.pagina}>
      {/* ── Cabecera ────────────────────────────────────────────────────── */}
      <div className={css.cabecera}>
        <div>
          <h1 className={css.titulo}>Clínicas</h1>
          <p className={css.subtitulo}>
            {resumen.reales} clínicas reales
            {resumen.pruebas > 0 && ` · ${resumen.pruebas} cuentas de prueba fuera de los totales`}
            {resumen.enLinea > 0 && (
              <span className={css.enLinea} style={{ marginLeft: 10 }} title={`Con sesión en el panel en los últimos ${MINUTOS_EN_LINEA} minutos`}>
                <span className={css.enLineaPunto} aria-hidden="true" />
                {resumen.enLinea} en línea
              </span>
            )}
          </p>
          {resumen.sinRegistroDeAcceso > 0 && (
            <p className={css.aclaracion}>
              {resumen.sinRegistroDeAcceso} de {resumen.total} no tienen ninguna sesión de panel
              registrada. La analítica es reciente: eso no quiere decir que nadie haya entrado.
            </p>
          )}
        </div>
      </div>

      {/* ── Lo que exige atención HOY. Va primero a propósito: quien entra a
             /admin entra a saber qué se está rompiendo, no a ver cifras. ── */}
      <section className={`${css.bandeja} ${claseBandeja}`} aria-label="Clínicas que exigen atención">
        <div className={css.bandejaCabecera}>
          <h2 className={css.bandejaTitulo}>Atender hoy</h2>
          <span className={css.bandejaCuenta}>
            {triage.length === 0
              ? "sin pendientes"
              : `${triage.length} de ${resumen.reales} · ${criticas} crítica${criticas === 1 ? "" : "s"}`}
          </span>
        </div>

        {triage.length === 0 ? (
          <p className={css.bandejaVacia}>
            <CheckCircle2 size={15} style={{ color: "var(--success)" }} />
            Ninguna clínica en riesgo ahora mismo.
          </p>
        ) : (
          <>
            {triageVisible.map((s) => {
              const r = s.riesgos[0];
              const Icono = ICONO_SEVERIDAD[r.severidad];
              const otros = s.riesgos.length - 1;
              return (
                <Link key={s.id} href={`/admin/clinics/${s.id}`} className={css.fila}>
                  <span className={`${css.marca} ${css.filaMarca} ${CLASE_MARCA[r.severidad]}`} aria-hidden="true">
                    <Icono size={15} strokeWidth={2} />
                  </span>
                  <span className={css.filaNombre}>{nombrePorId.get(s.id) ?? s.id}</span>
                  <span className={css.filaDetalle}>
                    <strong>{r.titulo}.</strong> {r.detalle}
                    {otros > 0 && <span className={css.sinDato}> +{otros} más</span>}
                  </span>
                  <span className={`${css.filaMas} ${css.num}`}>
                    {ETIQUETA_ESTADO_OPERATIVO[s.estadoOperativo]}
                  </span>
                </Link>
              );
            })}
            {triage.length > 5 && (
              <button type="button" className={css.verTodo} onClick={() => setVerTodoTriage(v => !v)}>
                {verTodoTriage ? "Ver sólo las 5 primeras" : `Ver las ${triage.length}`}
              </button>
            )}
          </>
        )}
      </section>

      {/* ── Cifras, en segundo plano ────────────────────────────────────── */}
      <div className={css.cifras}>
        <div className={css.cifra}>
          <div className={css.cifraEtiqueta}>Pagando</div>
          <div className={css.cifraValor}>{resumen.porEstado.pagando}</div>
          <div className={css.cifraPie}>de {resumen.reales} reales</div>
        </div>
        <div className={css.cifra}>
          <div className={css.cifraEtiqueta}>MRR</div>
          <div className={css.cifraValor}>{formatCurrency(mrr.total, "MXN")}</div>
          <div className={css.cifraPie}>{mrrBreakdownHint(mrr)}</div>
        </div>
        <div className={`${css.cifra} ${resumen.porActividad.apagada > 0 ? css.cifraAlerta : ""}`}>
          <div className={css.cifraEtiqueta}>Apagadas</div>
          <div className={css.cifraValor}>{resumen.porActividad.apagada}</div>
          <div className={css.cifraPie}>sin citas en {DIAS_APAGADA}+ días</div>
        </div>
        <div className={`${css.cifra} ${resumen.porEstado["trial-vencido"] > 0 ? css.cifraAlerta : ""}`}>
          <div className={css.cifraEtiqueta}>Trial vencido usando</div>
          <div className={css.cifraValor}>{resumen.porEstado["trial-vencido"]}</div>
          <div className={css.cifraPie}>con acceso y sin pagar</div>
        </div>
        <div className={css.cifra}>
          <div className={css.cifraEtiqueta}>Trabajo · {DIAS_VENTANA_ACTIVIDAD} d</div>
          <div className={css.cifraValor}>{resumen.volumen.total.toLocaleString("es-MX")}</div>
          <div className={css.cifraPie}>
            {resumen.volumen.citas} citas · {resumen.volumen.facturas} facturas · {resumen.volumen.notas} notas
          </div>
        </div>
        <div className={css.cifra}>
          <div className={css.cifraEtiqueta}>En trial</div>
          <div className={css.cifraValor}>{resumen.porEstado["trial-vigente"]}</div>
          <div className={css.cifraPie}>
            {resumen.periodosImplausibles > 0
              ? `${resumen.periodosImplausibles} con fecha de fantasía`
              : "periodo por delante"}
          </div>
        </div>
      </div>

      {/* ── Herramientas ────────────────────────────────────────────────── */}
      <div className={css.herramientas}>
        <div className={`search-field ${css.buscador}`}>
          <Search size={14} className={css.buscadorIcono} />
          <input
            className={`input-new ${css.buscadorInput}`}
            placeholder="Buscar por nombre, slug, email…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <div className={`segment-new ${css.filtros}`}>
          {FILTROS.map(f => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFiltro(f.id)}
              className={`segment-new__btn ${filtro === f.id ? "segment-new__btn--active" : ""}`}
              aria-pressed={filtro === f.id}
            >
              {f.label}
              <span className={css.filtroCuenta}>{cuentas[f.id]}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ── Tabla ───────────────────────────────────────────────────────── */}
      <div className={css.tablaCaja}>
        <div className={css.tablaScroll}>
          <table className="table-new">
            <thead>
              <tr>
                {COLUMNAS.map(col => (
                  <th key={col.label} style={col.alineado ? { textAlign: "right" } : undefined}>
                    {col.id ? (
                      <button
                        type="button"
                        onClick={() => alternarOrden(col.id!)}
                        className={`${css.orden} ${orden === col.id ? css.ordenActivo : ""}`}
                        aria-label={`Ordenar por ${col.label}`}
                      >
                        {col.label}
                        {orden === col.id && (desc ? <ArrowDown size={11} /> : <ArrowUp size={11} />)}
                      </button>
                    ) : col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtradas.map(clinic => {
                const salud     = saludPorId.get(clinic.id)!;
                const owner     = clinic.users[0];
                const isLoading = loading === clinic.id;
                const used      = clinic.aiTokensUsed ?? 0;
                const limit     = clinic.aiTokensLimit ?? 0;
                const pct       = limit > 0 ? Math.round((used / limit) * 100) : 0;
                const tokenColor = pct > 90 ? "var(--danger)" : pct > 70 ? "var(--warning)" : "var(--success)";
                const act       = ACTIVIDAD[salud.actividad.nivel];
                const IconoAct  = act.icono;
                const vol       = salud.actividad.volumen;
                const tend      = salud.actividad.tendencia;
                const IconoTend = ICONO_TENDENCIA[tend.direccion];
                const riesgo    = salud.riesgos[0];
                const IconoRie  = riesgo ? ICONO_SEVERIDAD[riesgo.severidad] : null;
                // Precio de lista de plan_configs, o el negociado si lo tiene.
                const listPrice = planPrices[clinic.plan] ?? 0;
                const negociado = Number(clinic.monthlyPrice ?? 0) > 0 ? Number(clinic.monthlyPrice) : null;

                return (
                  <tr key={clinic.id}>
                    <td data-col="Clínica">
                      <div className={css.celdaNombre}>
                        <AvatarNew name={clinic.name} size="sm" />
                        <div style={{ minWidth: 0 }}>
                          <Link href={`/admin/clinics/${clinic.id}`} className={css.enlaceClinica}>
                            {clinic.name}
                          </Link>
                          <div className={`mono ${css.meta}`}>{clinic.slug}</div>
                          {owner ? (
                            <div className={css.meta} title={owner.email ?? undefined}>
                              {`${owner.firstName ?? ""} ${owner.lastName ?? ""}`.trim() || "—"}
                              {owner.email ? ` · ${owner.email}` : ""}
                            </div>
                          ) : (
                            <div className={css.sinDato}>Sin contacto registrado</div>
                          )}
                          {salud.avisos.esImportacion && (
                            <div className={css.meta} title="Alta reciente con muchos pacientes: los datos vienen de una importación, no de crecimiento">
                              <Upload size={10} /> Importación, no alta orgánica
                            </div>
                          )}
                        </div>
                      </div>
                    </td>

                    <td data-col="Estado">
                      <div className={css.pila}>
                        {/* El estado de VERDAD (incluye el trial caducado que
                            el gate deja pasar y el subscriptionStatus nulo). */}
                        <BadgeNew tone={TONO_ESTADO[salud.estadoOperativo] ?? "neutral"} dot>
                          {ETIQUETA_ESTADO_OPERATIVO[salud.estadoOperativo]}
                        </BadgeNew>
                        {/* Y debajo, lo que dice el gate — pero SÓLO cuando no
                            dice lo mismo. Misma regla que /dashboard, no una
                            copia por fila. */}
                        {gateDiscrepa(salud) && (
                          <span title="Lo que ve la clínica: el gate de acceso todavía la deja entrar">
                            <PlanStatusBadge clinic={clinic} now={ahora} />
                          </span>
                        )}
                        <span className={`${css.meta} ${css.num}`}>
                          alta {formatRelativeDate(clinic.createdAt)}
                        </span>
                      </div>
                    </td>

                    <td data-col="Actividad">
                      <div className={css.pila}>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, color: "var(--text-1)", fontWeight: 500 }}>
                          <IconoAct size={13} aria-hidden="true" />
                          {act.etiqueta}
                          {/* "En línea" como señal discreta, no como cifra. */}
                          {salud.actividad.enLinea && (
                            <span
                              className={css.enLinea}
                              title={`Sesión abierta en el panel en los últimos ${MINUTOS_EN_LINEA} minutos`}
                            >
                              <span className={css.enLineaPunto} aria-hidden="true" />
                              En línea
                            </span>
                          )}
                        </span>
                        <span className={css.pulso} aria-hidden="true">
                          <span className={`${css.pulsoRelleno} ${act.clase}`} style={{ width: act.ancho }} />
                        </span>

                        {/* CUÁNTO ha hecho, no sólo si hizo algo. */}
                        <span className={`${css.volumen} ${css.num}`}>
                          <strong>{vol.citas}</strong> citas
                          <span className={css.volumenSep}>·</span>
                          <strong>{vol.facturas}</strong> {vol.facturas === 1 ? "factura" : "facturas"}
                          <span className={css.volumenSep}>·</span>
                          <strong>{vol.notas}</strong> {vol.notas === 1 ? "nota" : "notas"}
                        </span>

                        <span className={`${css.meta} ${css.num}`}>
                          en {DIAS_VENTANA_ACTIVIDAD} d
                          {tend.deltaPct !== null ? (
                            <span className={`${css.tendencia} ${CLASE_TENDENCIA[tend.direccion]}`}>
                              <IconoTend size={11} aria-hidden="true" />
                              {tend.deltaPct > 0 ? "+" : ""}{tend.deltaPct}%
                              <span className={css.volumenSep}>vs. 30 d antes</span>
                            </span>
                          ) : tend.previo.total === 0 && vol.total > 0 ? (
                            <span className={`${css.tendencia} ${css.tendenciaSube}`}>
                              <TrendingUp size={11} aria-hidden="true" /> nuevo
                            </span>
                          ) : null}
                        </span>

                        <span className={`${css.meta} ${css.num}`}>
                          {salud.actividad.diasSinCita === null
                            ? "nunca agendó"
                            : `última cita hace ${salud.actividad.diasSinCita} d`}
                          {salud.actividad.diasSinAcceso !== null
                            ? ` · panel hace ${salud.actividad.diasSinAcceso} d`
                            : ""}
                        </span>

                        {/* Sin sesiones registradas NO es "nadie ha entrado":
                            la analítica es reciente y no cubre a las clínicas
                            antiguas. Se dice lo que se sabe. */}
                        {salud.avisos.sinRegistroDeAcceso && (
                          <span className={css.sinDato} title="analytics_sessions no tiene sesiones de panel de esta clínica; no significa que nadie haya entrado">
                            sin registro de acceso
                          </span>
                        )}
                      </div>
                    </td>

                    <td data-col="Riesgo">
                      <div className={css.celda}>
                      {/* Sin píldora: el icono ya da la forma y el color, y la
                          pastilla se comía el ancho que necesita la columna de
                          Acciones. El porqué completo va en el title. */}
                      {riesgo && IconoRie ? (
                        <span title={riesgo.detalle} className={`${css.riesgo} ${CLASE_RIESGO[riesgo.severidad]}`}>
                          <IconoRie size={13} strokeWidth={2} aria-hidden="true" />
                          {riesgo.titulo}
                        </span>
                      ) : salud.esPrueba ? (
                        <span className={css.sinDato} title={salud.motivoPrueba ?? undefined}>
                          Cuenta de prueba
                        </span>
                      ) : (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, color: "var(--text-3)" }}>
                          <CheckCircle2 size={13} aria-hidden="true" /> Sin riesgo
                        </span>
                      )}
                      {salud.riesgos.length > 1 && (
                        <div className={css.meta}>
                          y {salud.riesgos.length - 1} más: {salud.riesgos.slice(1).map(r => r.titulo).join(", ")}
                        </div>
                      )}
                      </div>
                    </td>

                    <td data-col="Plan">
                      <div className={css.pila}>
                        <BadgeNew tone={clinic.plan === "CLINIC" ? "brand" : clinic.plan === "PRO" ? "info" : "neutral"}>
                          {clinic.plan}
                        </BadgeNew>
                        <span className={`mono ${css.meta} ${css.num}`}>
                          {formatCurrency(negociado ?? listPrice, "MXN")}/mes
                          {negociado !== null && <span title="Precio negociado de esta clínica; manda sobre el del plan"> · negociado</span>}
                        </span>
                        <select
                          value={clinic.plan}
                          onChange={e => updatePlan(clinic.id, e.target.value)}
                          disabled={isLoading}
                          className={`input-new ${css.selectPlan}`}
                          aria-label={`Plan de ${clinic.name}`}
                        >
                          {Object.keys(planPrices).map(p => (
                            <option key={p} value={p}>
                              {p} — ${planPrices[p].toLocaleString("es-MX")}/mes
                            </option>
                          ))}
                        </select>
                      </div>
                    </td>

                    <td data-col="Pacientes">
                      <div className={css.celda}>
                        <span className={`mono ${css.num}`} style={{ fontSize: 13, color: "var(--text-1)", fontWeight: 500 }}>
                          {clinic._count.patients}
                        </span>
                        <span className={`${css.meta} ${css.num}`}>
                          {clinic._count.appointments} citas · {clinic._count.users} usuarios
                        </span>
                      </div>
                    </td>

                    <td data-col="Tokens IA">
                      <div className={css.celda}>
                        {limit > 0 ? (
                          <>
                            <span className={`mono ${css.num}`} style={{ fontSize: 12, color: "var(--text-2)", whiteSpace: "nowrap" }}>
                              {used.toLocaleString("es-MX")}
                              <span style={{ color: "var(--text-3)" }}> / {limit.toLocaleString("es-MX")}</span>
                            </span>
                            <span className={css.tokens}>
                              <span className={css.tokensRelleno} style={{ display: "block", width: `${Math.min(pct, 100)}%`, background: tokenColor }} />
                            </span>
                            <span className={`mono ${css.meta} ${css.num}`}>{pct}% usado</span>
                          </>
                        ) : (
                          <span className={css.sinDato}>Sin cupo definido</span>
                        )}
                      </div>
                    </td>

                    <td data-col="Acciones" style={{ textAlign: "right" }}>
                      {/* Los tres botones que YA cambiaban cosas: mismo sitio,
                          mismo texto, mismo comportamiento. Sólo el envoltorio
                          es nuevo. */}
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
                  <td colSpan={COLUMNAS.length} className={css.vacio}>
                    {search || filtro !== "todas"
                      ? "Ninguna clínica cumple ese filtro."
                      : "No hay clínicas registradas."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
