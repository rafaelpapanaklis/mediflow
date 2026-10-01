// Server component a propósito (sin estado ni handlers): recibe los datos YA
// calculados por /admin/page.tsx y sólo los pinta. Lo único de cliente es la
// gráfica (conmutador Semana / Mes / Año), que va aparte.
//
// Estructura (la que Rafael pidió el 26-sep-2026): cuatro tarjetas grandes
// de color con UN número; la gráfica de ingresos y altas; sparklines con su
// número; facturación hoy / mes / año; y la lista de pendientes. Muy poco
// texto: números, chips y barras.
import Link from "next/link";
import {
  AlertTriangle, ArrowUpRight, BadgeCheck, CalendarClock, ChevronRight, Gauge, ReceiptText, Info,
} from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { fechaAdmin } from "@/lib/admin/zona-horaria";
import type { AdminMrr } from "@/lib/admin/mrr-core";
import type { MrrModulos } from "@/lib/admin/modulos-core";
import type { PuntoNegocio, Rango } from "@/lib/admin/serie-negocio";
import { AvatarNew } from "@/components/ui/design-system/avatar-new";
import { PlanStatusBadge, type PlanClinicLike } from "@/components/admin/plan-status-badge";
import { Chip, Cifra, Sparkline, Tarjeta, Tile, Vacio } from "@/components/admin/rediseno/piezas";
import { GraficaNegocio } from "./grafica-negocio";
import { TileEnLinea, type EnLineaInicial } from "./tile-en-linea";
import { TONO_MOTIVO, type ConteosTiles, type Pendiente } from "./pendientes";
import type { FilaActividad } from "./atencion-core";

/** Cuántos pendientes se listan antes del enlace «ver todas». */
export const PENDIENTES_VISIBLES = 10;
/** Cuántas clínicas de «quién está trabajando» se enseñan. */
export const TRABAJANDO_VISIBLES = 6;

export interface PagoReciente {
  id: string;
  clinicaId: string;
  clinicaNombre: string;
  monto: number;
  metodo: string | null;
  status: string;
  fecha: Date;
  /** Estado de plan de la clínica (para la insignia); null si la clínica ya no existe. */
  clinica: PlanClinicLike | null;
}

export interface DatosPortada {
  fechaStr: string;
  tiles: ConteosTiles;
  series: Record<Rango, PuntoNegocio[]>;
  /** Últimos 6 meses (el de hoy al final). */
  sparks: {
    meses: number;
    altas: number[];
    bajas: number[];
    cfdi: number[];
    pagos: number[];
    /** null = no se pudo leer cfdi_usage. */
    cfdiMedido: boolean;
  };
  /** `medido` false = la consulta de cobros falló: se pinta «—», no $0. */
  facturacion: { hoy: number; mes: number; anio: number; porCobrar: number; fallidos: number; medido: boolean };
  negocio: {
    mrr: AdminMrr;
    /**
     * Lo que entra por módulos (clinic_modules), aparte de los planes. `null` o
     * ausente = no se pudo medir: el MRR se pinta solo con los planes.
     */
    mrrModulos?: MrrModulos | null;
    mrrPotencial: number;
    activas: number;
    enTrial: number;
    vencidas: number;
    total: number;
    dePrueba: number;
    archivadas: number;
    altasMes: number;
    altasMesAnterior: number;
    bajasMes: number;
    cancelacionesPedidas: number;
  };
  pendientes: Pendiente[];
  /** Clínicas reales con al menos un pendiente. */
  clinicasConPendiente: number;
  reales: number;
  ultimosPagos: PagoReciente[];
  trabajando: FilaActividad[];
  enLinea: number;
  /**
   * «Clínicas en línea» de la tarjeta azul: señal de vida del panel (Redis), no la
   * actividad de arriba. `clinicas: null` = sin dato. Ausente = sin dato.
   */
  enLineaAhora?: EnLineaInicial;
  /** Lo que no se pudo medir. */
  avisos: string[];
}

const SEV: Record<Pendiente["severidad"], string> = { critico: "Crítico", alto: "Alto", medio: "Medio" };

const METODO: Record<string, string> = {
  stripe: "Stripe", transfer: "Transferencia", spei: "SPEI", deposit: "Depósito",
  oxxo: "OXXO", paypal: "PayPal", cash: "Efectivo", mercadopago: "Mercado Pago", cfdi_overage: "Excedente CFDI",
};

