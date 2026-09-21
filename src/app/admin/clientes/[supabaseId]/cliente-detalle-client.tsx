"use client";

/**
 * Ficha de un cliente — /admin/clientes/[supabaseId].
 *
 * Qué cambió: la ficha vieja abría con seis KPIs y un "Health 0-100", y las
 * tarjetas de clínica decían "Activa / En trial / Trial expirado" con una
 * tabla de estados propia. Eso escondía lo mismo que la lista: una sede
 * apagada o con el trial caducado se veía igual de verde que una sana.
 *
 * Ahora abre con lo que hay que atender, sede por sede, y el veredicto sale de
 * `evaluarSaludClinica` (@/lib/admin/salud-clinica) y de `../cartera` — no de
 * una tabla de estados de esta pantalla.
 *
 * REDISEÑO DE LECTURA: aquí no se escribe nada. Los botones que mueven dinero
 * viven, como vivían, en la pestaña Facturación (./cliente-billing), con el
 * mismo texto y el mismo endpoint.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft, Mail, MessageCircle, Eye, CheckCircle2, AlertOctagon, AlertTriangle,
  Info, Flame, Snowflake, PowerOff, Sprout, CircleSlash, Archive,
  TrendingUp, TrendingDown, Minus,
} from "lucide-react";
import { CardNew } from "@/components/ui/design-system/card-new";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { BadgeNew } from "@/components/ui/design-system/badge-new";
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
import type { ClienteDetalle } from "@/lib/admin/clientes";

import {
  valorarCliente,
  ETIQUETA_ESTADO_CLIENTE,
  type ClienteCrudo,
  type ClinicaValorada,
  type EstadoCliente,
  type IngresosCliente,
} from "../cartera";
import { PlanDonut, ActivityBars } from "./cliente-charts";
import { ClienteBilling } from "./cliente-billing";
import css from "./ficha.module.css";

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
const CLASE_BORDE: Record<Severidad, string> = {
  critico: css.sedeCritica,
  alto:    css.sedeAlta,
  medio:   "",
};

const ACTIVIDAD: Record<NivelActividad, { etiqueta: string; icono: typeof Flame }> = {
  "activa":       { etiqueta: "Activa",       icono: Flame },
  "nueva":        { etiqueta: "Nueva",        icono: Sprout },
  "enfriandose":  { etiqueta: "Enfriándose",  icono: Snowflake },
  "apagada":      { etiqueta: "Apagada",      icono: PowerOff },
  "sin-estrenar": { etiqueta: "Sin estrenar", icono: CircleSlash },
};

const TONO_ESTADO_CLIENTE: Record<EstadoCliente, "success" | "warning" | "danger" | "info" | "neutral"> = {
  "pagando":   "success",
  "mixto":     "warning",
  "en-trial":  "info",
  "sin-cobro": "danger",
  "prueba":    "neutral",
};

const ICONO_TENDENCIA = { sube: TrendingUp, baja: TrendingDown, igual: Minus } as const;
const CLASE_TENDENCIA: Record<string, string> = {
  sube:  css.tendenciaSube,
  baja:  css.tendenciaBaja,
  igual: css.tendenciaIgual,
};

export function ClienteDetalleClient({
  cliente,
  cartera,
  planPrices,
  ahoraISO,
  ingresos,
  soloComoUsuario,
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
  stripeConfigured: boolean;
  stripeInstructions: string;
}) {
  const [tab, setTab] = useState<"resumen" | "facturacion">("resumen");

  const ahora = useMemo(() => new Date(ahoraISO), [ahoraISO]);
  const fila = useMemo(() => valorarCliente(cartera, planPrices, ahora), [cartera, planPrices, ahora]);

  const actividadPorSede = useMemo(
    () => fila.vigentes.map((v) => ({
      name: v.clinica.nombre,
      pacientes: v.clinica.cupo.used,
      citas: v.clinica.citasPasadas,
    })),
    [fila.vigentes],
  );

  const waPhone = cliente.ownerPhone ? cliente.ownerPhone.replace(/[^\d]/g, "") : "";
  const criticos = fila.riesgos.filter((r) => r.riesgo.severidad === "critico").length;
  const claseBandeja = criticos > 0
    ? css.bandejaCritica
    : fila.riesgos.length > 0 ? css.bandejaAlta : "";

  // LTV estimado: el MRR de HOY por 24 meses. Es una estimación, y se dice.
  const ltv = fila.mrr.total * 24;
  const nivelCupo = patientQuotaLevel(fila.cupo);

  return (
    <div className={css.pagina}>
      {/* ── Cabecera ────────────────────────────────────────────────────── */}
      <div className={css.cabecera}>
        <Link href="/admin/clientes" className={css.volver} aria-label="Volver a clientes">
          <ArrowLeft size={14} />
        </Link>
        <AvatarNew name={fila.nombre} size="xl" />

        <div className={css.identidad}>
          <div className={css.insignias}>
            <h1 className={css.nombre}>{fila.nombre}</h1>
            {!fila.sinSedesVigentes && (
              <BadgeNew tone={TONO_ESTADO_CLIENTE[fila.estado]} dot>
                {ETIQUETA_ESTADO_CLIENTE[fila.estado]}
              </BadgeNew>
            )}
            {/* "Sin sedes vigentes" y "cuenta de prueba" son cosas distintas:
                un cliente que pagó un año y archivó su clínica también se queda
                sin sedes, y llamarle prueba sería mentir sobre su historia. */}
            {fila.sinSedesVigentes
              ? <BadgeNew tone="neutral">Sin sedes vigentes</BadgeNew>
              : !fila.esReal && <BadgeNew tone="neutral">Cuenta de prueba</BadgeNew>}
            {fila.enLinea && (
              <span className={css.enLinea} title={`Alguien en el panel en los últimos ${MINUTOS_EN_LINEA} minutos`}>
                <span className={css.enLineaPunto} aria-hidden="true" />
                en línea
              </span>
            )}
          </div>

          <div className={css.datos}>
            <span className={css.dato}>{fila.email}</span>
            {fila.telefono && <span className={css.dato}>{fila.telefono}</span>}
            <span className={css.dato}>
              Alta <strong>{fechaAdmin(fila.altaAt) ?? "—"}</strong>
            </span>
            <span className={css.dato}>
              Último acceso{" "}
              {fila.ultimoAccesoAt
                ? <strong>{fechaHoraAdmin(fila.ultimoAccesoAt)}</strong>
                : <span className={css.sinDato}>sin registro</span>}
            </span>
            {fila.afiliado && <span className={css.dato}>Traído por <strong>{fila.afiliado}</strong></span>}
          </div>

          {soloComoUsuario && (
            <p className={css.aclaracion}>
              <strong>Esta cuenta no es dueña de ninguna clínica.</strong> Lo que se
              enseña abajo son las clínicas en las que tiene usuario, así que las cifras
              de dinero son las de esas clínicas y no las suyas. Suele pasar cuando el
              dueño se dio de baja y queda el personal.
            </p>
          )}

          {!fila.ultimoAccesoAt && (
            <p className={css.aclaracion}>
              «Sin registro» no quiere decir que nadie haya entrado: el acceso sale de la
              analítica de sesiones del panel, que es reciente y no cubre a las clínicas
              antiguas.
            </p>
          )}
        </div>

        {/* Contacto: lo que ya estaba, donde estaba. */}
        <div className={css.acciones}>
          <a href={`mailto:${fila.email}`} style={{ textDecoration: "none" }}>
            <ButtonNew variant="secondary" icon={<Mail size={14} />}>Email</ButtonNew>
          </a>
          {waPhone && (
            <a href={`https://wa.me/${waPhone}`} target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}>
              <ButtonNew variant="secondary" icon={<MessageCircle size={14} />}>WhatsApp</ButtonNew>
            </a>
          )}
        </div>
      </div>

      {/* ── Lo que hay que atender, antes que ninguna cifra ─────────────── */}
      <section className={`${css.bandeja} ${claseBandeja}`} aria-label="Lo que hay que atender de este cliente">
        <div className={css.bandejaCabecera}>
          <h2 className={css.bandejaTitulo}>Atender</h2>
          <span className={css.bandejaCuenta}>
            {fila.riesgos.length === 0
              ? "sin pendientes"
              : `${fila.riesgos.length} en ${new Set(fila.riesgos.map((r) => r.clinicaId)).size} de ${fila.vigentes.length} sedes`}
          </span>
        </div>

        {fila.riesgos.length === 0 ? (
          <p className={css.bandejaVacia}>
            <CheckCircle2 size={15} style={{ color: "var(--success)" }} />
            {fila.sinSedesVigentes
              ? "No le queda ninguna clínica vigente: todas están archivadas."
              : fila.esReal
                ? "Ninguna de sus clínicas está en riesgo ahora mismo."
                : "Es una cuenta de prueba: sin pacientes, sin citas y sin un solo pago."}
          </p>
        ) : (
          fila.riesgos.map((r, i) => {
            const Icono = ICONO_SEVERIDAD[r.riesgo.severidad];
            return (
              <div key={`${r.clinicaId}-${r.riesgo.clave}-${i}`} className={css.aviso}>
                <span className={`${css.marca} ${css.avisoMarca} ${CLASE_MARCA[r.riesgo.severidad]}`} aria-hidden="true">
                  <Icono size={15} strokeWidth={2} />
                </span>
                <Link href={`/admin/clinics/${r.clinicaId}`} className={css.avisoSede}>
                  {r.clinicaNombre}
                </Link>
                <span className={css.avisoTexto}>
                  <strong>{r.riesgo.titulo}.</strong> {r.riesgo.detalle}
                </span>
              </div>
            );
          })
        )}
      </section>

      {/* ── Pestañas ────────────────────────────────────────────────────── */}
      <div className="segment-new" style={{ display: "inline-flex", gap: 2 }}>
        <button
          type="button"
          onClick={() => setTab("resumen")}
          className={`segment-new__btn ${tab === "resumen" ? "segment-new__btn--active" : ""}`}
        >
          Resumen
        </button>
        <button
          type="button"
          onClick={() => setTab("facturacion")}
          className={`segment-new__btn ${tab === "facturacion" ? "segment-new__btn--active" : ""}`}
        >
          Facturación
          {cliente.pendingPaymentsCount > 0 && (
            <span style={{ marginLeft: 6, fontSize: 10, color: "var(--warning)", fontWeight: 700 }}>
              {cliente.pendingPaymentsCount}
            </span>
          )}
        </button>
      </div>

      {tab === "facturacion" && (
        <ClienteBilling
          cliente={cliente}
          mrr={fila.mrr}
          planPrices={planPrices}
          ahora={ahora}
          stripeConfigured={stripeConfigured}
          stripeInstructions={stripeInstructions}
        />
      )}

      {tab === "resumen" && (
        <>
          {/* ── Cifras ─────────────────────────────────────────────────── */}
          <div className={css.cifras}>
            <div className={css.cifra}>
              <div className={css.cifraEtiqueta}>MRR</div>
              <div className={css.cifraValor}>{formatCurrency(fila.mrr.total, "MXN")}</div>
              <div className={css.cifraPie}>
                {fila.mrr.total > 0 ? mrrBreakdownHint(fila.mrr) : "no cobra nada al mes"}
              </div>
            </div>
            <div className={css.cifra}>
              <div className={css.cifraEtiqueta}>Sedes</div>
              <div className={css.cifraValor}>{fila.vigentes.length}</div>
              <div className={css.cifraPie}>
                {fila.resumen.porEstado.pagando} pagando
                {fila.archivadas.length > 0 && ` · ${fila.archivadas.length} archivada${fila.archivadas.length === 1 ? "" : "s"}`}
              </div>
            </div>
            {/* Cobrado HOY, este MES y este AÑO. Los cortes son los del
                calendario de Mérida (@/lib/admin/zona-horaria), no los del
                servidor: con el día del servidor, a partir de las 18:00 de
                Yucatán lo cobrado hoy ya se sumaba a mañana. */}
            <div className={css.cifra}>
              <div className={css.cifraEtiqueta}>Cobrado hoy</div>
              <div className={css.cifraValor}>{formatCurrency(ingresos.hoy, "MXN")}</div>
              <div className={css.cifraPie}>día de Mérida · {formatCurrency(ingresos.mes, "MXN")} este mes</div>
            </div>
            <div className={css.cifra}>
              <div className={css.cifraEtiqueta}>Cobrado este año</div>
              <div className={css.cifraValor}>{formatCurrency(ingresos.anio, "MXN")}</div>
              <div className={css.cifraPie}>
                {ingresos.cobros > 0
                  ? `${formatCurrency(ingresos.historico, "MXN")} desde el alta · ${ingresos.cobros} cobros`
                  : "sin un solo cobro registrado"}
              </div>
            </div>
            <div className={css.cifra}>
              <div className={css.cifraEtiqueta}>LTV estimado</div>
              <div className={css.cifraValor}>{formatCurrency(ltv, "MXN")}</div>
              <div className={css.cifraPie}>estimación: MRR × 24 meses</div>
            </div>
            <div className={`${css.cifra} ${nivelCupo === "full" ? css.cifraAlerta : nivelCupo === "warn" ? css.cifraAviso : ""}`}>
              <div className={css.cifraEtiqueta}>Pacientes</div>
              <div className={css.cifraValor}>{formatPatientQuota(fila.cupo)}</div>
              <div className={css.cifraPie}>
                {fila.cupo.unlimited
                  ? "alguna sede sin tope de plan"
                  : `${(fila.cupo.remaining ?? 0).toLocaleString("es-MX")} de cupo libre`}
              </div>
            </div>
            <div className={css.cifra}>
              <div className={css.cifraEtiqueta}>Trabajo · {DIAS_VENTANA_ACTIVIDAD} d</div>
              <div className={css.cifraValor}>{fila.tendencia.actual.total.toLocaleString("es-MX")}</div>
              <div className={css.cifraPie}>
                {fila.tendencia.actual.citas} citas · {fila.tendencia.actual.facturas} facturas · {fila.tendencia.actual.notas} notas
              </div>
            </div>
          </div>

          {/* ── Sedes ──────────────────────────────────────────────────── */}
          <div className={css.seccion}>
            <h2 className={css.seccionTitulo}>Clínicas del cliente</h2>
            <span className={css.seccionNota}>
              {fila.vigentes.length} vigente{fila.vigentes.length === 1 ? "" : "s"}
              {fila.archivadas.length > 0 && ` · ${fila.archivadas.length} archivada${fila.archivadas.length === 1 ? "" : "s"}`}
              {" · ordenadas por lo que hay que atender"}
            </span>
          </div>
          <div className={css.sedes}>
            {fila.clinicas.map((v) => (
              <TarjetaSede
                key={v.clinica.id}
                valorada={v}
                ahora={ahora}
                variasSedes={fila.vigentes.length > 1}
              />
            ))}
          </div>

          {/* ── Historia ───────────────────────────────────────────────── */}
          <div className={css.graficas}>
            {/* La serie se rehace en meses de MÉRIDA sobre los mismos cobros
                que las cifras de arriba: la de la capa vieja agrupaba por el
                mes del servidor, así que un cobro del 30 a las 19:00 de
                Yucatán caía en el mes siguiente. */}
            <CardNew title="Ingresos de suscripción" sub="Últimos 12 meses (pagos cobrados, meses de Mérida)">
              <RevenueAreaChart data={ingresos.serie} />
            </CardNew>
            <CardNew title="Distribución de planes" sub="Clínicas por plan">
              {cliente.planDistribution.length > 0 ? (
                <PlanDonut data={cliente.planDistribution} />
              ) : (
                <div style={{ padding: 40, textAlign: "center", color: "var(--text-3)", fontSize: 13 }}>
                  Sin datos
                </div>
              )}
            </CardNew>
          </div>

          {/* Las citas de la gráfica salen de las clínicas MEDIDAS, no de
              `cliente.activityPerClinic`: aquel contaba también las citas
              futuras, así que una sede con 20 agendadas por delante salía con
              900 en la lista y 920 aquí. Mismo número en las dos pantallas. */}
          <CardNew title="Actividad por clínica" sub={`Pacientes y citas ya ocurridas · ${fila.vigentes.length} sede${fila.vigentes.length === 1 ? "" : "s"} vigente${fila.vigentes.length === 1 ? "" : "s"}`}>
            <ActivityBars data={actividadPorSede} />
          </CardNew>
        </>
      )}
    </div>
  );
}

