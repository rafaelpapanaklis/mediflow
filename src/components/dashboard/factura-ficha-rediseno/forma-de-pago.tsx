"use client";

// ═══════════════════════════════════════════════════════════════════════════
// Lo que el popup «Nueva factura» toma de Presupuestos (ws1-t1):
//
//   · FORMA DE PAGO — un pago o a plazos (enganche, cuántos pagos, cada cuánto,
//     primer pago) y con qué paga. Mismo dibujo, mismas palabras (las claves
//     `presupuestoNuevo.*`) y la MISMA aritmética que `presupuesto-nuevo/
//     editor.tsx`: `lib/quotes/condiciones-pago.ts`, en centavos enteros.
//   · ENVIAR AL PACIENTE — por correo o por WhatsApp, a elección de quien crea
//     el cobro. Sin correo o sin teléfono la opción se deshabilita y el motivo
//     se ESCRIBE debajo.
//
// Son dos bloques que el popup monta SOLO con el interruptor encendido. Todo
// está a la vista: ni un acordeón, ni un «más opciones».
//
// Viven dentro del `DialogContent` de Nueva factura, que ya monta `CLASES_MENU`
// (los `--m2-*`): los bloques y sus rótulos usan las clases de ese modal
// (`factura-rediseno/`, solo lectura) para ser hermanos de los que ya hay.
// ═══════════════════════════════════════════════════════════════════════════

import { useMemo } from "react";
import { CalendarDays, CreditCard, Mail, MessageCircle, Send } from "lucide-react";
import {
  calcularCalendario, dinero, fechaEnPalabras, frasePlan,
  FRECUENCIAS_PAGO, MAX_PAGOS, METODOS_PAGO, MIN_PAGOS, PAGOS_SUGERIDOS,
  type CondicionesPago, type FrecuenciaPago, type ModoPago,
} from "@/lib/quotes/condiciones-pago";
import { clasesFactura as c } from "@/components/dashboard/factura-rediseno/raiz";
import { useT } from "@/i18n/i18n-provider";
import type { ContactoPaciente, ViaEnvio } from "./datos";
import s from "./ficha.module.css";

const num = (v: string) => { const n = Number(v); return isFinite(n) ? n : 0; };

/** Hoy, en el día LOCAL de quien crea el cobro (no en UTC: a las 7 pm en México
 *  `toISOString()` ya dice mañana). */
function hoyLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** El cambio de condiciones, con la misma regla que el editor de presupuestos:
 *  «lo difiere con su banco» solo vive en un pago con tarjeta de crédito. */
export function parchearCondiciones(prev: CondicionesPago, cambio: Partial<CondicionesPago>): CondicionesPago {
  const sig = { ...prev, ...cambio };
  if (sig.modo !== "unico" || sig.metodo !== "credit") sig.difiereConSuBanco = false;
  return sig;
}