function ultimoDe(v: number[]): number {
  return v.length ? v[v.length - 1] : 0;
}

/**
 * La tarjeta del MRR: planes + módulos. Aparte de `PortadaVista` para poder
 * verla con datos de ejemplo sin armar la portada entera.
 */
export function TarjetaMrr({ negocio }: { negocio: Pick<DatosPortada["negocio"], "mrr" | "mrrModulos" | "mrrPotencial"> }) {
  return (
    <Tarjeta title="MRR" action={<Link href="/admin/clientes" className="dcp-enlace">Clientes <ArrowUpRight size={13} /></Link>}>
      {/* Planes + módulos: lo que cada clínica paga por sus módulos también es ingreso del mes. */}
      <div className="dcp-cifra__n dcp-num dcp-cifra__n--brand" style={{ fontSize: 30 }} data-mrr-total>
        {formatCurrency(negocio.mrr.total + (negocio.mrrModulos?.total ?? 0))}
      </div>
      <div className="dcp-cifra__pie">
        {negocio.mrrModulos && negocio.mrrModulos.total > 0 && (
          <>planes {formatCurrency(negocio.mrr.total)} + módulos {formatCurrency(negocio.mrrModulos.total)}{" · "}</>
        )}
        {negocio.mrr.clinics} {negocio.mrr.clinics === 1 ? "clínica paga" : "clínicas pagan"}
        {negocio.mrr.includedBranches > 0 && ` · ${negocio.mrr.includedBranches} sede${negocio.mrr.includedBranches === 1 ? "" : "s"} incluida${negocio.mrr.includedBranches === 1 ? "" : "s"} a $0`}
        {" · potencial "}{formatCurrency(negocio.mrrPotencial)} con los trials
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 12 }}>
        {negocio.mrr.byPlan.filter((p) => p.clinics > 0).map((p) => (
          <Chip key={p.plan} tono={p.plan === "CLINIC" ? "brand" : p.plan === "PRO" ? "info" : "neutral"} title={`${p.clinics} × ${formatCurrency(p.listPrice)}${p.negotiated ? ` · ${p.negotiated} con precio negociado` : ""}${p.conserved ? ` · ${p.conserved} con precio conservado` : ""}`}>
            {p.plan} · {p.clinics} · {formatCurrency(p.total)}
          </Chip>
        ))}
        {negocio.mrr.byPlan.every((p) => p.clinics === 0) && <span className="dcp-suave">Ninguna clínica activa.</span>}
        {(negocio.mrrModulos?.porModulo ?? []).map((m) => (
          <Chip
            key={`modulo-${m.moduleKey}`}
            tono="success"
            title={`Módulo ${m.moduleName}: ${m.clinicas} ${m.clinicas === 1 ? "clínica lo tiene" : "clínicas lo tienen"} · ${m.pagando} ${m.pagando === 1 ? "paga" : "pagan"}${m.cortesia ? ` · ${m.cortesia} de cortesía` : ""}. Importes de lo que pagó cada una, sin IVA.`}
          >
            {m.moduleName} · {m.clinicas} · {formatCurrency(m.total)}
          </Chip>
        ))}
      </div>
    </Tarjeta>
  );
}

