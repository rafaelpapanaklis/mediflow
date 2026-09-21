"use client";

/**
 * /admin/clientes — la lista.
 *
 * Qué se rediseñó y por qué: la lista vieja enseñaba Cliente · Clínicas · MRR ·
 * Estado · Health · Pacientes · Alta, todo AGREGADO. Un cliente con dos sedes y
 * una apagada salía "Activo · Health 78": el promedio se tragaba la sede muerta,
 * y el "Health" era una fórmula propia (45 % suscripción + 35 % engagement…)
 * que no miraba ni las citas ni los trials vencidos. En producción eso dejaba
 * invisibles clínicas "activas" sin una cita en dos meses y trials vencidos que
 * siguen usando el panel desde julio.
 *
 * Ahora manda lo que exige una llamada HOY, con el nombre de la sede que la
 * exige, y el cálculo no es de esta pantalla: sale de `evaluarSaludClinica`
 * (@/lib/admin/salud-clinica) por clínica y se suma en `./cartera`.
 *
 * El "Health" 0-100 desapareció a propósito: un número sin unidades que nadie
 * sabía leer se cambió por el riesgo concreto y la sede que lo tiene.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Search, AlertOctagon, AlertTriangle, Info, CheckCircle2, ArrowDown, ArrowUp,
  Flame, Snowflake, PowerOff, Sprout, CircleSlash, Users,
  TrendingUp, TrendingDown, Minus, Archive,
} from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { AvatarNew } from "@/components/ui/design-system/avatar-new";
import { BadgeNew } from "@/components/ui/design-system/badge-new";
import { PlanStatusBadge } from "@/components/admin/plan-status-badge";
import { mrrBreakdownHint } from "@/lib/admin/mrr-core";
import {
  ETIQUETA_ESTADO_OPERATIVO,
  DIAS_VENTANA_ACTIVIDAD,
  DIAS_APAGADA,
  MINUTOS_EN_LINEA,
  type NivelActividad,
  type Severidad,
} from "@/lib/admin/salud-clinica";
import { fechaAdmin } from "@/lib/admin/zona-horaria";
import { formatPatientQuota, patientQuotaLevel } from "@/lib/patient-quota-shared";
import {
  valorarClientes,
  resumirClientes,
  ordenarPorAtencionCliente,
  ETIQUETA_ESTADO_CLIENTE,
  type ClienteCrudo,
  type ClinicaValorada,
  type EstadoCliente,
  type FilaCliente,
} from "./cartera";
import css from "./clientes.module.css";

interface Props {
  clientes: ClienteCrudo[];
  /** Precios de lista desde plan_configs. NUNCA un número escrito a mano. */
  planPrices: Record<string, number>;
  /** El "ahora" del servidor: así SSR e hidratación cuentan los mismos días. */
  ahoraISO: string;
}

type ClaveFiltro =
  | "todos" | "atencion" | "mixtos" | "trial-vencido" | "cobro-fallido"
  | "apagadas" | "multi" | "pruebas";
type ClaveOrden = "atencion" | "nombre" | "mrr" | "actividad" | "pacientes" | "alta";

const LLAVE_PREFERENCIAS = "admin-clientes-preferencias-v1";

/** Forma + color: la severidad no se lee sólo por el color. */
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

const CLASE_RIESGO: Record<Severidad, string> = {
  critico: css.riesgoCritico,
  alto:    css.riesgoAlto,
  medio:   css.riesgoMedio,
};

const ICONO_TENDENCIA = { sube: TrendingUp, baja: TrendingDown, igual: Minus } as const;
const CLASE_TENDENCIA: Record<string, string> = {
  sube:  css.tendenciaSube,
  baja:  css.tendenciaBaja,
  igual: css.tendenciaIgual,
};

/** Cada nivel de actividad con SU forma, para no depender del color. */
const ACTIVIDAD: Record<NivelActividad, { etiqueta: string; icono: typeof Flame; clase: string }> = {
  "activa":       { etiqueta: "Activa",       icono: Flame,       clase: css.pulsoActiva },
  "nueva":        { etiqueta: "Nueva",        icono: Sprout,      clase: css.pulsoNueva },
  "enfriandose":  { etiqueta: "Enfriándose",  icono: Snowflake,   clase: css.pulsoEnfriandose },
  "apagada":      { etiqueta: "Apagada",      icono: PowerOff,    clase: css.pulsoApagada },
  "sin-estrenar": { etiqueta: "Sin estrenar", icono: CircleSlash, clase: css.pulsoSinEstrenar },
};

