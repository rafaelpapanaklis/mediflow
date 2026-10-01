"use client";

/**
 * Ficha de un cliente — /admin/clientes/[supabaseId] (rediseño ws1-t2).
 *
 * Abre con lo que hay que atender, sede por sede, y el veredicto sale de
 * `evaluarSaludClinica` (@/lib/admin/salud-clinica) y de `../cartera`, no de
 * una tabla de estados de esta pantalla. El consumo (disco, tokens, CFDI,
 * usuarios, saldo IA) sale de `@/lib/admin/uso-clinica`, el mismo cálculo que
 * Clínicas.
 *
 * REDISEÑO DE LECTURA: aquí no se escribe nada. Los botones que mueven dinero
 * viven, como vivían, en la pestaña Facturación (./cliente-billing), con el
 * mismo texto y el mismo endpoint.
 */

import { BotonVerComoClinica } from "@/components/admin/boton-ver-como-clinica";
import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Mail, MessageCircle, Eye, Archive } from "lucide-react";
import { CardNew } from "@/components/ui/design-system/card-new";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { AvatarNew } from "@/components/ui/design-system/avatar-new";
import { PlanStatusBadge } from "@/components/admin/plan-status-badge";
import { RevenueAreaChart } from "@/components/dashboard/revenue-area-chart";
import { formatCurrency } from "@/lib/utils";
import { mrrBreakdownHint } from "@/lib/admin/mrr-core";
import {
  ETIQUETA_ESTADO_OPERATIVO,
  DIAS_VENTANA_ACTIVIDAD,
  MINUTOS_EN_LINEA,
  type NivelActividad,
  type Severidad,
} from "@/lib/admin/salud-clinica";
import { fechaAdmin, fechaHoraAdmin } from "@/lib/admin/zona-horaria";
import { formatPatientQuota, patientQuotaLevel } from "@/lib/patient-quota-shared";
import { bytesCortos, metodoDePago, tokensCortos, ultimaCompra } from "@/lib/admin/uso-core";
import { BarraUso, Chip, DatoCaja, Vacio, type TonoChip } from "@/components/admin/rediseno/piezas";
import { fmtMXNdec } from "@/lib/format";
import type { ClienteDetalle } from "@/lib/admin/clientes";

import {
  valorarCliente,
  ETIQUETA_ESTADO_CLIENTE,
  AVISO_MRR_SIN_MODULOS,
  desgloseMrr,
  type ClienteCrudo,
  type ClinicaValorada,
  type EstadoCliente,
  type IngresosCliente,
} from "../cartera";
import { PlanDonut, ActivityBars } from "./cliente-charts";
import { ClienteBilling } from "./cliente-billing";
import css from "./ficha.module.css";

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

const TONO_ESTADO: Record<string, TonoChip> = {
  "pagando": "success", "cobro-fallido": "danger", "trial-vigente": "info", "trial-vencido": "danger",
  "pago-pendiente": "warning", "vencida": "danger", "prueba": "neutral",
};

/** Estado operativo que se espera de cada veredicto del gate; si no coinciden se enseña también el del gate. */
const ESTADO_ESPERADO: Record<string, string[]> = {
  active:   ["pagando"],
  past_due: ["cobro-fallido"],
  trial:    ["trial-vigente", "pago-pendiente", "prueba"],
  expired:  ["vencida", "prueba"],
};

