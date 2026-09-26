"use client";

/**
 * /admin/clientes — la lista (rediseño ws1-t2, 26-sep-2026).
 *
 * Un CLIENTE es la cuenta dueña y agrupa sus clínicas; el estado de cada sede
 * se cuenta por separado (`./cartera` sobre `evaluarSaludClinica`). Nada de lo
 * que se decide cambió: sólo la cara. Menos texto: chips, barras y una línea
 * de metadato por celda.
 *
 * Orden por defecto: ÚLTIMA COMPRA (el pago de suscripción cobrado más
 * reciente de cualquiera de sus clínicas; sin pagos, su alta, y va detrás).
 */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Search, ArrowDownWideNarrow, ArrowUpNarrowWide, Users } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { AvatarNew } from "@/components/ui/design-system/avatar-new";
import { PlanStatusBadge } from "@/components/admin/plan-status-badge";
import { includedBranchesHint, mrrBreakdownHint } from "@/lib/admin/mrr-core";
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
import { bytesCortos, compararUltimaCompraDesc, metodoDePago, tokensCortos } from "@/lib/admin/uso-core";
import { BarraUso, Chip, Vacio, type TonoChip } from "@/components/admin/rediseno/piezas";
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
type ClaveOrden = "compra" | "atencion" | "nombre" | "mrr" | "actividad" | "pacientes" | "alta" | "renueva";

const LLAVE_PREFERENCIAS = "admin-clientes-preferencias-v2";

const ORDENES: Array<{ id: ClaveOrden; label: string }> = [
  { id: "compra",    label: "Última compra" },
  { id: "atencion",  label: "Atención" },
  { id: "mrr",       label: "MRR" },
  { id: "renueva",   label: "Próxima renovación" },
  { id: "alta",      label: "Alta" },
  { id: "actividad", label: "Actividad" },
  { id: "pacientes", label: "Pacientes" },
  { id: "nombre",    label: "Nombre" },
];

const TONO_SEVERIDAD: Record<Severidad, TonoChip> = { critico: "danger", alto: "warning", medio: "info" };

const ETIQUETA_ACTIVIDAD: Record<NivelActividad, string> = {
  "activa": "Activa", "nueva": "Nueva", "enfriandose": "Enfriándose", "apagada": "Apagada", "sin-estrenar": "Sin estrenar",
};

const TONO_ESTADO_CLIENTE: Record<EstadoCliente, TonoChip> = {
  "pagando":   "success",
  "mixto":     "warning",
  "en-trial":  "info",
  "sin-cobro": "danger",
  "prueba":    "neutral",
};

/** El chip de una sede: color por gravedad. */
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
    ETIQUETA_ACTIVIDAD[v.salud.actividad.nivel],
  ];
  if (v.clinica.archivada) partes.push("Archivada");
  if (v.salud.riesgos.length) partes.push(v.salud.riesgos[0].titulo);
  return partes.join(" · ");
}

/** El consumo SUMADO de las sedes vigentes con dato, para la barra de la fila. */
function usoAgregado(vigentes: ClinicaValorada[]) {
  let storageUsado = 0, storageTope = 0, tokensUsados = 0, tokensTope = 0, medidas = 0, sinTope = false;
  for (const v of vigentes) {
    const u = v.clinica.uso;
    if (!u || u.storageUsado === null) continue;
    medidas += 1;
    storageUsado += u.storageUsado;
    if (u.storageTope === null) sinTope = true; else storageTope += u.storageTope;
    tokensUsados += u.tokensUsados;
    tokensTope += u.tokensTope;
  }
  if (medidas === 0) return null;
  return { storageUsado, storageTope: sinTope ? null : storageTope, tokensUsados, tokensTope };
}

