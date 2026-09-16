"use client";

import { useMemo } from "react";
import {
  Activity,
  CalendarDays,
  IdCard,
  ListChecks,
  Receipt,
  Wallet,
} from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { isVoidedInvoice } from "@/components/dashboard/billing/invoice-status";
import { useT } from "@/i18n/i18n-provider";
import { fechaCorta, fechaConAno, diasHasta } from "./fechas";
import s from "./rediseno.module.css";

/**
 * La portada de la ficha, rediseñada.
 *
 * Rafael pidió estas cinco tarjetas por su nombre y todas a la vista, sin
 * bajar: **información del paciente · cobros · citas · estado de cuenta ·
 * tratamiento activo**. Lo que había era una línea de tiempo enorme a la
 * izquierda, una caja de «Antecedentes» a la derecha y el dinero escondido en
 * una columna lateral.
 *
 * El rail derecho NO se monta en esta pantalla con el rediseño encendido: su
 * «Estado de cuenta» es una de las cinco tarjetas, y tenerlo dos veces en el
 * mismo alto era justo lo que hacía que la pantalla se sintiera llena de
 * ruido. Los movimientos (la línea de tiempo) siguen aquí, pero DEBAJO de las
 * cinco: quien abre la ficha viene a ver el estado del paciente, no su
 * historial completo — para eso está Historia clínica.
 */

export interface ResumenProps {
  patient: {
    phone?: string | null;
    email?: string | null;
    bloodType?: string | null;
    insuranceProvider?: string | null;
    notes?: string | null;
    emergencyContactName?: string | null;
    emergencyContactPhone?: string | null;
    emergencyContactRelation?: string | null;
    source?: string | null;
  };
  finanzas: { total: number; pagado: number; saldo: number; credito: number };
  citas: any[];
  facturas: any[];
  tratamientos: any[];
  /** Consultas firmadas del paciente — alimenta el contador de visitas. */
  canViewBilling: boolean;
  canEditPatient: boolean;
  onCobrar: () => void;
  onAgendar: () => void;
  onEditar: () => void;
  onIrA: (tab: string) => void;
  /** La línea de tiempo y la tira de fotos, que ya existen y no se rehacen. */
  movimientos: React.ReactNode;
}

/** Estados de cita, los NUEVE que existen (la ficha vieja conoce cinco y
 *  pinta los otros cuatro como «Pendiente», en amarillo). */
const ESTADO_CITA: Record<string, { key: string; tono: string }> = {
  PENDING: { key: "pacientesRediseno.cita.pendiente", tono: "etiquetaAlerta" },
  SCHEDULED: { key: "pacientesRediseno.cita.agendada", tono: "etiquetaVioleta" },
  CONFIRMED: { key: "pacientesRediseno.cita.confirmada", tono: "etiquetaExito" },
  CHECKED_IN: { key: "pacientesRediseno.cita.registrado", tono: "etiquetaVioleta" },
  IN_CHAIR: { key: "pacientesRediseno.cita.enSillon", tono: "etiquetaVioleta" },
  IN_PROGRESS: { key: "pacientesRediseno.cita.enConsulta", tono: "etiquetaVioleta" },
  COMPLETED: { key: "pacientesRediseno.cita.completada", tono: "etiquetaNeutra" },
  CHECKED_OUT: { key: "pacientesRediseno.cita.salio", tono: "etiquetaNeutra" },
  CANCELLED: { key: "pacientesRediseno.cita.cancelada", tono: "etiquetaPeligro" },
  NO_SHOW: { key: "pacientesRediseno.cita.noAsistio", tono: "etiquetaNeutra" },
};

const CANCELADAS = ["CANCELLED", "NO_SHOW"];