export function PortadaVista({ datos: d, now }: { datos: DatosPortada; now: Date }) {
  const visibles = d.pendientes.slice(0, PENDIENTES_VISIBLES);
  const ocultos = d.pendientes.length - visibles.length;
  const crecimiento = d.negocio.altasMesAnterior > 0
    ? Math.round(((d.negocio.altasMes - d.negocio.altasMesAnterior) / d.negocio.altasMesAnterior) * 100)
    : null;

  return (
    <div className="dcp-pagina">
      <header className="dcp-cabecera">
        <div>
          <h1 className="dcp-titulo">Dashboard</h1>
          <p className="dcp-sub">{d.fechaStr}</p>
        </div>
        <div className="dcp-acciones">
          <Link href="/admin/payments" className="btn-new btn-new--secondary">Registrar pago</Link>
          <Link href="/admin/reports" className="btn-new btn-new--primary">Reporte completo</Link>
        </div>
      </header>

      {/* ── 1. Lo accionable, en cuatro números ── */}
      <div className="dcp-tiles">
        <Tile href="/admin/payments" tono={d.tiles.porVerificar.pagos > 0 ? "warning" : "quieto"} icono={ReceiptText}
          n={d.tiles.porVerificar.pagos} label={d.tiles.porVerificar.monto > 0 ? `Pagos por verificar · ${formatCurrency(d.tiles.porVerificar.monto)}` : "Pagos por verificar"}
          title="Pagos de suscripción registrados a mano (transferencia, depósito…) y transferencias SPEI directas que siguen en «pendiente»" />
        <Tile href="/admin/clinics" tono={d.tiles.cobrosRotos > 0 ? "danger" : "quieto"} icono={AlertTriangle}
          n={d.tiles.cobrosRotos} label="Cobros fallidos o usando sin plan"
          title="Stripe no pudo cobrar, o el periodo venció y la clínica sigue trabajando" />
        <Tile href="/admin/clinics" tono={d.tiles.renovaciones > 0 ? "brand" : "quieto"} icono={CalendarClock}
          n={d.tiles.renovaciones} label="Renovaciones manuales en 7 días"
          title="Clínicas que pagan a mano (transferencia, SPEI, OXXO, depósito) y renuevan en los próximos 7 días. Las de tarjeta en Stripe se cobran solas; si fallan, salen en «Cobros fallidos»." />
        {/* Antes aquí iba «Clínicas cerca de un tope»: ahora vive en «Este mes» (más abajo). */}
        <TileEnLinea inicial={d.enLineaAhora ?? { disponible: false, clinicas: null, ahora: now.getTime() }} />
      </div>

      {/* ── 2 + 3. Gráfica y sparklines ── */}
      <div className="dcp-grid-2">
        <Tarjeta title="Ingresos y altas" sub="Pagos de suscripción cobrados y clínicas nuevas · semana, mes o año en curso, calendario de Mérida">
          <GraficaNegocio series={d.series} />
        </Tarjeta>
        <div className="dcp-columna">
          <Tarjeta title={`Últimos ${d.sparks.meses} meses`} sub="El número es el mes en curso">
            <div className="dcp-sparks">
              <Sparkline valores={d.sparks.altas} tono="info" label="Altas" n={ultimoDe(d.sparks.altas)} />
              <Sparkline valores={d.sparks.bajas} tono="danger" label="Bajas" n={ultimoDe(d.sparks.bajas)} />
              <Sparkline valores={d.sparks.cfdi} tono="warning" label="CFDI timbrados" n={d.sparks.cfdiMedido ? ultimoDe(d.sparks.cfdi) : "—"} />
              <Sparkline valores={d.sparks.pagos} tono="success" label="Pagos cobrados" n={d.facturacion.medido ? ultimoDe(d.sparks.pagos) : "—"} />
            </div>
          </Tarjeta>
          <Tarjeta title="Facturación">
            <div className="dcp-cifras">
              <Cifra label="Hoy" n={d.facturacion.medido ? formatCurrency(d.facturacion.hoy) : "—"} tono="success" />
              <Cifra label="Este mes" n={d.facturacion.medido ? formatCurrency(d.facturacion.mes) : "—"} tono="brand"
                pie={!d.facturacion.medido
                  ? "no se pudieron leer los cobros"
                  : d.facturacion.porCobrar > 0
                    ? `${formatCurrency(d.facturacion.porCobrar)} por cobrar${d.facturacion.fallidos ? ` · ${d.facturacion.fallidos} fallido${d.facturacion.fallidos === 1 ? "" : "s"}` : ""}`
                    : "nada por cobrar"} />
              <Cifra label="Este año" n={d.facturacion.medido ? formatCurrency(d.facturacion.anio) : "—"} />
            </div>
          </Tarjeta>
        </div>
      </div>

      {/* ── 4. El negocio en números ── */}
      <div className="dcp-grid-3">
        <TarjetaMrr negocio={d.negocio} />

        <Tarjeta title="Clínicas" action={<Link href="/admin/clinics" className="dcp-enlace">Ver todas <ArrowUpRight size={13} /></Link>}>
          <div className="dcp-cifra__n dcp-num" style={{ fontSize: 30 }}>{d.negocio.total}</div>
          <div className="dcp-cifra__pie">
            {d.reales} reales
            {d.negocio.dePrueba > 0 && ` · ${d.negocio.dePrueba} de prueba`}
            {d.negocio.archivadas > 0 && ` · ${d.negocio.archivadas} archivada${d.negocio.archivadas === 1 ? "" : "s"}`}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 12 }}>
            <Chip tono="success" punto>{d.negocio.activas} activas</Chip>
            <Chip tono="info" punto>{d.negocio.enTrial} en trial</Chip>
            <Chip tono={d.negocio.vencidas > 0 ? "danger" : "neutral"} punto>{d.negocio.vencidas} vencidas</Chip>
            {d.enLinea > 0 && <Chip tono="neutral"><span className="dcp-online" /> {d.enLinea} en línea</Chip>}
          </div>
        </Tarjeta>

        <Tarjeta title="Este mes">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <div className="dcp-cifra__label">Altas</div>
              <div className="dcp-cifra__n dcp-num dcp-cifra__n--success">{d.negocio.altasMes}</div>
              <div className="dcp-cifra__pie">
                {crecimiento === null
                  ? `${d.negocio.altasMesAnterior} el mes pasado`
                  : `${crecimiento >= 0 ? "+" : ""}${crecimiento}% vs. ${d.negocio.altasMesAnterior} del mes pasado`}
              </div>
            </div>
            <div>
              <div className="dcp-cifra__label">Bajas</div>
              <div className={`dcp-cifra__n dcp-num${d.negocio.bajasMes > 0 ? " dcp-cifra__n--warning" : ""}`}>{d.negocio.bajasMes}</div>
              <div className="dcp-cifra__pie">
                archivadas este mes
                {d.negocio.cancelacionesPedidas > 0 && ` · ${d.negocio.cancelacionesPedidas} cancelación${d.negocio.cancelacionesPedidas === 1 ? "" : "es"} pedida${d.negocio.cancelacionesPedidas === 1 ? "" : "s"}`}
              </div>
            </div>
            <div style={{ gridColumn: "1 / -1", borderTop: "1px solid var(--m2-tarjeta-borde)", paddingTop: 12 }}
              title="Almacenamiento o tokens IA al 80 % o más, usuarios al tope, CFDI por encima del cupo, saldo IA bajo o en negativo">
              <div className="dcp-cifra__label" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <Gauge size={13} aria-hidden /> Clínicas cerca de un tope
              </div>
              <div className={`dcp-cifra__n dcp-num${d.tiles.cercaDelTope > 0 ? " dcp-cifra__n--warning" : ""}`} data-cerca-del-tope>
                {d.tiles.cercaDelTope}
              </div>
              <div className="dcp-cifra__pie">
                cupos al 80 % o más o saldo IA bajo · <Link href="/admin/clinics" className="dcp-enlace">Ver clínicas <ArrowUpRight size={13} /></Link>
              </div>
            </div>
          </div>
        </Tarjeta>
      </div>

      {/* ── 5. Pendientes y actividad ── */}
      <div className="dcp-grid-2">
        <Tarjeta
          sinPadding
          title="Requiere tu atención"
          sub={d.pendientes.length === 0
            ? `Se revisaron ${d.reales} clínicas reales`
            : `${d.clinicasConPendiente} de ${d.reales} clínicas · ${d.pendientes.length} pendiente${d.pendientes.length === 1 ? "" : "s"}`}
          action={<Link href="/admin/clinics" className="dcp-enlace">Clínicas <ChevronRight size={13} /></Link>}
          pie={d.avisos.length > 0 ? (
            <span style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
              <Info size={13} style={{ flexShrink: 0, marginTop: 2 }} aria-hidden />
              <span>No se pudo medir todo: {d.avisos.join(" · ")}.</span>
            </span>
          ) : undefined}
        >
          {visibles.length === 0 ? (
            <Vacio>Nada exige atención hoy.</Vacio>
          ) : (
            <ul className="dcp-pend">
              {visibles.map((p) => (
                <li key={p.clave}>
                  <Link href={p.href} className="dcp-pend__fila" title={`${SEV[p.severidad]} · ${p.titulo}`}>
                    <span className={`dcp-sev dcp-sev--${p.severidad}`} aria-hidden />
                    <span className="dcp-pend__texto">
                      <span className="dcp-pend__clinica">{p.clinicaNombre}</span>
                      <Chip tono={TONO_MOTIVO[p.motivo]} sm>{p.titulo}</Chip>
                    </span>
                    <span className={`dcp-pend__dato dcp-num${p.monto > 0 ? " dcp-pend__dato--dinero" : ""}`}>
                      {p.monto > 0 ? formatCurrency(p.monto) : p.dato}
                    </span>
                  </Link>
                </li>
              ))}
              {ocultos > 0 && (
                <li>
                  <Link href="/admin/clinics" className="dcp-pend__fila">
                    <span aria-hidden />
                    <span className="dcp-suave">y {ocultos} más</span>
                    <ChevronRight size={14} className="dcp-suave" aria-hidden />
                  </Link>
                </li>
              )}
            </ul>
          )}
        </Tarjeta>

        <div className="dcp-columna">
          <Tarjeta sinPadding title="Últimos pagos" action={<Link href="/admin/payments" className="dcp-enlace">Ver todos <ArrowUpRight size={13} /></Link>}>
            {d.ultimosPagos.length === 0 ? (
              <div className="dcp-tabla__vacio">Sin pagos registrados.</div>
            ) : (
              <ul className="dcp-pend">
                {d.ultimosPagos.map((p) => (
                  <li key={p.id}>
                    <Link href={`/admin/clinics/${p.clinicaId}`} className="dcp-pend__fila" style={{ gridTemplateColumns: "auto minmax(0,1fr) auto" }}>
                      <AvatarNew name={p.clinicaNombre} size="sm" />
                      <span className="dcp-pend__texto" style={{ flexDirection: "column", alignItems: "flex-start", gap: 3 }}>
                        <span className="dcp-pend__clinica">{p.clinicaNombre}</span>
                        <span className="dcp-meta">{METODO[p.metodo ?? ""] ?? p.metodo ?? "—"} · {fechaAdmin(p.fecha)}</span>
                        {/* La MISMA insignia de estado de plan que Clínicas (plan-status). */}
                        {p.clinica && <PlanStatusBadge clinic={p.clinica} now={now} />}
                      </span>
                      <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 3 }}>
                        <span className="dcp-pend__dato dcp-pend__dato--dinero">{formatCurrency(p.monto)}</span>
                        <Chip sm tono={p.status === "paid" ? "success" : p.status === "failed" ? "danger" : "warning"}>
                          {p.status === "paid" ? "Pagado" : p.status === "failed" ? "Fallido" : "Pendiente"}
                        </Chip>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Tarjeta>

          <Tarjeta sinPadding title="Quién está trabajando" sub="Citas + facturas + notas en 30 días">
            {d.trabajando.length === 0 ? (
              <div className="dcp-tabla__vacio">Sin clínicas que medir.</div>
            ) : (
              <ul className="dcp-pend">
                {d.trabajando.slice(0, TRABAJANDO_VISIBLES).map((f) => {
                  const total = f.actividad.citas + f.actividad.facturas + f.actividad.notas;
                  return (
                    <li key={f.id}>
                      <Link href={`/admin/clinics/${f.id}`} className="dcp-pend__fila" style={{ gridTemplateColumns: "minmax(0,1fr) auto auto" }}>
                        <span className="dcp-pend__texto">
                          <span className="dcp-pend__clinica">{f.nombre}</span>
                          {f.enLinea && <span className="dcp-online" title="En el panel ahora" />}
                        </span>
                        <span className="dcp-pend__dato dcp-num" title={`${f.actividad.citas} citas · ${f.actividad.facturas} facturas · ${f.actividad.notas} notas`}>
                          <strong style={{ color: "var(--text-1)" }}>{total}</strong>
                        </span>
                        <span style={{ minWidth: 58, textAlign: "right" }}>
                          {f.cambioPct === null
                            ? <Chip sm tono="neutral">{total > 0 ? "nuevo" : "—"}</Chip>
                            : <Chip sm tono={f.cambioPct > 0 ? "success" : f.cambioPct < 0 ? "danger" : "neutral"}>{f.cambioPct > 0 ? "+" : ""}{f.cambioPct}%</Chip>}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </Tarjeta>
        </div>
      </div>

      {d.pendientes.length === 0 && d.avisos.length === 0 && (
        <p className="dcp-sub" style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <BadgeCheck size={14} aria-hidden /> Cobros, planes, trials, actividad, cupos y saldo IA revisados sin señales.
        </p>
      )}
    </div>
  );
}