export function FormaDePagoFactura({
  cond, total, onChange,
}: {
  cond: CondicionesPago;
  /** El TOTAL en vivo del popup: el mismo número que se va a guardar. */
  total: number;
  onChange: (sig: CondicionesPago) => void;
}) {
  const t = useT();
  const parchear = (cambio: Partial<CondicionesPago>) => onChange(parchearCondiciones(cond, cambio));
  const calendario = useMemo(() => calcularCalendario(total, cond), [total, cond]);

  function elegirModo(modo: ModoPago) {
    parchear({
      modo,
      // Al pasar a plazos se sugieren 6 mensualidades y el primer pago hoy:
      // números con los que ya se lee la frase, en vez de un formulario vacío.
      numPagos: modo === "plazos" ? (cond.numPagos >= MIN_PAGOS ? cond.numPagos : PAGOS_SUGERIDOS) : 0,
      enganche: modo === "plazos" ? cond.enganche : 0,
      primerPago: modo === "plazos" && !cond.primerPago ? hoyLocal() : cond.primerPago,
    });
  }

  return (
    <div className={c.bloque}>
      <div className={c.bloqueCabeza}>
        <h3 className={c.bloqueTitulo}>{t("presupuestoNuevo.formaDePago")}</h3>
      </div>

      <div className={s.opciones}>
        <Opcion
          activa={cond.modo === "unico"}
          icono={<CreditCard size={15} aria-hidden />}
          titulo={t("presupuestoNuevo.modoUnico")}
          pista={t("presupuestoNuevo.modoUnicoPista")}
          onClick={() => elegirModo("unico")}
        />
        <Opcion
          activa={cond.modo === "plazos"}
          icono={<CalendarDays size={15} aria-hidden />}
          titulo={t("presupuestoNuevo.modoPlazos")}
          pista={t("presupuestoNuevo.modoPlazosPista")}
          onClick={() => elegirModo("plazos")}
        />
      </div>

      <div>
        <span className={s.rotulo}>
          {cond.modo === "plazos" ? t("presupuestoNuevo.metodoDeLasCuotas") : t("presupuestoNuevo.metodo")}
        </span>
        <div className={s.metodos}>
          {METODOS_PAGO.map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={cond.metodo === m}
              className={`${s.metodo} ${cond.metodo === m ? s.metodoActivo : ""}`}
              onClick={() => parchear({ metodo: cond.metodo === m ? null : m })}
            >
              {t(`presupuestoNuevo.metodos.${m}`)}
            </button>
          ))}
        </div>
      </div>

      {cond.modo === "plazos" && (
        <>
          <div className={s.camposPlan}>
            <label className={c.campo}>
              <span className={c.campoRotulo}>{t("presupuestoNuevo.enganche")}</span>
              <input
                type="number" min={0} step="0.01" placeholder="0.00"
                value={cond.enganche || ""}
                onChange={(e) => parchear({ enganche: Math.max(0, num(e.target.value)) })}
              />
            </label>
            <label className={c.campo}>
              <span className={c.campoRotulo}>{t("presupuestoNuevo.cuantosPagos")}</span>
              <input
                type="number" min={MIN_PAGOS} max={MAX_PAGOS} step={1}
                value={cond.numPagos || PAGOS_SUGERIDOS}
                onChange={(e) => parchear({
                  numPagos: Math.min(MAX_PAGOS, Math.max(MIN_PAGOS, Math.floor(num(e.target.value)) || MIN_PAGOS)),
                })}
              />
            </label>
            <label className={c.campo}>
              <span className={c.campoRotulo}>{t("presupuestoNuevo.cadaCuanto")}</span>
              <select value={cond.frecuencia} onChange={(e) => parchear({ frecuencia: e.target.value as FrecuenciaPago })}>
                {FRECUENCIAS_PAGO.map((f) => (
                  <option key={f} value={f}>{t(`presupuestoNuevo.frecuencias.${f}`)}</option>
                ))}
              </select>
            </label>
            <label className={c.campo}>
              <span className={c.campoRotulo}>{t("presupuestoNuevo.primerPago")}</span>
              <input
                type="date"
                value={cond.primerPago ?? ""}
                onChange={(e) => parchear({ primerPago: e.target.value || null })}
              />
            </label>
          </div>

          {/* La frase y el calendario, a la vista: es lo que se le dice al paciente. */}
          {total > 0 ? (
            <>
              <p className={s.frase}>{frasePlan(total, cond)}</p>
              <ul className={s.cuotas} aria-label={t("presupuestoNuevo.calendarioCuadra", { suma: dinero(calendario.suma) })}>
                {calendario.pagos.map((p) => (
                  <li key={`${p.esEnganche ? "e" : "p"}-${p.numero}`} className={`${s.cuota} ${p.esEnganche ? s.cuotaEnganche : ""}`}>
                    <span>
                      {p.esEnganche ? t("presupuestoNuevo.enganche") : t("presupuestoNuevo.pagoN", { n: p.numero })}
                      {p.fecha ? ` · ${fechaEnPalabras(p.fecha)}` : ""}
                    </span>
                    <span className={s.cuotaMonto}>{dinero(p.monto)}</span>
                  </li>
                ))}
              </ul>
              <p className={s.aviso}>{t("presupuestoNuevo.calendarioCuadra", { suma: dinero(calendario.suma) })}</p>
            </>
          ) : (
            <p className={`${s.frase} ${s.fraseTenue}`}>{t("presupuestoNuevo.calendarioSinTotal")}</p>
          )}
        </>
      )}

      {cond.modo === "unico" && cond.metodo === "credit" && (
        <label className={s.casilla}>
          <input
            type="checkbox"
            checked={cond.difiereConSuBanco}
            onChange={(e) => parchear({ difiereConSuBanco: e.target.checked })}
          />
          <span>{t("presupuestoNuevo.difiereCasilla")}</span>
        </label>
      )}

      {/* Qué ES y qué NO es esto, sin clic: anota el trato, no cobra. */}
      <p className={s.aviso}>
        <strong className={s.avisoFuerte}>{t("facturaFicha.tratoTitulo")}</strong>
        {t("facturaFicha.tratoTexto")}
      </p>
    </div>
  );
}