function Tarjeta({
  icono: Icono,
  tonoIcono,
  titulo,
  enlace,
  children,
}: {
  icono: typeof Wallet;
  tonoIcono?: string;
  titulo: string;
  enlace?: { texto: string; onClick: () => void };
  children: React.ReactNode;
}) {
  return (
    <section className={s.tarjeta}>
      <header className={s.tarjetaCabeza}>
        <span className={[s.tarjetaIcono, tonoIcono ?? ""].filter(Boolean).join(" ")}>
          <Icono size={15} strokeWidth={1.75} aria-hidden />
        </span>
        <h2 className={s.tarjetaTitulo}>{titulo}</h2>
        {enlace && (
          <button type="button" className={s.tarjetaEnlace} onClick={enlace.onClick}>
            {enlace.texto}
          </button>
        )}
      </header>
      <div className={s.tarjetaCuerpo}>{children}</div>
    </section>
  );
}

function Vacio({ icono: Icono, titulo, pista }: { icono: typeof Wallet; titulo: string; pista?: string }) {
  return (
    <div className={s.vacio}>
      <span className={s.vacioIcono}>
        <Icono size={17} strokeWidth={1.75} aria-hidden />
      </span>
      <span className={s.vacioTitulo}>{titulo}</span>
      {pista && <span className={s.vacioPista}>{pista}</span>}
    </div>
  );
}

