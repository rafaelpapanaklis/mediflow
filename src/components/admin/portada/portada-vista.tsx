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
import type { PuntoNegocio, Rango } from "@/lib/admin/serie-negocio";
import { AvatarNew } from "@/components/ui/design-system/avatar-new";
import { PlanStatusBadge, type PlanClinicLike } from "@/components/admin/plan-status-badge";
import { Chip, Cifra, Sparkline, Tarjeta, Tile, Vacio } from "@/components/admin/rediseno/piezas";
import { GraficaNegocio } from "./grafica-negocio";
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

export function PortadaVista({ datos: d, now }: { datos: DatosPortada; now: Date }) {
  const visibles = d.pendientes.slice(0, PENDIENTES_VISIBLES);
  const ocultos = d.pendientes.length - visibles.length;
  const crecimiento = d.negocio.altasMesAnterior > 0
    ? Math.round(((d.negocio.altasMes - d.negocio.altasMesAnterior) / d.negocio.altasMesAnterior) * 100)
    : null;

  return (
    <div className="ad-pagina">
      <header className="ad-cabecera">
        <div>
          <h1 className="ad-titulo">Dashboard</h1>
          <p className="ad-sub">{d.fechaStr}</p>
        </div>
        <div className="ad-acciones">
          <Link href="/admin/payments" className="btn-new btn-new--secondary">Registrar pago</Link>
          <Link href="/admin/reports" className="btn-new btn-new--primary">Reporte completo</Link>
        </div>
      </header>

      {/* ── 1. Lo accionable, en cuatro números ── */}
      <div className="ad-tiles">
        <Tile href="/admin/payments" tono={d.tiles.porVerificar.pagos > 0 ? "warning" : "quieto"} icono={ReceiptText}
          n={d.tiles.porVerificar.pagos} label={d.tiles.porVerificar.monto > 0 ? `Pagos por verificar · ${formatCurrency(d.tiles.porVerificar.monto)}` : "Pagos por verificar"}
          title="Pagos de suscripción registrados a mano (transferencia, depósito…) y transferencias SPEI directas que siguen en «pendiente»" />
        <Tile href="/admin/clinics" tono={d.tiles.cobrosRotos > 0 ? "danger" : "quieto"} icono={AlertTriangle}
          n={d.tiles.cobrosRotos} label="Cobros fallidos o usando sin plan"
          title="Stripe no pudo cobrar, o el periodo venció y la clínica sigue trabajando" />
        <Tile href="/admin/clinics" tono={d.tiles.renovaciones > 0 ? "brand" : "quieto"} icono={CalendarClock}
          n={d.tiles.renovaciones} label="Renovaciones manuales en 7 días"
          title="Clínicas que pagan a mano (transferencia, SPEI, OXXO, depósito) y renuevan en los próximos 7 días. Las de tarjeta en Stripe se cobran solas; si fallan, salen en «Cobros fallidos»." />
        <Tile href="/admin/clinics" tono={d.tiles.cercaDelTope > 0 ? "info" : "quieto"} icono={Gauge}
          n={d.tiles.cercaDelTope} label="Clínicas cerca de un tope"
          title="Almacenamiento o tokens IA al 80 % o más, usuarios al tope, CFDI por encima del cupo, saldo IA bajo o en negativo" />
      </div>

      {/* ── 2 + 3. Gráfica y sparklines ── */}
      <div className="ad-grid-2">
        <Tarjeta title="Ingresos y altas" sub="Pagos de suscripción cobrados y clínicas nuevas · semana, mes o año en curso, calendario de Mérida">
          <GraficaNegocio series={d.series} />
        </Tarjeta>
        <div className="ad-columna">
          <Tarjeta title={`Últimos ${d.sparks.meses} meses`} sub="El número es el mes en curso">
            <div className="ad-sparks">
              <Sparkline valores={d.sparks.altas} tono="info" label="Altas" n={ultimoDe(d.sparks.altas)} />
              <Sparkline valores={d.sparks.bajas} tono="danger" label="Bajas" n={ultimoDe(d.sparks.bajas)} />
              <Sparkline valores={d.sparks.cfdi} tono="warning" label="CFDI timbrados" n={d.sparks.cfdiMedido ? ultimoDe(d.sparks.cfdi) : "—"} />
              <Sparkline valores={d.sparks.pagos} tono="success" label="Pagos cobrados" n={d.facturacion.medido ? ultimoDe(d.sparks.pagos) : "—"} />
            </div>
          </Tarjeta>
          <Tarjeta title="Facturación">
            <div className="ad-cifras">
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
      <div className="ad-grid-3">
        <Tarjeta title="MRR" action={<Link href="/admin/clientes" className="ad-enlace">Clientes <ArrowUpRight size={13} /></Link>}>
          <div className="ad-cifra__n ad-num ad-cifra__n--brand" style={{ fontSize: 30 }}>{formatCurrency(d.negocio.mrr.total)}</div>
          <div className="ad-cifra__pie">
            {d.negocio.mrr.clinics} {d.negocio.mrr.clinics === 1 ? "clínica paga" : "clínicas pagan"}
            {d.negocio.mrr.includedBranches > 0 && ` · ${d.negocio.mrr.includedBranches} sede${d.negocio.mrr.includedBranches === 1 ? "" : "s"} incluida${d.negocio.mrr.includedBranches === 1 ? "" : "s"} a $0`}
            {" · potencial "}{formatCurrency(d.negocio.mrrPotencial)} con los trials
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 12 }}>
            {d.negocio.mrr.byPlan.filter((p) => p.clinics > 0).map((p) => (
              <Chip key={p.plan} tono={p.plan === "CLINIC" ? "brand" : p.plan === "PRO" ? "info" : "neutral"} title={`${p.clinics} × ${formatCurrency(p.listPrice)}${p.negotiated ? ` · ${p.negotiated} con precio negociado` : ""}${p.conserved ? ` · ${p.conserved} con precio conservado` : ""}`}>
                {p.plan} · {p.clinics} · {formatCurrency(p.total)}
              </Chip>
            ))}
            {d.negocio.mrr.byPlan.every((p) => p.clinics === 0) && <span className="ad-suave">Ninguna clínica activa.</span>}
          </div>
        </Tarjeta>

        <Tarjeta title="Clínicas" action={<Link href="/admin/clinics" className="ad-enlace">Ver todas <ArrowUpRight size={13} /></Link>}>
          <div className="ad-cifra__n ad-num" style={{ fontSize: 30 }}>{d.negocio.total}</div>
          <div className="ad-cifra__pie">
            {d.reales} reales
            {d.negocio.dePrueba > 0 && ` · ${d.negocio.dePrueba} de prueba`}
            {d.negocio.archivadas > 0 && ` · ${d.negocio.archivadas} archivada${d.negocio.archivadas === 1 ? "" : "s"}`}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 12 }}>
            <Chip tono="success" punto>{d.negocio.activas} activas</Chip>
            <Chip tono="info" punto>{d.negocio.enTrial} en trial</Chip>
            <Chip tono={d.negocio.vencidas > 0 ? "danger" : "neutral"} punto>{d.negocio.vencidas} vencidas</Chip>
            {d.enLinea > 0 && <Chip tono="neutral"><span className="ad-online" /> {d.enLinea} en línea</Chip>}
          </div>
        </Tarjeta>

        <Tarjeta title="Este mes">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <div className="ad-cifra__label">Altas</div>
              <div className="ad-cifra__n ad-num ad-cifra__n--success">{d.negocio.altasMes}</div>
              <div className="ad-cifra__pie">
                {crecimiento === null
                  ? `${d.negocio.altasMesAnterior} el mes pasado`
                  : `${crecimiento >= 0 ? "+" : ""}${crecimiento}% vs. ${d.negocio.altasMesAnterior} del mes pasado`}
              </div>
            </div>
            <div>
              <div className="ad-cifra__label">Bajas</div>
              <div className={`ad-cifra__n ad-num${d.negocio.bajasMes > 0 ? " ad-cifra__n--warning" : ""}`}>{d.negocio.bajasMes}</div>
              <div className="ad-cifra__pie">
                archivadas este mes
                {d.negocio.cancelacionesPedidas > 0 && ` · ${d.negocio.cancelacionesPedidas} cancelación${d.negocio.cancelacionesPedidas === 1 ? "" : "es"} pedida${d.negocio.cancelacionesPedidas === 1 ? "" : "s"}`}
              </div>
            </div>
          </div>
        </Tarjeta>
      </div>

      {/* ── 5. Pendientes y actividad ── */}
      <div className="ad-grid-2">
        <Tarjeta
          sinPadding
          title="Requiere tu atención"
          sub={d.pendientes.length === 0
            ? `Se revisaron ${d.reales} clínicas reales`
            : `${d.clinicasConPendiente} de ${d.reales} clínicas · ${d.pendientes.length} pendiente${d.pendientes.length === 1 ? "" : "s"}`}
          action={<Link href="/admin/clinics" className="ad-enlace">Clínicas <ChevronRight size={13} /></Link>}
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
            <ul className="ad-pend">
              {visibles.map((p) => (
                <li key={p.clave}>
                  <Link href={p.href} className="ad-pend__fila" title={`${SEV[p.severidad]} · ${p.titulo}`}>
                    <span className={`ad-sev ad-sev--${p.severidad}`} aria-hidden />
                    <span className="ad-pend__texto">
                      <span className="ad-pend__clinica">{p.clinicaNombre}</span>
                      <Chip tono={TONO_MOTIVO[p.motivo]} sm>{p.titulo}</Chip>
                    </span>
                    <span className={`ad-pend__dato ad-num${p.monto > 0 ? " ad-pend__dato--dinero" : ""}`}>
                      {p.monto > 0 ? formatCurrency(p.monto) : p.dato}
                    </span>
                  </Link>
                </li>
              ))}
              {ocultos > 0 && (
                <li>
                  <Link href="/admin/clinics" className="ad-pend__fila">
                    <span aria-hidden />
                    <span className="ad-suave">y {ocultos} más</span>
                    <ChevronRight size={14} className="ad-suave" aria-hidden />
                  </Link>
                </li>
              )}
            </ul>
          )}
        </Tarjeta>

        <div className="ad-columna">
          <Tarjeta sinPadding title="Últimos pagos" action={<Link href="/admin/payments" className="ad-enlace">Ver todos <ArrowUpRight size={13} /></Link>}>
            {d.ultimosPagos.length === 0 ? (
              <div className="ad-tabla__vacio">Sin pagos registrados.</div>
            ) : (
              <ul className="ad-pend">
                {d.ultimosPagos.map((p) => (
                  <li key={p.id}>
                    <Link href={`/admin/clinics/${p.clinicaId}`} className="ad-pend__fila" style={{ gridTemplateColumns: "auto minmax(0,1fr) auto" }}>
                      <AvatarNew name={p.clinicaNombre} size="sm" />
                      <span className="ad-pend__texto" style={{ flexDirection: "column", alignItems: "flex-start", gap: 3 }}>
                        <span className="ad-pend__clinica">{p.clinicaNombre}</span>
                        <span className="ad-meta">{METODO[p.metodo ?? ""] ?? p.metodo ?? "—"} · {fechaAdmin(p.fecha)}</span>
                        {/* La MISMA insignia de estado de plan que Clínicas (plan-status). */}
                        {p.clinica && <PlanStatusBadge clinic={p.clinica} now={now} />}
                      </span>
                      <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 3 }}>
                        <span className="ad-pend__dato ad-pend__dato--dinero">{formatCurrency(p.monto)}</span>
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
              <div className="ad-tabla__vacio">Sin clínicas que medir.</div>
            ) : (
              <ul className="ad-pend">
                {d.trabajando.slice(0, TRABAJANDO_VISIBLES).map((f) => {
                  const total = f.actividad.citas + f.actividad.facturas + f.actividad.notas;
                  return (
                    <li key={f.id}>
                      <Link href={`/admin/clinics/${f.id}`} className="ad-pend__fila" style={{ gridTemplateColumns: "minmax(0,1fr) auto auto" }}>
                        <span className="ad-pend__texto">
                          <span className="ad-pend__clinica">{f.nombre}</span>
                          {f.enLinea && <span className="ad-online" title="En el panel ahora" />}
                        </span>
                        <span className="ad-pend__dato ad-num" title={`${f.actividad.citas} citas · ${f.actividad.facturas} facturas · ${f.actividad.notas} notas`}>
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
        <p className="ad-sub" style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <BadgeCheck size={14} aria-hidden /> Cobros, planes, trials, actividad, cupos y saldo IA revisados sin señales.
        </p>
      )}
    </div>
  );
}