// ── La tarjeta de una sede ─────────────────────────────────────────────────

function TarjetaSede({
  valorada,
  ahora,
  variasSedes,
}: {
  valorada: ClinicaValorada;
  ahora: Date;
  variasSedes: boolean;
}) {
  const { clinica, salud, mrr } = valorada;
  const riesgo = salud.riesgos[0];
  const nivel = ACTIVIDAD[salud.actividad.nivel];
  const IconoNivel = nivel.icono;
  const nivelCupo = patientQuotaLevel(clinica.cupo);
  const Tendencia = ICONO_TENDENCIA[salud.actividad.tendencia.direccion];
  const deltaPct = salud.actividad.tendencia.deltaPct;

  const tokenPct = clinica.aiTokensLimit > 0
    ? Math.min(100, Math.round((clinica.aiTokensUsed / clinica.aiTokensLimit) * 100))
    : 0;

  const borde = clinica.archivada
    ? css.sedeArchivada
    : riesgo ? CLASE_BORDE[riesgo.severidad] : "";

  return (
    <div className={`${css.sede} ${borde}`}>
      <div className={css.sedeCabecera}>
        <AvatarNew name={clinica.nombre} size="sm" />
        <div style={{ minWidth: 0, flex: 1 }}>
          <Link href={`/admin/clinics/${clinica.id}`} className={css.sedeNombre}>
            {clinica.nombre}
          </Link>
          <div className={css.sedeSlug}>/{clinica.slug}</div>
        </div>
        {salud.actividad.enLinea && (
          <span className={css.enLinea} title={`Sesión en el panel en los últimos ${MINUTOS_EN_LINEA} minutos`}>
            <span className={css.enLineaPunto} aria-hidden="true" />
            en línea
          </span>
        )}
      </div>

      <div className={css.sedeInsignias}>
        <BadgeNew tone="neutral">{clinica.plan}</BadgeNew>
        {/* El estado del PLAN tal y como lo ve el gate: una sola lectura de
            plan-status, no una tabla de estados de esta pantalla. */}
        <PlanStatusBadge clinic={clinica} now={ahora} />
        {/* Y el estado COMERCIAL, que es otra pregunta: un trial caducado con
            acceso sigue siendo "al corriente" para el gate. */}
        <BadgeNew tone={salud.estadoOperativo === "pagando" ? "success" : salud.estadoOperativo === "prueba" ? "neutral" : "warning"}>
          {ETIQUETA_ESTADO_OPERATIVO[salud.estadoOperativo]}
        </BadgeNew>
        {clinica.archivada && (
          <BadgeNew tone="neutral">
            <Archive size={10} style={{ marginRight: 3 }} aria-hidden="true" />
            Archivada
          </BadgeNew>
        )}
      </div>

      {riesgo && (
        <div className={`${css.sedeRiesgo} ${CLASE_RIESGO[riesgo.severidad]}`}>
          <span aria-hidden="true" style={{ flexShrink: 0, marginTop: 1 }}>
            {(() => { const I = ICONO_SEVERIDAD[riesgo.severidad]; return <I size={14} />; })()}
          </span>
          <span>
            <strong>{riesgo.titulo}.</strong> {riesgo.detalle}
            {salud.riesgos.length > 1 && ` (+${salud.riesgos.length - 1} más)`}
          </span>
        </div>
      )}

      <div className={css.metricas}>
        <div>
          <div className={css.metricaEtiqueta}>Actividad</div>
          <div className={css.metricaValor} title={
            salud.actividad.diasSinCita === null
              ? "Nunca ha tenido una cita"
              : `Última cita hace ${salud.actividad.diasSinCita} días`
          }>
            <IconoNivel size={12} style={{ marginRight: 4 }} aria-hidden="true" />
            {nivel.etiqueta}
          </div>
        </div>
        <div>
          <div className={css.metricaEtiqueta}>Pacientes</div>
          <div className={`${css.metricaValor} ${nivelCupo === "full" ? css.metricaLleno : nivelCupo === "warn" ? css.metricaAviso : ""}`}
            title={clinica.cupo.unlimited
              ? "Plan sin tope de pacientes"
              : `${clinica.plan} · ${clinica.cupo.remaining ?? 0} de cupo libre`}>
            {variasSedes ? formatPatientQuota(clinica.cupo) : clinica.cupo.used.toLocaleString("es-MX")}
          </div>
        </div>
        <div>
          <div className={css.metricaEtiqueta}>Al mes</div>
          <div className={css.metricaValor}>
            {mrr > 0 ? `${formatCurrency(mrr, "MXN")}` : <span className={css.sinDato}>no cobra</span>}
          </div>
        </div>
      </div>

      <div className={css.metricas}>
        <div>
          <div className={css.metricaEtiqueta}>Trabajo · {DIAS_VENTANA_ACTIVIDAD} d</div>
          <div className={css.metricaValor}>
            {salud.actividad.volumen.total.toLocaleString("es-MX")}
            <span className={`${css.tendencia} ${CLASE_TENDENCIA[salud.actividad.tendencia.direccion]}`} style={{ marginLeft: 6 }}>
              <Tendencia size={12} aria-hidden="true" />
              {deltaPct === null ? "—" : `${deltaPct > 0 ? "+" : ""}${deltaPct}%`}
            </span>
          </div>
        </div>
        <div>
          <div className={css.metricaEtiqueta}>Próxima cita</div>
          <div className={css.metricaValor}>
            {salud.actividad.proximaCitaAt
              ? fechaAdmin(salud.actividad.proximaCitaAt)
              : <span className={css.sinDato}>ninguna</span>}
          </div>
        </div>
        <div>
          <div className={css.metricaEtiqueta}>Cobrado</div>
          <div className={css.metricaValor}>
            {formatCurrency(clinica.totalPagado, "MXN")}
          </div>
        </div>
      </div>

      <div>
        <div className={css.barraCabecera}>
          <span>Tokens IA</span>
          <span>{tokenPct}%</span>
        </div>
        <div className={css.barra}>
          <div
            className={`${css.barraRelleno} ${tokenPct >= 90 ? css.barraAlerta : tokenPct >= 70 ? css.barraAviso : css.barraOk}`}
            style={{ width: `${tokenPct}%` }}
          />
        </div>
      </div>

      {/* Los dos botones que ya estaban, con el mismo texto y el mismo destino. */}
      <div className={css.botones}>
        <Link href={`/admin/clinics/${clinica.id}`} className={css.boton}>
          <ButtonNew size="sm" variant="secondary" icon={<Eye size={13} />}>Ver detalle</ButtonNew>
        </Link>
        <a
          href={`/api/admin/impersonate?clinicId=${clinica.id}`}
          target="_blank"
          rel="noreferrer"
          className={css.boton}
        >
          <ButtonNew size="sm" variant="primary" icon={<Eye size={13} />}>Impersonar</ButtonNew>
        </a>
      </div>
    </div>
  );
}