export function ClientesClient({ clientes, planPrices, ahoraISO }: Props) {
  const [search, setSearch] = useState("");
  const [filtro, setFiltro] = useState<ClaveFiltro>("todos");
  const [orden, setOrden]   = useState<ClaveOrden>("compra");
  const [desc, setDesc]     = useState(true);
  const [verTodo, setVerTodo] = useState(false);

  const ahora = useMemo(() => new Date(ahoraISO), [ahoraISO]);

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

  // EL cálculo, una sola vez por lista.
  const filas = useMemo(() => valorarClientes(clientes, planPrices, ahora), [clientes, planPrices, ahora]);
  const resumen = useMemo(() => resumirClientes(filas), [filas]);
  const triage  = useMemo(() => ordenarPorAtencionCliente(filas), [filas]);
  const sinRegistroDeAcceso = useMemo(() => filas.filter((f) => f.esReal && !f.ultimoAccesoAt).length, [filas]);

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
      // También por el nombre de cualquiera de sus clínicas: Rafael recuerda la clínica, no siempre al dueño.
      return f.clinicas.some((v) => v.clinica.nombre.toLowerCase().includes(q) || v.clinica.slug.toLowerCase().includes(q));
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
        case "renueva":   return f.proximaRenovacionAt ? f.proximaRenovacionAt.getTime() : Number.POSITIVE_INFINITY * signo;
        case "atencion":  return f.prioridad;
        default:          return 0;
      }
    };

    return lista.slice().sort((a, b) => {
      if (orden === "compra") {
        const r = compararUltimaCompraDesc(
          { ultimoPagoAt: a.ultimaCompraAt, createdAt: a.altaAt },
          { ultimoPagoAt: b.ultimaCompraAt, createdAt: b.altaAt },
        );
        return desc ? r : -r;
      }
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
    { id: "cobro-fallido", label: "Cobro fallido" },
    { id: "trial-vencido", label: "Trial vencido" },
    { id: "apagadas",      label: "Sede apagada" },
    { id: "multi",         label: "Multi-sede" },
    { id: "pruebas",       label: "Pruebas" },
  ];

  const triageVisible = verTodo ? triage : triage.slice(0, 5);
  const etiquetaOrden = ORDENES.find((o) => o.id === orden)?.label ?? "";

  return (
    <div className={`${css.pagina} ad-pagina`}>
      {/* ── Cabecera ──────────────────────────────────────────────────── */}
      <header className="ad-cabecera">
        <div>
          <h1 className="ad-titulo">Clientes</h1>
          <p className="ad-sub">
            {resumen.reales} reales · {resumen.clinicas} clínicas
            {resumen.pruebas > 0 && ` · ${resumen.pruebas} de prueba`}
            {resumen.enLinea > 0 && (
              <span title={`Con sesión en el panel en los últimos ${MINUTOS_EN_LINEA} minutos`}>
                {" · "}<span className="ad-online" style={{ verticalAlign: "1px" }} /> {resumen.enLinea} en línea
              </span>
            )}
          </p>
        </div>
      </header>

      {/* ── Cifras ────────────────────────────────────────────────────── */}
      <div className={css.cifras}>
        <div className={css.cifra}>
          <div className={css.cifraEtiqueta}>MRR</div>
          <div className={css.cifraValor}>{formatCurrency(resumen.mrrTotal, "MXN")}</div>
          <div className={css.cifraPie}>
            {resumen.reales > 0 ? `${formatCurrency(Math.round(resumen.mrrTotal / resumen.reales), "MXN")} por cliente` : "sin clientes"}
            {resumen.sedesIncluidas > 0 && ` · ${includedBranchesHint(resumen.sedesIncluidas)}`}
          </div>
          {/* A QUIÉN cuenta. Mismos precios (plan_configs) y misma regla de
              cobro que /admin/clinics; lo que cambia es QUIÉN entra. */}
          <div
            className={css.cifraUniverso}
            title="Sólo las clínicas no archivadas que tienen una cuenta dueña activa (role SUPER_ADMIN, isActive). Es un subconjunto del MRR de /admin/clinics: una clínica cuyo dueño se dio de baja suma allí y no aquí. Las sedes incluidas en el plan de su madre (mismo dueño, sin cobro propio: ni Stripe, ni PayPal, ni fecha de renovación, ni precio negociado) valen $0: ya están pagadas dentro de la suscripción de la madre. Una clínica con su propia suscripción sí suma aunque comparta dueño. Mismo criterio en las dos pantallas."
          >
            Cuenta sólo clínicas con cuenta dueña activa.
            Una sin dueño suma en Clínicas y no aquí.
            Una sede incluida en el plan de la madre vale $0: no suma.
          </div>
        </div>
        <div className={`${css.cifra} ${resumen.mixtos > 0 ? css.cifraAlerta : ""}`}>
          <div className={css.cifraEtiqueta}>Paga en parte</div>
          <div className={css.cifraValor}>{resumen.mixtos}</div>
          <div className={css.cifraPie}>cobra por unas sedes y por otras no</div>
        </div>
        <div className={`${css.cifra} ${resumen.criticos > 0 ? css.cifraAlerta : ""}`}>
          <div className={css.cifraEtiqueta}>Atender</div>
          <div className={css.cifraValor}>{resumen.enAtencion}</div>
          <div className={css.cifraPie}>{resumen.criticos} crítico{resumen.criticos === 1 ? "" : "s"}</div>
        </div>
        <div className={`${css.cifra} ${resumen.conApagada > 0 ? css.cifraAlerta : ""}`}>
          <div className={css.cifraEtiqueta}>Con sede apagada</div>
          <div className={css.cifraValor}>{resumen.conApagada}</div>
          <div className={css.cifraPie}>sin citas en {DIAS_APAGADA}+ días</div>
        </div>
        <div className={css.cifra}>
          <div className={css.cifraEtiqueta}>Multi-sede</div>
          <div className={css.cifraValor}>{resumen.multiClinica}</div>
          <div className={css.cifraPie}>
            {resumen.reales > 0 ? `${Math.round((resumen.multiClinica / resumen.reales) * 100)}% de los clientes` : "—"}
          </div>
        </div>
      </div>

      {/* ── A quién hay que llamar HOY ────────────────────────────────── */}
      <section className="ad-card" aria-label="Clientes que exigen atención">
        <header className="ad-card__head">
          <div>
            <h2 className="ad-card__title">Atender hoy</h2>
            <div className="ad-card__sub">
              {triage.length === 0 ? "sin pendientes" : `${triage.length} de ${resumen.reales} · ${resumen.criticos} crítico${resumen.criticos === 1 ? "" : "s"}`}
            </div>
          </div>
          {triage.length > 5 && (
            <button type="button" className="ad-enlace" style={{ background: "none", border: "none", cursor: "pointer", font: "inherit" }} onClick={() => setVerTodo((v) => !v)}>
              {verTodo ? "Ver 5" : `Ver los ${triage.length}`}
            </button>
          )}
        </header>
        {triage.length === 0 ? (
          <Vacio>Ningún cliente en riesgo ahora mismo.</Vacio>
        ) : (
          <ul className="ad-pend">
            {triageVisible.map((f) => {
              const primero = f.riesgos[0];
              return (
                <li key={f.supabaseId}>
                  <Link href={`/admin/clientes/${f.supabaseId}`} className="ad-pend__fila" title={`${primero.clinicaNombre}: ${primero.riesgo.detalle}`}>
                    <span className={`ad-sev ad-sev--${primero.riesgo.severidad}`} aria-hidden />
                    <span className="ad-pend__texto">
                      <span className="ad-pend__clinica">{f.nombre}</span>
                      <Chip tono={TONO_SEVERIDAD[primero.riesgo.severidad]} sm>{primero.riesgo.titulo}</Chip>
                      <span className="ad-suave" style={{ fontSize: 12 }}>
                        {primero.clinicaNombre}{f.riesgos.length > 1 ? ` +${f.riesgos.length - 1}` : ""}
                      </span>
                    </span>
                    <span className="ad-pend__dato ad-num">{formatCurrency(f.mrr.total, "MXN")}/mes</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* ── Herramientas ──────────────────────────────────────────────── */}
      <div className="ad-toolbar">
        <div className="ad-buscar">
          <Search size={14} aria-hidden />
          <input
            className="input-new"
            placeholder="Buscar cliente, email o clínica…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Buscar cliente"
          />
        </div>
        <div className="ad-filtros" role="group" aria-label="Filtro">
          {FILTROS.map((f) => (
            <button key={f.id} type="button" className="ad-filtro" aria-pressed={filtro === f.id} onClick={() => setFiltro(f.id)}>
              {f.label}
              <span className="ad-filtro__n ad-num">{cuentas[f.id]}</span>
            </button>
          ))}
        </div>
        <div className="ad-orden">
          <label htmlFor="orden-clientes">Ordenar</label>
          <select id="orden-clientes" className="input-new" value={orden} onChange={(e) => { setOrden(e.target.value as ClaveOrden); setDesc(e.target.value !== "nombre"); }}>
            {ORDENES.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
          <button type="button" className="icon-btn-new" onClick={() => setDesc((d) => !d)} title={desc ? "De mayor a menor" : "De menor a mayor"} aria-label="Invertir el orden">
            {desc ? <ArrowDownWideNarrow size={15} /> : <ArrowUpNarrowWide size={15} />}
          </button>
        </div>
      </div>

      {/* ── Tabla ─────────────────────────────────────────────────────── */}
      <div className="ad-tabla ad-tabla--apilada">
        <div className="ad-tabla__scroll">
          <table>
            <thead>
              <tr>
                <th>Cliente</th>
                <th>Sedes</th>
                <th>Estado</th>
                <th>Última compra</th>
                <th>Renueva</th>
                <th>Uso</th>
                <th className="ad-der">MRR</th>
                <th className="ad-der">Pacientes</th>
              </tr>
            </thead>
            <tbody>
              {visibles.map((f) => <FilaTabla key={f.supabaseId} fila={f} ahora={ahora} />)}
              {visibles.length === 0 && (
                <tr>
                  <td colSpan={8} className="ad-tabla__vacio">Ningún cliente coincide con lo que buscas.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="ad-tabla__pie">
          <span><Users size={12} style={{ verticalAlign: "-2px" }} /> {visibles.length} de {filas.length} clientes · ordenados por {etiquetaOrden.toLowerCase()}{orden === "compra" ? " (último pago cobrado de cualquiera de sus sedes; sin pagos, la fecha de alta)" : ""}</span>
          {sinRegistroDeAcceso > 0 && <span>{sinRegistroDeAcceso} sin sesión de panel registrada (la analítica es reciente)</span>}
        </div>
      </div>
    </div>
  );
}

// ── Una fila ───────────────────────────────────────────────────────────────

function FilaTabla({ fila, ahora }: { fila: FilaCliente; ahora: Date }) {
  const primero = fila.riesgos[0];
  const nivelCupo = patientQuotaLevel(fila.cupo);
  // Una sola sede: la insignia del gate (plan-status) es exacta. Con varias
  // no existe "el" estado de plan del cliente: lo dice la tira de sedes.
  const unica = fila.vigentes.length === 1 ? fila.vigentes[0] : null;
  const uso = usoAgregado(fila.vigentes);
  const pago = unica ? metodoDePago(unica.clinica) : null;
  const tend = fila.tendencia;

  return (
    <tr>
      <td data-col="Cliente">
        <div className="ad-celda-nombre">
          <AvatarNew name={fila.nombre} size="sm" />
          <div className="ad-celda-nombre__texto">
            <Link href={`/admin/clientes/${fila.supabaseId}`} className="ad-nombre">
              {fila.nombre}
              {fila.enLinea && <span className="ad-online" style={{ marginLeft: 6, verticalAlign: "1px" }} title={`Alguien en el panel en los últimos ${MINUTOS_EN_LINEA} minutos`} />}
            </Link>
            <div className={css.meta} title={fila.email}>{fila.email}{fila.afiliado ? ` · vía ${fila.afiliado}` : ""}</div>
          </div>
        </div>
      </td>

      <td data-col="Sedes">
        <div className={css.sedes}>
          {fila.clinicas.map((v) => (
            <Link key={v.clinica.id} href={`/admin/clinics/${v.clinica.id}`} className={`${css.sede} ${claseSede(v)}`} title={tituloSede(v)}>
              <span className={css.sedePunto} aria-hidden />
              <span className={css.sedeNombre}>{v.clinica.nombre}</span>
            </Link>
          ))}
        </div>
      </td>

      <td data-col="Estado">
        <div className={css.celda}>
          <Chip tono={TONO_ESTADO_CLIENTE[fila.estado]} punto>{ETIQUETA_ESTADO_CLIENTE[fila.estado]}</Chip>
          {primero ? (
            <Chip tono={TONO_SEVERIDAD[primero.riesgo.severidad]} sm title={`${primero.clinicaNombre}: ${primero.riesgo.detalle}`}>
              {primero.riesgo.titulo}{fila.riesgos.length > 1 ? ` +${fila.riesgos.length - 1}` : ""}
            </Chip>
          ) : unica ? (
            <PlanStatusBadge clinic={unica.clinica} now={ahora} />
          ) : (
            <span className={`${css.meta} ${css.num}`}>{fila.resumen.porEstado.pagando} de {fila.vigentes.length} pagando</span>
          )}
        </div>
      </td>

      <td data-col="Última compra">
        <div className={css.celda}>
          <span className={`ad-fuerte ${css.num}`}>
            {fila.ultimaCompraAt ? fechaAdmin(fila.ultimaCompraAt) : fechaAdmin(fila.altaAt)}
            {!fila.ultimaCompraAt && <span className="ad-suave" title="Nunca ha pagado: es la fecha de alta"> · alta</span>}
          </span>
          <span className={`${css.meta} ${css.num}`}>alta {fechaAdmin(fila.altaAt) ?? "—"}</span>
        </div>
      </td>

      <td data-col="Renueva">
        <div className={css.celda}>
          <span className={`ad-fuerte ${css.num}`}>{fila.proximaRenovacionAt ? fechaAdmin(fila.proximaRenovacionAt) : "—"}</span>
          <span className={css.meta}>{pago ? pago.etiqueta : fila.vigentes.length > 1 ? "varias sedes" : "—"}</span>
        </div>
      </td>

      <td data-col="Uso">
        <div className={css.celda} style={{ minWidth: 132, gap: 6 }}>
          {uso ? (
            <>
              <BarraUso label="Disco" usado={uso.storageUsado} tope={uso.storageTope} fmt={bytesCortos} compacta />
              {uso.tokensTope > 0
                ? <BarraUso label="IA" usado={uso.tokensUsados} tope={uso.tokensTope} fmt={tokensCortos} compacta />
                : <span className={`${css.meta} ${css.num}`}>IA · sin cupo</span>}
            </>
          ) : (
            <span className={css.sinDato}>sin medir</span>
          )}
          <span className={`${css.volumen} ${css.num}`} title={`${tend.actual.citas} citas · ${tend.actual.facturas} facturas · ${tend.actual.notas} notas en ${DIAS_VENTANA_ACTIVIDAD} d`}>
            <strong>{tend.actual.total.toLocaleString("es-MX")}</strong> en 30 d
            {tend.deltaPct !== null && <span className="ad-suave"> · {tend.deltaPct > 0 ? "+" : ""}{tend.deltaPct}%</span>}
          </span>
        </div>
      </td>

      <td data-col="MRR" className="ad-der">
        <div className={css.celda} style={{ alignItems: "flex-end" }}>
          <span className={`ad-fuerte ${css.num}`} style={{ fontSize: 14, color: fila.mrr.total === 0 ? "var(--text-3)" : undefined }}>
            {formatCurrency(fila.mrr.total, "MXN")}
          </span>
          <span className={`${css.meta} ${css.num}`}>{fila.mrr.total > 0 ? mrrBreakdownHint(fila.mrr) : "no cobra"}</span>
        </div>
      </td>

      <td data-col="Pacientes" className="ad-der">
        <div className={css.celda} style={{ alignItems: "flex-end" }}>
          <span
            className={`ad-fuerte ${css.num}`}
            style={{ fontSize: 14, color: nivelCupo === "full" ? "var(--danger)" : nivelCupo === "warn" ? "var(--warning)" : undefined }}
            title={fila.cupo.unlimited ? "Alguna de sus sedes tiene plan sin tope de pacientes" : `${fila.cupo.remaining ?? 0} de cupo libre entre sus sedes`}
          >
            {formatPatientQuota(fila.cupo)}
          </span>
          <span className={`${css.meta} ${css.num}`}>{fila.citasPasadas.toLocaleString("es-MX")} citas</span>
        </div>
      </td>
    </tr>
  );
}