/** La frase del trato en el pie fijo del popup: el bloque de arriba puede haber
 *  quedado fuera de la vista al hacer scroll, y el pie siempre está. */
export function FraseDelTrato({ cond, total }: { cond: CondicionesPago; total: number }) {
  if (cond.modo !== "plazos" || !(total > 0)) return null;
  return <p className={s.fichaPlan}>{frasePlan(total, cond)}</p>;
}

function Opcion({ activa, icono, titulo, pista, onClick, disabled = false }: {
  activa: boolean;
  icono: React.ReactNode;
  titulo: string;
  pista: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-pressed={activa}
      disabled={disabled}
      onClick={onClick}
      className={`${s.opcion} ${activa ? s.opcionActiva : ""}`}
    >
      <span className={s.opcionIcono}>{icono}</span>
      <span>
        <span className={s.opcionTitulo}>{titulo}</span>
        <span className={s.opcionPista}>{pista}</span>
      </span>
    </button>
  );
}

/** A quién se le manda la factura al crearla. `null` = no se envía (lo de hoy). */
export type EnvioAlCrear = ViaEnvio | null;

export function EnvioFactura({
  envio, contacto, hayPaciente, onChange,
}: {
  envio: EnvioAlCrear;
  /** `null` = todavía no se sabe (o no hay paciente elegido). */
  contacto: ContactoPaciente | null;
  hayPaciente: boolean;
  onChange: (sig: EnvioAlCrear) => void;
}) {
  const t = useT();
  const sinCorreo = contacto?.correo === false;
  const sinTelefono = contacto?.telefono === false;

  return (
    <div className={c.bloque}>
      <div className={c.bloqueCabeza}>
        <h3 className={c.bloqueTitulo}>{t("facturaFicha.envioTitulo")}</h3>
      </div>

      <div className={s.opciones}>
        <Opcion
          activa={envio === null}
          icono={<Send size={15} aria-hidden />}
          titulo={t("facturaFicha.envioNo")}
          pista={t("facturaFicha.envioNoPista")}
          onClick={() => onChange(null)}
        />
        <Opcion
          activa={envio === "correo"}
          disabled={sinCorreo}
          icono={<Mail size={15} aria-hidden />}
          titulo={t("facturaFicha.envioCorreo")}
          pista={t("facturaFicha.envioCorreoPista")}
          onClick={() => onChange("correo")}
        />
        <Opcion
          activa={envio === "whatsapp"}
          disabled={sinTelefono}
          icono={<MessageCircle size={15} aria-hidden />}
          titulo={t("facturaFicha.envioWhatsApp")}
          pista={t("facturaFicha.envioWhatsAppPista")}
          onClick={() => onChange("whatsapp")}
        />
      </div>

      {!hayPaciente && <p className={s.motivoEnvio}>{t("facturaFicha.envioSinPaciente")}</p>}
      {sinCorreo && <p className={s.motivoEnvio}>{t("facturaFicha.sinCorreo")}</p>}
      {sinTelefono && <p className={s.motivoEnvio}>{t("facturaFicha.sinTelefono")}</p>}
    </div>
  );
}
