"use client";
/**
 * "Salud de la cuenta" — el bloque de la ficha que junta en UN sitio lo que
 * antes había que ir a buscar a cuatro tabs: su actividad, su gente, su dinero
 * y sus avisos.
 *
 * Es de LECTURA. No dispara ninguna acción ni escribe nada: los botones que
 * cambian cosas (activar plan, +N días, suspender) siguen donde estaban, en
 * "Gestión de plan".
 *
 * El veredicto NO se calcula aquí: sale entero de @/lib/admin/salud-clinica,
 * el mismo que usan la lista de clínicas y el dashboard.
 */
import {
  AlertOctagon, AlertTriangle, Info, CheckCircle2,
  Flame, Snowflake, PowerOff, Sprout, CircleSlash, Upload, CalendarClock,
  TrendingUp, TrendingDown, Minus, WifiOff,
} from "lucide-react";
import { CardNew } from "@/components/ui/design-system/card-new";
import { fmtMXN } from "@/lib/format";
import { fechaAdmin, fechaHoraAdmin } from "@/lib/admin/zona-horaria";
import {
  DIAS_VENTANA_ACTIVIDAD,
  MINUTOS_EN_LINEA,
  ETIQUETA_ESTADO_OPERATIVO,
  type SaludClinica,
  type Severidad,
  type NivelActividad,
} from "@/lib/admin/salud-clinica";
import css from "./ficha.module.css";

const ICONO_SEVERIDAD: Record<Severidad, typeof AlertOctagon> = {
  critico: AlertOctagon,
  alto:    AlertTriangle,
  medio:   Info,
};

const CLASE_RIESGO: Record<Severidad, string> = {
  critico: css.riesgoCritico,
  alto:    css.riesgoAlto,
  medio:   css.riesgoMedio,
};

const CLASE_BANDA: Record<Severidad, string> = {
  critico: css.bandaCritico,
  alto:    css.bandaAlto,
  medio:   css.bandaMedio,
};

const CLASE_BANDA_ICONO: Record<Severidad, string> = {
  critico: css.bandaIconoCritico,
  alto:    css.bandaIconoAlto,
  medio:   css.bandaIconoMedio,
};

const ACTIVIDAD: Record<NivelActividad, { etiqueta: string; icono: typeof Flame }> = {
  "activa":       { etiqueta: "Activa",       icono: Flame },
  "nueva":        { etiqueta: "Nueva",        icono: Sprout },
  "enfriandose":  { etiqueta: "Enfriándose",  icono: Snowflake },
  "apagada":      { etiqueta: "Apagada",      icono: PowerOff },
  "sin-estrenar": { etiqueta: "Sin estrenar", icono: CircleSlash },
};

const METODO: Record<string, string> = {
  stripe: "Stripe", transfer: "Transferencia", spei: "SPEI", deposit: "Depósito",
  oxxo: "OXXO", paypal: "PayPal", cash: "Efectivo", mercadopago: "MercadoPago",
};

/**
 * Fecha corta y legible EN LA ZONA DE MÉRIDA. Sin dato devuelve null y quien
 * pinta dice «sin dato»: no se inventa un guion cualquiera.
 */
const fecha = fechaAdmin;

function Dato({ etiqueta, valor }: { etiqueta: string; valor: string | null }) {
  return (
    <div className={css.dato}>
      <span className={css.datoEtiqueta}>{etiqueta}</span>
      <span className={`${css.datoValor} ${valor === null ? css.sinDato : ""}`}>
        {valor ?? "sin dato"}
      </span>
    </div>
  );
}

export interface SaludPanelProps {
  salud: SaludClinica;
  gente: {
    total: number;
    activos: number;
  };
  dinero: {
    /** Lo que esta clínica aporta al mes: el negociado si lo tiene. */
    mensual: number;
    /** true si `mensual` es un precio negociado y no el de lista del plan. */
    esNegociado: boolean;
    totalPagado: number;
    pagos: number;
    ultimoPagoAt: string | null;
    ultimoMetodo: string | null;
  };
}

const ICONO_TENDENCIA = { sube: TrendingUp, baja: TrendingDown, igual: Minus } as const;
const CLASE_TENDENCIA: Record<string, string> = {
  sube:  css.tendenciaSube,
  baja:  css.tendenciaBaja,
  igual: css.tendenciaIgual,
};