export function Resumen({
  patient,
  finanzas,
  citas,
  facturas,
  tratamientos,
  canViewBilling,
  canEditPatient,
  onCobrar,
  onAgendar,
  onEditar,
  onIrA,
  movimientos,
}: ResumenProps) {
  const t = useT();

  // La ficha recibe las citas de la MÁS LEJANA a la más vieja (el server las
  // pide `startsAt: desc`). Buscar «la próxima» sobre esa lista sin ordenarla
  // devolvía la cita más lejana en el tiempo: con una cita el 20-oct y otra el
  // 30-nov, la tarjeta marcaba como próxima la de noviembre.
  //
  // Se ordena por `startsAt`, que trae la HORA, y no por el día: con dos citas
  // el mismo día (09:00 y 17:00) ordenar por días las deja empatadas, y como
  // `sort` es estable el empate conservaba el orden de llegada — o sea, la de
  // las 17:00 salía como «la próxima» y la de las 09:00 no salía en ninguna
  // parte. Ese es justo el día que peor puede salir: el que tiene dos citas.
  const instante = (c: any): number => {
    const t = new Date(c.startsAt ?? c.date).getTime();
    return isNaN(t) ? 0 : t;
  };

  const futuras = useMemo(
    () =>
      citas
        .filter((c) => {
          const d = diasHasta(c.date);
          return d !== null && d >= 0 && CANCELADAS.indexOf(c.status) === -1;
        })
        .slice()
        .sort((a, b) => instante(a) - instante(b)),
    [citas],
  );

  const proxima = futuras[0] ?? null;

  // Las demás citas futuras (las de hoy más tarde, la de la semana que viene)
  // se siguen pintando: antes solo se enseñaba la primera y el resto se perdía.
  const otrasFuturas = useMemo(() => futuras.slice(1, 3), [futuras]);

  const anteriores = useMemo(
    () =>
      citas
        .filter((c) => {
          const d = diasHasta(c.date);
          return d !== null && d < 0;
        })
        .slice()
        .sort((a, b) => instante(b) - instante(a))
        .slice(0, 3),
    [citas],
  );

  // Progreso REAL del plan: sesiones con fecha de realizado, no sesiones
  // creadas. Contando las creadas, un plan de 18 con 4 hechas dice «18/18».
  const plan = useMemo(() => {
    const activo = tratamientos.find((p: any) => p.status === "ACTIVE") ?? null;
    if (!activo) return null;
    const sesiones: any[] = Array.isArray(activo.sessions) ? activo.sessions : [];
    const hechas = sesiones.filter((x) => !!x.completedAt).length;
    const total = activo.totalSessions ?? sesiones.length;
    return {
      nombre: activo.name as string,
      hechas,
      total,
      pct: total > 0 ? Math.min(100, Math.round((hechas / total) * 100)) : 0,
      proxima: activo.nextExpectedDate as string | null,
      // `totalCost`, que es como se llama la columna. Con `cost` (que no
      // existe) la fila del costo no se pintaba nunca, y `any[]` hacía que
      // `tsc` no dijera nada.
      costo: typeof activo.totalCost === "number" ? activo.totalCost : null,
    };
  }, [tratamientos]);

  const cobros = useMemo(
    () =>
      (facturas || [])
        // Las CANCELADAS fuera, igual que en los totales de la ficha: cancelar
        // NO pone el saldo a cero, así que una factura anulada de $5,000 se
        // pintaba «Pendiente» al lado de un «Estado de cuenta» que decía «sin
        // saldo». Es el mismo defecto que ya costó una vez (MF-0151).
        .filter((inv: any) => !isVoidedInvoice(inv))
        .slice()
        // Por TIEMPO, no por texto: `createdAt` llega como Date y compararlo
        // en cadena ordenaba por el nombre del día de la semana («Fri» antes
        // que «Mon»), así que los «últimos tres» eran tres cualesquiera.
        .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, 3),
    [facturas],
  );

  const pct = finanzas.total > 0 ? Math.round((finanzas.pagado / finanzas.total) * 100) : 0;
  const emergencia = [
    patient.emergencyContactName,
    patient.emergencyContactPhone,
    patient.emergencyContactRelation,
  ]
    .filter(Boolean)
    .join(" · ");

  const filaCita = (c: any, esProxima: boolean) => {
    const estado = ESTADO_CITA[c.status] ?? ESTADO_CITA.PENDING;
    const doctor = c.doctor ? `${t("patients.doctorPrefix")} ${c.doctor.firstName}` : null;
    return (
      <div
        key={c.id}
        className={[s.listaFila, esProxima ? s.listaFilaProxima : ""].filter(Boolean).join(" ")}
      >
        <span
          className={[s.listaPunto, esProxima ? s.listaPuntoProxima : ""].filter(Boolean).join(" ")}
          aria-hidden
        />
        <span className={s.listaCuerpo}>
          <span className={s.listaTitulo}>
            {fechaConAno(c.date)}
            {c.startTime ? ` · ${c.startTime}` : ""}
          </span>
          <span className={s.listaSub}>
            {[c.type, doctor].filter(Boolean).join(" · ") || "—"}
          </span>
        </span>
        <span className={[s.etiqueta, (s as any)[estado.tono]].filter(Boolean).join(" ")}>
          {t(estado.key)}
        </span>
      </div>
    );
  };

  return (
    <div className={s.columna}>
      <div className={s.rejilla3}>
        {/* ── 1. Información del paciente ─────────────────────────── */}
        <Tarjeta
          icono={IdCard}
          titulo={t("pacientesRediseno.resumen.informacion")}
          enlace={canEditPatient ? { texto: t("common.edit"), onClick: onEditar } : undefined}
        >
          <div className={s.filas}>
            <div className={s.fila}>
              <span className={s.filaEtiqueta}>{t("pacientesRediseno.resumen.telefono")}</span>
              <span className={s.filaValor}>{patient.phone || "—"}</span>
            </div>
            <div className={s.fila}>
              <span className={s.filaEtiqueta}>{t("pacientesRediseno.resumen.correo")}</span>
              <span className={s.filaValor}>{patient.email || "—"}</span>
            </div>
            <div className={s.fila}>
              <span className={s.filaEtiqueta}>{t("patients.summary.bloodType")}</span>
              <span className={s.filaValor}>
                {patient.bloodType || (
                  <span className={s.filaValorApagado}>{t("patients.summary.notRegistered")}</span>
                )}
              </span>
            </div>
            <div className={s.fila}>
              <span className={s.filaEtiqueta}>{t("patients.summary.insurance")}</span>
              <span className={s.filaValor}>
                {patient.insuranceProvider || (
                  <span className={s.filaValorApagado}>{t("patients.summary.noInsurance")}</span>
                )}
              </span>
            </div>
            <div className={s.fila}>
              <span className={s.filaEtiqueta}>{t("patients.summary.emergencyContact")}</span>
              <span className={s.filaValor}>
                {emergencia || <span className={s.filaValorApagado}>—</span>}
              </span>
            </div>
            {patient.notes ? (
              <div className={s.fila}>
                <span className={s.filaEtiqueta}>{t("common.notes")}</span>
                <span className={s.filaValor}>{patient.notes}</span>
              </div>
            ) : null}
          </div>
        </Tarjeta>

        {/* ── 2. Estado de cuenta ─────────────────────────────────── */}
        <Tarjeta
          icono={Wallet}
          tonoIcono={finanzas.saldo > 0 ? s.tarjetaIconoPeligro : s.tarjetaIconoExito}
          titulo={t("pacientesRediseno.resumen.estadoCuenta")}
          enlace={
            canViewBilling
              ? { texto: t("pacientesRediseno.resumen.verFacturacion"), onClick: () => onIrA("facturacion") }
              : undefined
          }
        >
          {canViewBilling ? (
            <>
              <div
                className={[
                  s.importeGrande,
                  finanzas.saldo > 0 ? s.importeDeuda : s.importePagado,
                ].join(" ")}
              >
                {formatCurrency(finanzas.saldo)}
              </div>
              <div className={s.pie} style={{ marginTop: 3 }}>
                <span>
                  {finanzas.saldo > 0
                    ? t("pacientesRediseno.resumen.saldoPendiente")
                    : t("pacientesRediseno.resumen.sinSaldo")}
                </span>
              </div>
              <div className={s.barra} aria-hidden>
                <div
                  className={[s.barraRelleno, finanzas.saldo > 0 ? "" : s.barraRellenoExito]
                    .filter(Boolean)
                    .join(" ")}
                  style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
                />
              </div>
              <div className={s.pie}>
                <span>
                  {t("pacientesRediseno.resumen.pagadoDeTotal", {
                    pagado: formatCurrency(finanzas.pagado),
                    total: formatCurrency(finanzas.total),
                  })}
                </span>
                <span className={s.importe}>{pct}%</span>
              </div>
              {finanzas.credito > 0 && (
                <div className={s.pie} style={{ marginTop: 6 }}>
                  <span>{t("pacientesRediseno.resumen.saldoAFavor")}</span>
                  <span className={`${s.importe} ${s.importePagado}`}>
                    {formatCurrency(finanzas.credito)}
                  </span>
                </div>
              )}
              {/* Sin botón de cobro aquí, a propósito: «Cobrar $X» ya está en
                  la cabecera, en verde y en su sitio de siempre — el tercero de
                  los tres botones que no se tocan. Repetirlo a dos centímetros
                  hacía dudar de si eran dos cobros distintos. Esta tarjeta
                  cuenta el estado; la acción vive donde la gente la busca. */}
            </>
          ) : (
            <Vacio
              icono={Wallet}
              titulo={t("pacientesRediseno.resumen.sinPermisoDinero")}
            />
          )}
        </Tarjeta>

        {/* ── 3. Tratamiento activo ───────────────────────────────── */}
        <Tarjeta
          icono={ListChecks}
          titulo={t("pacientesRediseno.resumen.tratamientoActivo")}
          enlace={{ texto: t("pacientesRediseno.resumen.verPlan"), onClick: () => onIrA("tratamiento") }}
        >
          {plan ? (
            <>
              <div className={s.filaValor} style={{ textAlign: "left", fontSize: 15, marginBottom: 2 }}>
                {plan.nombre}
              </div>
              <div className={s.pie}>
                <span>
                  {t("pacientesRediseno.resumen.sesionesHechas", {
                    hechas: plan.hechas,
                    total: plan.total,
                  })}
                </span>
                <span className={s.importe}>{plan.pct}%</span>
              </div>
              <div className={s.barra} aria-hidden>
                <div className={s.barraRelleno} style={{ width: `${plan.pct}%` }} />
              </div>
              <div className={s.filas} style={{ marginTop: 8 }}>
                <div className={s.fila}>
                  <span className={s.filaEtiqueta}>{t("pacientesRediseno.resumen.proximaSesion")}</span>
                  <span className={s.filaValor}>
                    {plan.proxima ? fechaConAno(plan.proxima) : "—"}
                  </span>
                </div>
                {plan.costo !== null && (
                  <div className={s.fila}>
                    <span className={s.filaEtiqueta}>{t("pacientesRediseno.resumen.costoPlan")}</span>
                    <span className={`${s.filaValor} ${s.importe}`}>{formatCurrency(plan.costo)}</span>
                  </div>
                )}
              </div>
            </>
          ) : (
            <Vacio
              icono={ListChecks}
              titulo={t("pacientesRediseno.resumen.sinTratamiento")}
              pista={t("pacientesRediseno.resumen.sinTratamientoPista")}
            />
          )}
        </Tarjeta>
      </div>

      <div className={s.rejilla2}>
        {/* ── 4. Citas ────────────────────────────────────────────── */}
        <Tarjeta
          icono={CalendarDays}
          titulo={t("pacientesRediseno.resumen.citas")}
          enlace={{ texto: t("pacientesRediseno.resumen.verTodas"), onClick: () => onIrA("agenda") }}
        >
          {proxima || anteriores.length > 0 ? (
            <div className={s.lista}>
              {proxima && filaCita(proxima, true)}
              {otrasFuturas.map((c) => filaCita(c, false))}
              {anteriores.slice(0, Math.max(1, 3 - otrasFuturas.length)).map((c) => filaCita(c, false))}
            </div>
          ) : (
            <Vacio icono={CalendarDays} titulo={t("pacientesRediseno.resumen.sinCitas")} />
          )}
          <button
            type="button"
            className={s.boton}
            style={{ marginTop: 12, alignSelf: "flex-start" }}
            onClick={onAgendar}
          >
            <CalendarDays size={14} strokeWidth={1.75} aria-hidden />
            {proxima
              ? t("pacientesRediseno.resumen.reagendar")
              : t("pacientesRediseno.resumen.agendar")}
          </button>
        </Tarjeta>

        {/* ── 5. Cobros ───────────────────────────────────────────── */}
        <Tarjeta
          icono={Receipt}
          titulo={t("pacientesRediseno.resumen.cobros")}
          enlace={
            canViewBilling
              ? { texto: t("pacientesRediseno.resumen.verFacturacion"), onClick: () => onIrA("facturacion") }
              : undefined
          }
        >
          {!canViewBilling ? (
            <Vacio icono={Receipt} titulo={t("pacientesRediseno.resumen.sinPermisoDinero")} />
          ) : cobros.length > 0 ? (
            <div className={s.lista}>
              {cobros.map((inv: any) => {
                const pagada = (inv.balance ?? 0) <= 0;
                return (
                  <div key={inv.id} className={s.listaFila}>
                    <span
                      className={`${s.listaPunto} ${pagada ? s.listaPuntoExito : s.listaPuntoDeuda}`}
                      aria-hidden
                    />
                    <span className={s.listaCuerpo}>
                      <span className={s.listaTitulo}>{inv.invoiceNumber}</span>
                      <span className={s.listaSub}>{fechaCorta(inv.createdAt)}</span>
                    </span>
                    <span className={`${s.listaDerecha} ${s.importe}`}>
                      {formatCurrency(inv.total ?? 0)}
                      <span
                        className={`${s.etiqueta} ${pagada ? s.etiquetaExito : s.etiquetaAlerta}`}
                        style={{ marginLeft: 8 }}
                      >
                        {pagada
                          ? t("pacientesRediseno.resumen.pagada")
                          : t("pacientesRediseno.resumen.pendiente")}
                      </span>
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <Vacio icono={Receipt} titulo={t("pacientesRediseno.resumen.sinCobros")} />
          )}
        </Tarjeta>
      </div>

      {/* Los movimientos del paciente — debajo de las cinco tarjetas. */}
      <Tarjeta
        icono={Activity}
        titulo={t("pacientesRediseno.resumen.movimientos")}
        enlace={{ texto: t("pacientesRediseno.resumen.verHistoria"), onClick: () => onIrA("historia") }}
      >
        {movimientos}
      </Tarjeta>
    </div>
  );
}