export function ClienteDetalleClient({
  cliente,
  cartera,
  planPrices,
  ahoraISO,
  ingresos,
  soloComoUsuario,
  modulosMedidos = true,
  stripeConfigured,
  stripeInstructions,
}: {
  /** Facturación y series históricas (@/lib/admin/clientes). */
  cliente: ClienteDetalle;
  /** Sus clínicas medidas (../datos), para valorar la cartera. */
  cartera: ClienteCrudo;
  planPrices: Record<string, number>;
  ahoraISO: string;
  /** Lo cobrado a este cliente, con los cortes del calendario de Mérida. */
  ingresos: IngresosCliente;
  /** La cuenta no es dueña de ninguna clínica (ver ../datos). */
  soloComoUsuario: boolean;
  /** `false` = no se pudo leer clinic_modules: el MRR va sólo con planes y se avisa. */
  modulosMedidos?: boolean;
  stripeConfigured: boolean;
  stripeInstructions: string;
}) {
  const [tab, setTab] = useState<"resumen" | "facturacion">("resumen");

  const ahora = useMemo(() => new Date(ahoraISO), [ahoraISO]);
  const fila = useMemo(() => valorarCliente(cartera, planPrices, ahora), [cartera, planPrices, ahora]);

  const actividadPorSede = useMemo(
    () => fila.vigentes.map((v) => ({ name: v.clinica.nombre, pacientes: v.clinica.cupo.used, citas: v.clinica.citasPasadas })),
    [fila.vigentes],
  );

  const waPhone = cliente.ownerPhone ? cliente.ownerPhone.replace(/[^\d]/g, "") : "";
  const criticos = fila.riesgos.filter((r) => r.riesgo.severidad === "critico").length;
  // LTV estimado: el MRR de HOY por 24 meses. Es una estimación, y se dice.
  const ltv = fila.mrrTotal * 24;
  // Debajo del MRR: de dónde sale (planes · módulos), o el aviso si los módulos no se leyeron.
  const pieMrr = !modulosMedidos
    ? AVISO_MRR_SIN_MODULOS
    : fila.mrrTotal === 0
      ? "no cobra nada al mes"
      : fila.mrrModulos > 0
        ? desgloseMrr(fila.mrr.total, fila.mrrModulos)
        : mrrBreakdownHint(fila.mrr);
  const nivelCupo = patientQuotaLevel(fila.cupo);
  const unica = fila.vigentes.length === 1 ? fila.vigentes[0] : null;
  const pago = unica ? metodoDePago(unica.clinica) : null;

  return (
    <div className={`${css.pagina} dcp-pagina`}>
      {/* ── Cabecera ────────────────────────────────────────────────────── */}
      <div className="dcp-ficha-cabecera">
        <Link href="/admin/clientes" className="dcp-volver" aria-label="Volver a clientes">
          <ArrowLeft size={14} />
        </Link>
        <AvatarNew name={fila.nombre} size="lg" />
        <div className="dcp-ficha-cabecera__texto">
          <div className="dcp-ficha-cabecera__nombre">
            <h1>{fila.nombre}</h1>
            {!fila.sinSedesVigentes && (
              <Chip tono={TONO_ESTADO_CLIENTE[fila.estado]} punto>{ETIQUETA_ESTADO_CLIENTE[fila.estado]}</Chip>
            )}
            {/* «Sin sedes vigentes» y «cuenta de prueba» son cosas distintas: un
                cliente que pagó un año y archivó su clínica también se queda sin
                sedes, y llamarle prueba sería mentir sobre su historia. */}
            {fila.sinSedesVigentes
              ? <Chip tono="neutral">Sin sedes vigentes</Chip>
              : !fila.esReal && <Chip tono="neutral">Cuenta de prueba</Chip>}
            {fila.riesgos[0] && (
              <Chip tono={TONO_SEVERIDAD[fila.riesgos[0].riesgo.severidad]} sm title={`${fila.riesgos[0].clinicaNombre}: ${fila.riesgos[0].riesgo.detalle}`}>
                {fila.riesgos[0].riesgo.titulo}{fila.riesgos.length > 1 ? ` +${fila.riesgos.length - 1}` : ""}
              </Chip>
            )}
            {fila.enLinea && <span className="dcp-online" title={`Alguien en el panel en los últimos ${MINUTOS_EN_LINEA} minutos`} />}
          </div>
          <div className="dcp-datos">
            <span>{fila.email}</span>
            {fila.telefono && <span>{fila.telefono}</span>}
            <span>Alta <strong>{fechaAdmin(fila.altaAt) ?? "—"}</strong></span>
            <span>
              Último acceso{" "}
              {fila.ultimoAccesoAt
                ? <strong>{fechaHoraAdmin(fila.ultimoAccesoAt)}</strong>
                : <span title="Sin sesión registrada: la analítica de sesiones es reciente y no cubre a las clínicas antiguas">sin registro</span>}
            </span>
            {fila.afiliado && <span>Traído por <strong>{fila.afiliado}</strong></span>}
          </div>
          {soloComoUsuario && (
            <p className={css.aclaracion}>
              <strong>Esta cuenta no es dueña de ninguna clínica.</strong> Lo que se enseña abajo son las
              clínicas en las que tiene usuario, así que las cifras de dinero son las de esas clínicas y
              no las suyas. Suele pasar cuando el dueño se dio de baja y queda el personal.
            </p>
          )}
        </div>
        {/* Contacto: lo que ya estaba, donde estaba. */}
        <div className="dcp-acciones">
          <a href={`mailto:${fila.email}`}>
            <ButtonNew variant="secondary" icon={<Mail size={14} />}>Email</ButtonNew>
          </a>
          {waPhone && (
            <a href={`https://wa.me/${waPhone}`} target="_blank" rel="noreferrer">
              <ButtonNew variant="secondary" icon={<MessageCircle size={14} />}>WhatsApp</ButtonNew>
            </a>
          )}
        </div>
      </div>

      {/* ── Lo que hay que atender, antes que ninguna cifra ─────────────── */}
      <section className="dcp-card" aria-label="Lo que hay que atender de este cliente">
        <header className="dcp-card__head">
          <div>
            <h2 className="dcp-card__title">Atender</h2>
            <div className="dcp-card__sub">
              {fila.riesgos.length === 0
                ? "sin pendientes"
                : `${fila.riesgos.length} en ${new Set(fila.riesgos.map((r) => r.clinicaId)).size} de ${fila.vigentes.length} sedes · ${criticos} crítico${criticos === 1 ? "" : "s"}`}
            </div>
          </div>
        </header>
        {fila.riesgos.length === 0 ? (
          <Vacio>
            {fila.sinSedesVigentes
              ? "No le queda ninguna clínica vigente: todas están archivadas."
              : fila.esReal
                ? "Ninguna de sus clínicas está en riesgo ahora mismo."
                : "Es una cuenta de prueba: sin pacientes, sin citas y sin un solo pago."}
          </Vacio>
        ) : (
          <ul className="dcp-pend">
            {fila.riesgos.map((r, i) => (
              <li key={`${r.clinicaId}-${r.riesgo.clave}-${i}`}>
                <Link href={`/admin/clinics/${r.clinicaId}`} className="dcp-pend__fila" title={r.riesgo.detalle}>
                  <span className={`dcp-sev dcp-sev--${r.riesgo.severidad}`} aria-hidden />
                  <span className="dcp-pend__texto">
                    <span className="dcp-pend__clinica">{r.clinicaNombre}</span>
                    <Chip tono={TONO_SEVERIDAD[r.riesgo.severidad]} sm>{r.riesgo.titulo}</Chip>
                  </span>
                  <span className="dcp-pend__dato" style={{ whiteSpace: "normal", maxWidth: 360 }}>{r.riesgo.detalle}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── Pestañas ────────────────────────────────────────────────────── */}
      <div className="segment-new" style={{ display: "inline-flex", gap: 2, alignSelf: "flex-start" }}>
        <button type="button" onClick={() => setTab("resumen")} className={`segment-new__btn ${tab === "resumen" ? "segment-new__btn--active" : ""}`}>
          Resumen
        </button>
        <button type="button" onClick={() => setTab("facturacion")} className={`segment-new__btn ${tab === "facturacion" ? "segment-new__btn--active" : ""}`}>
          Facturación
          {cliente.pendingPaymentsCount > 0 && (
            <span style={{ marginLeft: 6, fontSize: 10, color: "var(--warning)", fontWeight: 700 }}>{cliente.pendingPaymentsCount}</span>
          )}
        </button>
      </div>

      {tab === "facturacion" && (
        <ClienteBilling
          cliente={cliente}
          mrr={fila.mrr}
          mrrModulos={fila.mrrModulos}
          modulosMedidos={modulosMedidos}
          planPrices={planPrices}
          ahora={ahora}
          stripeConfigured={stripeConfigured}
          stripeInstructions={stripeInstructions}
        />
      )}

      {tab === "resumen" && (
        <>
          {/* ── Resumen ────────────────────────────────────────────────── */}
          <div className="dcp-resumen">
            <DatoCaja label="MRR" n={formatCurrency(fila.mrrTotal, "MXN")} pie={pieMrr} />
            <DatoCaja
              label="Última compra"
              n={fila.ultimaCompraAt ? fechaAdmin(fila.ultimaCompraAt) ?? "—" : "—"}
              pie={fila.ultimaCompraAt
                ? `${ingresos.cobros} cobro${ingresos.cobros === 1 ? "" : "s"} · ${formatCurrency(ingresos.historico, "MXN")} desde el alta`
                : "sin un solo cobro registrado"}
            />
            <DatoCaja
              label="Próxima renovación"
              n={fila.proximaRenovacionAt ? fechaAdmin(fila.proximaRenovacionAt) ?? "—" : "—"}
              pie={pago ? pago.etiqueta : fila.vigentes.length > 1 ? "la más cercana de sus sedes" : "sin fecha"}
            />
            {/* Cobrado HOY, este MES y este AÑO con los cortes del calendario de Mérida. */}
            <DatoCaja label="Cobrado este mes" n={formatCurrency(ingresos.mes, "MXN")} pie={`hoy ${formatCurrency(ingresos.hoy, "MXN")} · año ${formatCurrency(ingresos.anio, "MXN")}`} />
            <DatoCaja label="Sedes" n={String(fila.vigentes.length)} pie={`${fila.resumen.porEstado.pagando} pagando${fila.archivadas.length > 0 ? ` · ${fila.archivadas.length} archivada${fila.archivadas.length === 1 ? "" : "s"}` : ""}`} />
            <DatoCaja
              label="Pacientes"
              n={formatPatientQuota(fila.cupo)}
              pie={fila.cupo.unlimited ? "alguna sede sin tope de plan" : `${(fila.cupo.remaining ?? 0).toLocaleString("es-MX")} de cupo libre`}
              nivel={nivelCupo === "full" ? "lleno" : nivelCupo === "warn" ? "aviso" : "ok"}
            />
            <DatoCaja label={`Trabajo · ${DIAS_VENTANA_ACTIVIDAD} d`} n={fila.tendencia.actual.total.toLocaleString("es-MX")} pie={`${fila.tendencia.actual.citas} citas · ${fila.tendencia.actual.facturas} facturas · ${fila.tendencia.actual.notas} notas`} />
            <DatoCaja label="LTV estimado" n={formatCurrency(ltv, "MXN")} pie="MRR × 24 meses" />
          </div>

          {/* ── Sedes ──────────────────────────────────────────────────── */}
          <div className="dcp-seccion">
            <h2 className="dcp-seccion__titulo">Clínicas del cliente</h2>
            <span className="dcp-seccion__nota">
              {fila.vigentes.length} vigente{fila.vigentes.length === 1 ? "" : "s"}
              {fila.archivadas.length > 0 && ` · ${fila.archivadas.length} archivada${fila.archivadas.length === 1 ? "" : "s"}`}
              {" · primero la que hay que atender"}
            </span>
          </div>
          <div className="dcp-sedes">
            {fila.clinicas.map((v) => (
              <TarjetaSede key={v.clinica.id} valorada={v} ahora={ahora} variasSedes={fila.vigentes.length > 1} />
            ))}
          </div>

          {/* ── Historia ───────────────────────────────────────────────── */}
          <div className={css.graficas}>
            <CardNew title="Ingresos de suscripción" sub="Últimos 12 meses (pagos cobrados, meses de Mérida)">
              <RevenueAreaChart data={ingresos.serie} />
            </CardNew>
            <CardNew title="Distribución de planes" sub="Clínicas por plan">
              {cliente.planDistribution.length > 0 ? (
                <PlanDonut data={cliente.planDistribution} />
              ) : (
                <div style={{ padding: 40, textAlign: "center", color: "var(--text-3)", fontSize: 13 }}>Sin datos</div>
              )}
            </CardNew>
          </div>

          <CardNew title="Actividad por clínica" sub={`Pacientes y citas ya ocurridas · ${fila.vigentes.length} sede${fila.vigentes.length === 1 ? "" : "s"} vigente${fila.vigentes.length === 1 ? "" : "s"}`}>
            <ActivityBars data={actividadPorSede} />
          </CardNew>
        </>
      )}
    </div>
  );
}

// ── La tarjeta de una sede ─────────────────────────────────────────────────

function TarjetaSede({ valorada, ahora, variasSedes }: { valorada: ClinicaValorada; ahora: Date; variasSedes: boolean }) {
  const { clinica, salud, mrrModulos } = valorada;
  // Lo que esta sede paga al mes: su plan + sus módulos.
  const mrr = Math.round((valorada.mrr + mrrModulos) * 100) / 100;
  const riesgo = salud.riesgos[0];
  const nivelCupo = patientQuotaLevel(clinica.cupo);
  const deltaPct = salud.actividad.tendencia.deltaPct;
  const u = clinica.uso;
  const pago = metodoDePago(clinica);
  const compra = ultimaCompra({ ultimoPagoAt: clinica.ultimoPagoAt, createdAt: clinica.createdAt });
  const gateDiscrepa = !(ESTADO_ESPERADO[salud.plan.kind] ?? []).includes(salud.estadoOperativo);

  const borde = clinica.archivada ? " dcp-sede--archivada" : riesgo && riesgo.severidad !== "medio" ? ` dcp-sede--${riesgo.severidad}` : "";

  return (
    <div className={`dcp-sede${borde}`}>
      <div className="dcp-sede__cabecera">
        <AvatarNew name={clinica.nombre} size="sm" />
        <div style={{ minWidth: 0, flex: 1 }}>
          <Link href={`/admin/clinics/${clinica.id}`} className="dcp-sede__nombre">{clinica.nombre}</Link>
          <div className="dcp-meta">/{clinica.slug} · alta {fechaAdmin(clinica.createdAt)}</div>
        </div>
        {salud.actividad.enLinea && <span className="dcp-online" title={`Sesión en el panel en los últimos ${MINUTOS_EN_LINEA} minutos`} />}
      </div>

      <div className="dcp-sede__chips">
        <Chip tono={clinica.plan === "CLINIC" ? "brand" : clinica.plan === "PRO" ? "info" : "neutral"}>{clinica.plan}</Chip>
        <Chip tono={TONO_ESTADO[salud.estadoOperativo] ?? "neutral"} punto>{ETIQUETA_ESTADO_OPERATIVO[salud.estadoOperativo]}</Chip>
        {/* El estado del PLAN tal como lo ve el gate, sólo cuando no dice lo mismo. */}
        {gateDiscrepa && <PlanStatusBadge clinic={clinica} now={ahora} />}
        <Chip tono="neutral" sm title={salud.actividad.diasSinCita === null ? "Nunca ha tenido una cita" : `Última cita hace ${salud.actividad.diasSinCita} días`}>
          {ETIQUETA_ACTIVIDAD[salud.actividad.nivel]}
        </Chip>
        {clinica.archivada && <Chip tono="neutral" sm><Archive size={10} aria-hidden /> Archivada</Chip>}
      </div>

      {riesgo && (
        <div className={`dcp-sede__riesgo${riesgo.severidad !== "medio" ? ` dcp-sede__riesgo--${riesgo.severidad}` : ""}`}>
          <span><strong>{riesgo.titulo}.</strong> {riesgo.detalle}{salud.riesgos.length > 1 && ` (+${salud.riesgos.length - 1} más)`}</span>
        </div>
      )}

      <div className="dcp-sede__metricas">
        <div>
          <div className="dcp-sede__metrica-label">Al mes</div>
          <div className="dcp-sede__metrica-n" title={mrrModulos > 0 ? desgloseMrr(valorada.mrr, mrrModulos) : undefined}>{mrr > 0 ? formatCurrency(mrr, "MXN") : <span className="dcp-suave">no cobra</span>}</div>
        </div>
        <div>
          <div className="dcp-sede__metrica-label">Última compra</div>
          <div className="dcp-sede__metrica-n" title={compra.esAlta ? "Nunca ha pagado: es la fecha de alta" : `${clinica.pagosRegistrados} pagos · ${formatCurrency(clinica.totalPagado, "MXN")}`}>
            {compra.fecha ? fechaAdmin(compra.fecha) : "—"}{compra.esAlta && <span className="dcp-suave"> · alta</span>}
          </div>
        </div>
        <div>
          <div className="dcp-sede__metrica-label">Renueva</div>
          <div className="dcp-sede__metrica-n">{clinica.nextBillingDate ? fechaAdmin(clinica.nextBillingDate) : "—"}</div>
          <div className="dcp-meta" title={pago.etiqueta}>{pago.etiqueta}</div>
        </div>
        <div>
          <div className="dcp-sede__metrica-label">Pacientes</div>
          <div className="dcp-sede__metrica-n" style={{ color: nivelCupo === "full" ? "var(--danger)" : nivelCupo === "warn" ? "var(--warning)" : undefined }}
            title={clinica.cupo.unlimited ? "Plan sin tope de pacientes" : `${clinica.plan} · ${clinica.cupo.remaining ?? 0} de cupo libre`}>
            {variasSedes ? formatPatientQuota(clinica.cupo) : clinica.cupo.used.toLocaleString("es-MX")}
          </div>
        </div>
        <div>
          <div className="dcp-sede__metrica-label">Trabajo · {DIAS_VENTANA_ACTIVIDAD} d</div>
          <div className="dcp-sede__metrica-n">
            {salud.actividad.volumen.total.toLocaleString("es-MX")}
            {deltaPct !== null && <span className="dcp-suave"> · {deltaPct > 0 ? "+" : ""}{deltaPct}%</span>}
          </div>
        </div>
        <div>
          <div className="dcp-sede__metrica-label">Último acceso</div>
          <div className="dcp-sede__metrica-n">
            {salud.actividad.enLinea ? "Ahora" : salud.actividad.ultimoAccesoAt ? fechaAdmin(salud.actividad.ultimoAccesoAt) : <span className="dcp-suave">sin registro</span>}
          </div>
        </div>
      </div>

      {u ? (
        <div className="dcp-sede__usos">
          <BarraUso label="Disco" usado={u.storageUsado} tope={u.storageTope} fmt={bytesCortos} compacta />
          {u.tokensTope > 0
            ? <BarraUso label="Tokens IA" usado={u.tokensUsados} tope={u.tokensTope} fmt={tokensCortos} compacta />
            : <span className="dcp-uso--sin">Tokens IA: sin cupo en el plan</span>}
          {u.cfdiUsados !== null && u.cfdiIncluidos > 0
            ? <BarraUso label="CFDI del mes" usado={u.cfdiUsados} tope={u.cfdiIncluidos} fmt={(n) => String(n)} compacta />
            : u.cfdiUsados !== null
              ? <span className="dcp-uso--sin">CFDI del mes: {u.cfdiUsados} · el plan no incluye timbres</span>
              : <span className="dcp-uso--sin">CFDI: sin dato</span>}
          {u.usuarios !== null
            ? <BarraUso label="Usuarios" usado={u.usuarios} tope={u.usuariosTope} fmt={(n) => String(n)} compacta />
            : <span className="dcp-uso--sin">Usuarios: sin dato</span>}
          <span className="dcp-uso__linea" style={{ gridColumn: "1 / -1" }}>
            <span className="dcp-uso__label">Saldo IA</span>
            <span className="dcp-num">
              {u.saldoIaCents === null
                ? <span className="dcp-suave">{u.saldoIaStatus === "SIN_DATO" ? "sin dato" : "sin monedero"}</span>
                : <strong style={{ color: u.saldoIaCents < 0 ? "var(--danger)" : undefined }}>{fmtMXNdec(u.saldoIaCents / 100)}</strong>}
              {u.sedes !== null && <span className="dcp-suave"> · {u.sedes}{u.sedesTope !== null ? `/${u.sedesTope}` : ""} sedes del dueño</span>}
            </span>
          </span>
        </div>
      ) : (
        <span className="dcp-uso--sin">Consumo sin medir.</span>
      )}

      {/* Los dos botones que ya estaban, con el mismo texto y el mismo destino. */}
      <div className="dcp-sede__botones">
        <Link href={`/admin/clinics/${clinica.id}`}>
          <ButtonNew size="sm" variant="secondary" icon={<Eye size={13} />}>Ver detalle</ButtonNew>
        </Link>
        {/* M5: POST con motivo obligatorio (antes un enlace GET). */}
        <BotonVerComoClinica clinicId={clinica.id} etiqueta="Impersonar" size="sm" />
      </div>
    </div>
  );
}