export function SaludPanel({ salud, gente, dinero }: SaludPanelProps) {
  const act = ACTIVIDAD[salud.actividad.nivel];
  const IconoAct = act.icono;
  const vol  = salud.actividad.volumen;
  const tend = salud.actividad.tendencia;
  const IconoTend = ICONO_TENDENCIA[tend.direccion];
  const principal = salud.riesgos[0] ?? null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Lo primero: si algo exige atención, se dice antes que ningún número. */}
      {principal ? (
        (() => {
          const Icono = ICONO_SEVERIDAD[principal.severidad];
          const otros = salud.riesgos.slice(1);
          return (
            <div className={`${css.banda} ${CLASE_BANDA[principal.severidad]}`} role="status">
              <Icono size={18} className={`${css.bandaIcono} ${CLASE_BANDA_ICONO[principal.severidad]}`} aria-hidden="true" />
              <div className={css.bandaTexto}>
                <p className={css.bandaTitulo}>{principal.titulo}</p>
                <p className={css.bandaDetalle}>{principal.detalle}</p>
                {otros.length > 0 && (
                  <p className={css.bandaExtra}>
                    También: {otros.map((r) => r.titulo).join(" · ")}
                  </p>
                )}
              </div>
            </div>
          );
        })()
      ) : (
        <div className={css.banda} role="status">
          <CheckCircle2 size={18} className={css.bandaIcono} style={{ color: "var(--success)" }} aria-hidden="true" />
          <div className={css.bandaTexto}>
            <p className={css.bandaTitulo}>
              {salud.esPrueba ? "Cuenta de prueba" : "Sin riesgos detectados"}
            </p>
            <p className={css.bandaDetalle}>
              {salud.esPrueba
                ? `${salud.motivoPrueba}. No cuenta en los totales de clientes.`
                : `Estado: ${ETIQUETA_ESTADO_OPERATIVO[salud.estadoOperativo]}.`}
            </p>
          </div>
        </div>
      )}

      <CardNew>
        <div className="form-section__title">
          Salud de la cuenta <span className="form-section__rule" />
        </div>

        <div className={css.rejilla}>
          {/* ── Su actividad ─────────────────────────────────────────── */}
          <section className={css.bloque}>
            <h3 className={css.bloqueTitulo}>Actividad</h3>
            <span className={css.nivel}>
              <IconoAct size={15} aria-hidden="true" />
              {act.etiqueta}
            </span>
            <Dato
              etiqueta="Última cita"
              valor={salud.actividad.diasSinCita === null
                ? null
                : `hace ${salud.actividad.diasSinCita} d`}
            />
            {/* CUÁNTO ha hecho en la ventana, no solo si hizo algo. */}
            <div className={css.volumen}>
              <span><strong>{vol.citas}</strong> citas</span>
              <span><strong>{vol.facturas}</strong> {vol.facturas === 1 ? "factura" : "facturas"}</span>
              <span><strong>{vol.notas}</strong> {vol.notas === 1 ? "nota" : "notas"}</span>
            </div>
            <div className={`${css.tendencia} ${CLASE_TENDENCIA[tend.direccion]}`}>
              <IconoTend size={12} aria-hidden="true" />
              {tend.deltaPct !== null
                ? `${tend.deltaPct > 0 ? "+" : ""}${tend.deltaPct}% vs. los ${DIAS_VENTANA_ACTIVIDAD} d anteriores`
                : tend.previo.total === 0 && vol.total > 0
                  ? `sin actividad en los ${DIAS_VENTANA_ACTIVIDAD} d anteriores`
                  : `sin actividad en ${DIAS_VENTANA_ACTIVIDAD * 2} d`}
            </div>
            <Dato etiqueta="Citas pasadas" valor={salud.actividad.citasPasadas.toLocaleString("es-MX")} />
            <Dato etiqueta="Próxima cita" valor={fecha(salud.actividad.proximaCitaAt)} />
          </section>

          {/* ── Su gente ─────────────────────────────────────────────── */}
          <section className={css.bloque}>
            <h3 className={css.bloqueTitulo}>Su gente</h3>
            <div>
              <div className={css.destacado}>{gente.activos}</div>
              <div className={css.destacadoPie}>
                usuarios activos de {gente.total}
              </div>
            </div>
            {salud.actividad.enLinea && (
              <span className={css.enLinea} title={`Sesión en el panel en los últimos ${MINUTOS_EN_LINEA} minutos`}>
                <span className={css.enLineaPunto} aria-hidden="true" />
                En línea ahora
              </span>
            )}
            <Dato
              etiqueta="Última sesión"
              valor={salud.actividad.diasSinAcceso !== null
                ? `hace ${salud.actividad.diasSinAcceso} d`
                : null}
            />
            <Dato etiqueta="Vista por última vez" valor={fechaHoraAdmin(salud.actividad.ultimoAccesoAt)} />
            {/* Sin sesiones NO es "nadie ha entrado": analytics_sessions es
                reciente y no cubre a las clínicas antiguas. Y User.lastLogin
                está vacío en toda la tabla, así que tampoco sirve. */}
            {salud.avisos.sinRegistroDeAcceso && (
              <p className={css.bandaExtra}>
                <WifiOff size={11} style={{ verticalAlign: "-1px", marginRight: 4 }} aria-hidden="true" />
                Sin sesiones de panel registradas. La analítica es reciente: no significa que
                nadie haya entrado.
              </p>
            )}
          </section>

          {/* ── Su dinero ────────────────────────────────────────────── */}
          <section className={css.bloque}>
            <h3 className={css.bloqueTitulo}>Su dinero</h3>
            <div>
              <div className={css.destacado}>{fmtMXN(dinero.mensual)}</div>
              <div className={css.destacadoPie}>
                al mes {dinero.esNegociado ? "· precio negociado" : "· precio del plan"}
              </div>
            </div>
            <Dato etiqueta="Total cobrado" valor={fmtMXN(dinero.totalPagado)} />
            <Dato etiqueta="Pagos" valor={String(dinero.pagos)} />
            <Dato
              etiqueta="Último pago"
              valor={fecha(dinero.ultimoPagoAt)
                ? `${fecha(dinero.ultimoPagoAt)}${dinero.ultimoMetodo ? ` · ${METODO[dinero.ultimoMetodo] ?? dinero.ultimoMetodo}` : ""}`
                : null}
            />
          </section>

          {/* ── Sus avisos ───────────────────────────────────────────── */}
          <section className={css.bloque}>
            <h3 className={css.bloqueTitulo}>Avisos</h3>
            {salud.riesgos.length === 0 && !salud.avisos.esImportacion && !salud.avisos.periodoImplausible && !salud.avisos.sinRegistroDeAcceso ? (
              <p className={css.riesgo}>
                <CheckCircle2 size={13} className={css.riesgoIcono} style={{ color: "var(--success)" }} aria-hidden="true" />
                Nada que atender.
              </p>
            ) : (
              <ul className={css.listaRiesgos}>
                {salud.riesgos.map((r) => {
                  const Icono = ICONO_SEVERIDAD[r.severidad];
                  return (
                    <li key={r.clave} className={css.riesgo}>
                      <Icono size={13} className={`${css.riesgoIcono} ${CLASE_RIESGO[r.severidad]}`} aria-hidden="true" />
                      <span>
                        <span className={css.riesgoTitulo}>{r.titulo}.</span> {r.detalle}
                      </span>
                    </li>
                  );
                })}
                {salud.avisos.esImportacion && (
                  <li className={css.riesgo}>
                    <Upload size={13} className={css.riesgoIcono} aria-hidden="true" />
                    <span>
                      <span className={css.riesgoTitulo}>Importación.</span> Alta reciente con
                      muchos pacientes de golpe: sus números no son crecimiento orgánico.
                    </span>
                  </li>
                )}
                {salud.avisos.sinRegistroDeAcceso && (
                  <li className={css.riesgo}>
                    <WifiOff size={13} className={css.riesgoIcono} aria-hidden="true" />
                    <span>
                      <span className={css.riesgoTitulo}>Sin registro de acceso.</span> No hay
                      sesiones de panel de esta clínica en la analítica. Es una carencia del dato,
                      no una afirmación sobre la clínica.
                    </span>
                  </li>
                )}
                {salud.avisos.periodoImplausible && (
                  <li className={css.riesgo}>
                    <CalendarClock size={13} className={css.riesgoIcono} aria-hidden="true" />
                    <span>
                      <span className={css.riesgoTitulo}>Fecha de acceso implausible.</span> El
                      periodo termina demasiado lejos; cualquier cuenta de trials que la incluya
                      queda descuadrada. Es un dato de la base, no un cálculo de esta pantalla.
                    </span>
                  </li>
                )}
              </ul>
            )}
          </section>
        </div>
      </CardNew>
    </div>
  );
}