const TONO_ESTADO_CLIENTE: Record<EstadoCliente, "success" | "warning" | "danger" | "info" | "neutral"> = {
  "pagando":   "success",
  "mixto":     "warning",
  "en-trial":  "info",
  "sin-cobro": "danger",
  "prueba":    "neutral",
};

/** El chip de una sede: color por gravedad, icono por nivel de actividad. */
function claseSede(v: ClinicaValorada): string {
  if (v.clinica.archivada) return css.sedeArchivada;
  if (v.salud.esPrueba) return css.sedeNeutra;
  if (v.salud.severidadMaxima === "critico" || v.salud.severidadMaxima === "alto") return css.sedeGrave;
  if (v.salud.severidadMaxima === "medio") return css.sedeAviso;
  return css.sedeOk;
}

/** Lo que dice el chip al pasar por encima: el estado con todas sus letras. */
function tituloSede(v: ClinicaValorada): string {
  const partes = [
    v.clinica.nombre,
    ETIQUETA_ESTADO_OPERATIVO[v.salud.estadoOperativo],
    ACTIVIDAD[v.salud.actividad.nivel].etiqueta,
  ];
  if (v.clinica.archivada) partes.push("Archivada");
  if (v.salud.riesgos.length) partes.push(v.salud.riesgos[0].titulo);
  return partes.join(" · ");
}

export function ClientesClient({ clientes, planPrices, ahoraISO }: Props) {
  const [search, setSearch] = useState("");
  const [filtro, setFiltro] = useState<ClaveFiltro>("todos");
  const [orden, setOrden]   = useState<ClaveOrden>("atencion");
  const [desc, setDesc]     = useState(true);
  const [verTodo, setVerTodo] = useState(false);

  // El "ahora" viene del servidor: si aquí se llamara a new Date(), el número
  // de días del render del servidor y el del cliente podrían no coincidir y
  // React avisaría de un desajuste de hidratación.
  const ahora = useMemo(() => new Date(ahoraISO), [ahoraISO]);

  // Filtro y orden sobreviven a recargar. Se leen DESPUÉS del primer render
  // (en un efecto) a propósito: leer localStorage durante el render rompería
  // la hidratación, porque el servidor no tiene ese valor.
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

  // EL cálculo, una sola vez por lista.
  const filas = useMemo(
    () => valorarClientes(clientes, planPrices, ahora),
    [clientes, planPrices, ahora],
  );
  const resumen = useMemo(() => resumirClientes(filas), [filas]);
  const triage  = useMemo(() => ordenarPorAtencionCliente(filas), [filas]);

  const sinRegistroDeAcceso = useMemo(
    () => filas.filter((f) => f.esReal && !f.ultimoAccesoAt).length,
    [filas],
  );

  const cuentas = useMemo(() => ({
    todos:            filas.length,
    atencion:         filas.filter((f) => f.riesgos.length > 0).length,
    mixtos:           filas.filter((f) => f.estado === "mixto").length,
    "trial-vencido":  filas.filter((f) => f.resumen.porEstado["trial-vencido"] > 0).length,
    "cobro-fallido":  filas.filter((f) => f.resumen.porEstado["cobro-fallido"] > 0).length,
    apagadas:         filas.filter((f) => f.resumen.porActividad.apagada > 0).length,
    multi:            filas.filter((f) => f.vigentes.length > 1).length,
    pruebas:          filas.filter((f) => !f.esReal).length,
  }) as Record<ClaveFiltro, number>, [filas]);

  const visibles = useMemo(() => {
    const q = search.trim().toLowerCase();
    const coincide = (f: FilaCliente) => {
      if (!q) return true;
      if (f.nombre.toLowerCase().includes(q)) return true;
      if (f.email.toLowerCase().includes(q)) return true;
      // Buscar también por el nombre de cualquiera de sus clínicas: Rafael
      // recuerda la clínica, no siempre a su dueño.
      return f.clinicas.some((v) =>
        v.clinica.nombre.toLowerCase().includes(q) || v.clinica.slug.toLowerCase().includes(q));
    };

    const lista = filas.filter((f) => {
      if (!coincide(f)) return false;
      switch (filtro) {
        case "atencion":       return f.riesgos.length > 0;
        case "mixtos":         return f.estado === "mixto";
        case "trial-vencido":  return f.resumen.porEstado["trial-vencido"] > 0;
        case "cobro-fallido":  return f.resumen.porEstado["cobro-fallido"] > 0;
        case "apagadas":       return f.resumen.porActividad.apagada > 0;
        case "multi":          return f.vigentes.length > 1;
        case "pruebas":        return !f.esReal;
        default:               return true;
      }
    });

    const signo = desc ? -1 : 1;
    const valor = (f: FilaCliente): number | string => {
      switch (orden) {
        case "nombre":    return f.nombre.toLowerCase();
        case "mrr":       return f.mrr.total;
        case "actividad": return f.tendencia.actual.total;
        case "pacientes": return f.cupo.used;
        case "alta":      return f.altaAt.getTime();
        default:          return f.prioridad;
      }
    };

    return lista.slice().sort((a, b) => {
      const va = valor(a), vb = valor(b);
      if (typeof va === "string" || typeof vb === "string") {
        return String(va).localeCompare(String(vb), "es") * signo;
      }
      // Empate en prioridad (lo normal: casi todos a 0): manda el dinero.
      if (va === vb) return (a.mrr.total - b.mrr.total) * signo;
      return (va - vb) * signo;
    });
  }, [filas, search, filtro, orden, desc]);

  const FILTROS: Array<{ id: ClaveFiltro; label: string }> = [
    { id: "todos",         label: "Todos" },
    { id: "atencion",      label: "Atender" },
    { id: "mixtos",        label: "Paga en parte" },
    { id: "trial-vencido", label: "Trial vencido" },
    { id: "cobro-fallido", label: "Cobro fallido" },
    { id: "apagadas",      label: "Con sede apagada" },
    { id: "multi",         label: "Multi-sede" },
    { id: "pruebas",       label: "Pruebas" },
  ];

  const COLUMNAS: Array<{ id: ClaveOrden | null; label: string }> = [
    { id: "nombre",    label: "Cliente" },
    { id: null,        label: "Sedes" },
    { id: null,        label: "Estado" },
    { id: "actividad", label: "Actividad" },
    { id: "atencion",  label: "Atender" },
    { id: "mrr",       label: "MRR" },
    { id: "pacientes", label: "Pacientes" },
    { id: "alta",      label: "Alta" },
  ];

  function alternarOrden(id: ClaveOrden) {
    if (orden === id) { setDesc((d) => !d); return; }
    setOrden(id);
    // Nombre se lee de la A a la Z; lo demás, de mayor a menor.
    setDesc(id !== "nombre");
  }

  const triageVisible = verTodo ? triage : triage.slice(0, 5);
  const claseBandeja = resumen.criticos > 0
    ? css.bandejaCritica
    : triage.length > 0 ? css.bandejaAlta : "";

  return (
    <div className={css.pagina}>
      {/* ── Cabecera ────────────────────────────────────────────────────── */}
      <div className={css.cabecera}>
        <div>
          <h1 className={css.titulo}>Clientes</h1>
          <p className={css.subtitulo}>
            {resumen.reales} clientes reales · {resumen.clinicas} clínicas
            {resumen.pruebas > 0 && ` · ${resumen.pruebas} cuentas de prueba fuera de los totales`}
            {resumen.enLinea > 0 && (
              <span
                className={css.enLinea}
                style={{ marginLeft: 10 }}
                title={`Con sesión en el panel en los últimos ${MINUTOS_EN_LINEA} minutos`}
              >
                <span className={css.enLineaPunto} aria-hidden="true" />
                {resumen.enLinea} en línea
              </span>
            )}
          </p>
          <p className={css.aclaracion}>
            Un cliente es la cuenta dueña y agrupa todas sus clínicas. El estado de cada
            sede se cuenta por separado: si una se apaga o se le vence el trial, se ve
            en su fila sin abrir la ficha.
          </p>
          {sinRegistroDeAcceso > 0 && (
            <p className={css.aclaracion}>
              {sinRegistroDeAcceso} de {resumen.reales} no tienen ninguna sesión de panel
              registrada. La analítica es reciente: eso no quiere decir que nadie haya entrado.
            </p>
          )}
        </div>
      </div>

      {/* ── A quién hay que llamar HOY. Va primero a propósito. ─────────── */}
      <section className={`${css.bandeja} ${claseBandeja}`} aria-label="Clientes que exigen atención">
        <div className={css.bandejaCabecera}>
          <h2 className={css.bandejaTitulo}>Atender hoy</h2>
          <span className={css.bandejaCuenta}>
            {triage.length === 0
              ? "sin pendientes"
              : `${triage.length} de ${resumen.reales} · ${resumen.criticos} crítico${resumen.criticos === 1 ? "" : "s"}`}
          </span>
        </div>

        {triage.length === 0 ? (
          <p className={css.bandejaVacia}>
            <CheckCircle2 size={15} style={{ color: "var(--success)" }} />
            Ningún cliente en riesgo ahora mismo.
          </p>
        ) : (
          <>
            {triageVisible.map((f) => {
              const primero = f.riesgos[0];
              const Icono = ICONO_SEVERIDAD[primero.riesgo.severidad];
              const otros = f.riesgos.length - 1;
              return (
                <Link key={f.supabaseId} href={`/admin/clientes/${f.supabaseId}`} className={css.fila}>
                  <span
                    className={`${css.marca} ${css.filaMarca} ${CLASE_MARCA[primero.riesgo.severidad]}`}
                    aria-hidden="true"
                  >
                    <Icono size={15} strokeWidth={2} />
                  </span>
                  <span className={css.filaNombre}>
                    {f.nombre}
                    {f.vigentes.length > 1 && (
                      <span className={css.sinDato}> · {f.vigentes.length} sedes</span>
                    )}
                  </span>
                  <span className={css.filaDetalle}>
                    <span className={css.filaSede}>{primero.clinicaNombre}:</span>{" "}
                    <strong>{primero.riesgo.titulo}.</strong> {primero.riesgo.detalle}
                    {otros > 0 && <span className={css.sinDato}> +{otros} más</span>}
                  </span>
                  <span className={`${css.filaMas} ${css.num}`}>
                    {ETIQUETA_ESTADO_CLIENTE[f.estado]}
                    <br />
                    {formatCurrency(f.mrr.total, "MXN")}/mes
                  </span>
                </Link>
              );
            })}
            {triage.length > 5 && (
              <button type="button" className={css.verTodo} onClick={() => setVerTodo((v) => !v)}>
                {verTodo ? "Ver sólo los 5 primeros" : `Ver los ${triage.length}`}
              </button>
            )}
          </>
        )}
      </section>

      {/* ── Cifras, en segundo plano ────────────────────────────────────── */}
      <div className={css.cifras}>
        <div className={css.cifra}>
          <div className={css.cifraEtiqueta}>MRR</div>
          <div className={css.cifraValor}>{formatCurrency(resumen.mrrTotal, "MXN")}</div>
          <div className={css.cifraPie}>
            {resumen.reales > 0
              ? `${formatCurrency(Math.round(resumen.mrrTotal / resumen.reales), "MXN")} por cliente`
              : "sin clientes"}
          </div>
          {/* A QUIÉN cuenta. Mismos precios (plan_configs) y misma regla de
              cobro que /admin/clinics; lo que cambia es QUIÉN entra. No se
              unifica a la fuerza: esta pantalla mide CLIENTES, y un cliente es
              una cuenta dueña. Lo que faltaba era decirlo. */}
          <div
            className={css.cifraUniverso}
            title="Sólo las clínicas no archivadas que tienen una cuenta dueña activa (role SUPER_ADMIN, isActive). Es un subconjunto del MRR de /admin/clinics: una clínica cuyo dueño se dio de baja suma allí y no aquí. Y ojo con las sedes: una sucursal incluida en el plan de la madre (POST /api/clinics la crea con subscriptionStatus=active y monthlyPrice=0) se valora a precio de lista aunque no se le cobre nada. Un CLINIC con 2 sedes incluidas suma 3 veces el precio de lista. Pasa igual en las dos pantallas."
          >
            Cuenta sólo clínicas con cuenta dueña activa.
            Una sin dueño suma en Clínicas y no aquí.
            Una sede incluida en el plan de la madre suma precio de lista
            aunque no se le cobre.
          </div>
        </div>
        <div className={`${css.cifra} ${resumen.mixtos > 0 ? css.cifraAlerta : ""}`}>
          <div className={css.cifraEtiqueta}>Paga en parte</div>
          <div className={css.cifraValor}>{resumen.mixtos}</div>
          <div className={css.cifraPie}>cobra por unas sedes y por otras no</div>
        </div>
        <div className={`${css.cifra} ${resumen.conApagada > 0 ? css.cifraAlerta : ""}`}>
          <div className={css.cifraEtiqueta}>Con sede apagada</div>
          <div className={css.cifraValor}>{resumen.conApagada}</div>
          <div className={css.cifraPie}>sin citas en {DIAS_APAGADA}+ días</div>
        </div>
        <div className={`${css.cifra} ${resumen.conTrialVencido > 0 ? css.cifraAlerta : ""}`}>
          <div className={css.cifraEtiqueta}>Trial vencido</div>
          <div className={css.cifraValor}>{resumen.conTrialVencido}</div>
          <div className={css.cifraPie}>con acceso y sin pagar</div>
        </div>
        <div className={css.cifra}>
          <div className={css.cifraEtiqueta}>Multi-sede</div>
          <div className={css.cifraValor}>{resumen.multiClinica}</div>
          <div className={css.cifraPie}>
            {resumen.reales > 0 ? `${Math.round((resumen.multiClinica / resumen.reales) * 100)}% de los clientes` : "—"}
          </div>
        </div>
        <div className={css.cifra}>
          <div className={css.cifraEtiqueta}>Trabajo · {DIAS_VENTANA_ACTIVIDAD} d</div>
          <div className={css.cifraValor}>
            {filas.reduce((s, f) => s + f.tendencia.actual.total, 0).toLocaleString("es-MX")}
          </div>
          <div className={css.cifraPie}>citas + facturas + notas de sus clínicas</div>
        </div>
      </div>

      {/* ── Herramientas ────────────────────────────────────────────────── */}
      <div className={css.herramientas}>
        <div className={`search-field ${css.buscador}`}>
          <Search size={14} className={css.buscadorIcono} />
          <input
            className={`input-new ${css.buscadorInput}`}
            placeholder="Buscar por cliente, email o clínica…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className={`segment-new ${css.filtros}`}>
          {FILTROS.map((f) => (
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
                {COLUMNAS.map((col) => (
                  <th key={col.label}>
                    {col.id ? (
                      <button
                        type="button"
                        onClick={() => alternarOrden(col.id!)}
                        className={`${css.orden} ${orden === col.id ? css.ordenActivo : ""}`}
                        aria-label={`Ordenar por ${col.label}`}
                      >
                        {col.label}
                        {orden === col.id && (desc ? <ArrowDown size={12} /> : <ArrowUp size={12} />)}
                      </button>
                    ) : (
                      col.label
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibles.map((f) => (
                <FilaTabla key={f.supabaseId} fila={f} ahora={ahora} />
              ))}
              {visibles.length === 0 && (
                <tr>
                  <td colSpan={COLUMNAS.length} className={css.vacio}>
                    Ningún cliente coincide con lo que buscas.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className={css.pie}>
        <Users size={13} />
        {visibles.length} de {filas.length} clientes
      </div>
    </div>
  );
}

// ── Una fila ───────────────────────────────────────────────────────────────

function FilaTabla({ fila, ahora }: { fila: FilaCliente; ahora: Date }) {
  const primero = fila.riesgos[0];
  const IconoRiesgo = primero ? ICONO_SEVERIDAD[primero.riesgo.severidad] : null;
  const Tendencia = ICONO_TENDENCIA[fila.tendencia.direccion];
  const nivelCupo = patientQuotaLevel(fila.cupo);
  // Una sola sede: la insignia del gate (plan-status) es exacta y no repite
  // nada. Con varias no existe "el" estado de plan del cliente, y lo que hay
  // que leer es el reparto — eso lo dice la tira de sedes.
  const unica = fila.vigentes.length === 1 ? fila.vigentes[0] : null;

  return (
    <tr>
      <td data-col="Cliente">
        <div className={css.celdaNombre}>
          <AvatarNew name={fila.nombre} size="sm" />
          <div style={{ minWidth: 0 }}>
            <Link href={`/admin/clientes/${fila.supabaseId}`} className={css.enlaceCliente}>
              {fila.nombre}
            </Link>
            <div className={css.meta}>{fila.email}</div>
            {fila.afiliado && <div className={css.meta}>vía {fila.afiliado}</div>}
          </div>
        </div>
      </td>

      <td data-col="Sedes">
        <div className={css.sedes}>
          {fila.clinicas.map((v) => {
            const Icono = ACTIVIDAD[v.salud.actividad.nivel].icono;
            return (
              <Link
                key={v.clinica.id}
                href={`/admin/clinics/${v.clinica.id}`}
                className={`${css.sede} ${claseSede(v)}`}
                title={tituloSede(v)}
              >
                {v.clinica.archivada
                  ? <Archive size={11} aria-hidden="true" />
                  : <Icono size={11} aria-hidden="true" />}
                <span className={css.sedeNombre}>{v.clinica.nombre}</span>
              </Link>
            );
          })}
        </div>
      </td>

      <td data-col="Estado">
        <div className={css.celda}>
          <BadgeNew tone={TONO_ESTADO_CLIENTE[fila.estado]} dot>
            {ETIQUETA_ESTADO_CLIENTE[fila.estado]}
          </BadgeNew>
          {unica ? (
            <PlanStatusBadge clinic={unica.clinica} now={ahora} />
          ) : (
            <span className={`${css.sinDato} ${css.num}`}>
              {fila.resumen.porEstado.pagando} de {fila.vigentes.length} pagando
            </span>
          )}
          {fila.enLinea && (
            <span className={css.enLinea} title={`Alguien en el panel en los últimos ${MINUTOS_EN_LINEA} minutos`}>
              <span className={css.enLineaPunto} aria-hidden="true" />
              en línea
            </span>
          )}
        </div>
      </td>

      <td data-col="Actividad">
        <div className={css.celda}>
          {/* La barra ES el reparto de sedes: un tramo por clínica vigente. */}
          <div
            className={css.pulso}
            title={fila.vigentes
              .map((v) => `${v.clinica.nombre}: ${ACTIVIDAD[v.salud.actividad.nivel].etiqueta}`)
              .join(" · ")}
          >
            {fila.vigentes.map((v) => (
              <span
                key={v.clinica.id}
                className={`${css.pulsoTramo} ${ACTIVIDAD[v.salud.actividad.nivel].clase}`}
                style={{ width: `${100 / fila.vigentes.length}%` }}
              />
            ))}
          </div>
          <span className={`${css.volumen} ${css.num}`}>
            <strong>{fila.tendencia.actual.total.toLocaleString("es-MX")}</strong>
            <span className={css.volumenSep}>·</span>
            {fila.tendencia.actual.citas} citas
            <span className={`${css.tendencia} ${CLASE_TENDENCIA[fila.tendencia.direccion]}`}>
              <Tendencia size={12} aria-hidden="true" />
              {fila.tendencia.deltaPct === null ? "—" : `${fila.tendencia.deltaPct > 0 ? "+" : ""}${fila.tendencia.deltaPct}%`}
            </span>
          </span>
        </div>
      </td>

      <td data-col="Atender">
        {primero && IconoRiesgo ? (
          <div className={css.celda}>
            <span className={`${css.riesgo} ${CLASE_RIESGO[primero.riesgo.severidad]}`}>
              <IconoRiesgo size={13} aria-hidden="true" />
              {primero.riesgo.titulo}
            </span>
            <span className={css.riesgoSede}>
              en {primero.clinicaNombre}
              {fila.riesgos.length > 1 && ` · +${fila.riesgos.length - 1} más`}
            </span>
          </div>
        ) : (
          <span className={css.sinDato}>—</span>
        )}
      </td>

      <td data-col="MRR">
        <div className={css.celda}>
          <span className={`${css.dinero} ${fila.mrr.total === 0 ? css.dineroCero : ""}`}>
            {formatCurrency(fila.mrr.total, "MXN")}
          </span>
          <span className={css.dineroPie}>
            {fila.mrr.total > 0 ? mrrBreakdownHint(fila.mrr) : "no cobra nada al mes"}
          </span>
        </div>
      </td>

      <td data-col="Pacientes">
        <div className={css.celda}>
          <span
            className={`${css.dinero} ${css.num} ${nivelCupo === "full" ? css.cupoLleno : nivelCupo === "warn" ? css.cupoAviso : ""}`}
            title={
              fila.cupo.unlimited
                ? "Alguna de sus sedes tiene plan sin tope de pacientes"
                : `${fila.cupo.remaining ?? 0} de cupo libre entre sus sedes`
            }
          >
            {formatPatientQuota(fila.cupo)}
          </span>
          <span className={`${css.dineroPie} ${css.num}`}>
            {fila.citasPasadas.toLocaleString("es-MX")} citas
          </span>
        </div>
      </td>

      <td data-col="Alta">
        <span className={`${css.dineroPie} ${css.num}`}>
          {fechaAdmin(fila.altaAt) ?? "—"}
        </span>
      </td>
    </tr>
  );
}
