"use client";

// «Cobrar hoy» de un paciente con plan de tratamiento (ws1-t12 · fase 2). Decisión de Rafael
// (20-oct-2026): UNA nota de cobro por plan y los pagos son ABONOS a ella. Si el paciente tiene un
// plan con nota, lo de hoy no es una factura nueva: es un abono a esa nota (`abonoAlPlan` reparte
// entre las notas del plan, de la más vieja a la más nueva). Si el plan aún no tiene nota (no se
// aceptó), se crea la nota del plan con sus procedimientos (POST /api/treatments/[id]/nota-de-cobro,
// la misma que «Aceptar el plan») y se abona ahí.
//
// No es otra contabilidad: cada abono es el «Registrar pago» de siempre (POST /api/invoices/:id),
// con su folio de pago, su bitácora, el freno de «caja cerrada» y su corte de Caja. Ningún aviso de
// cobro; el comprobante del pago es opcional y viene apagado, como en la hoja de siempre.
//
// Reintento sin duplicar: lo ya abonado en este intento se recuerda por nota y el siguiente clic solo
// abona lo que falta. Si un pago se quedó sin respuesta (se cortó la red), el siguiente clic relee las
// notas y cuenta como abonado lo que el servidor sí guardó (revisión, hallazgo 5): nunca se repite.

import { useMemo, useRef, useState } from "react";
import { Check, ExternalLink } from "lucide-react";
import toast from "react-hot-toast";
import { DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { useLocale, useT } from "@/i18n/i18n-provider";
import { textosDinero } from "@/lib/dinero/textos";
import { fmtMXNdec } from "@/lib/format";
import { paidAtInstant } from "@/lib/billing/paid-at";
import { useHoyDeLaClinica } from "@/lib/billing/zona-clinica";
import { mensajeDeError } from "@/lib/errores/mensaje-de-error";
import { clasesFactura as c } from "@/components/dashboard/factura-rediseno/raiz";
import { METHODS, type PaymentMethod } from "@/components/dashboard/billing/payment-modal";
import { useFrenoCajaCerrada } from "@/components/dashboard/billing/aviso-caja-cerrada";
import { AvisoCajaCerrada, AvisoCajaDeOtraPersona } from "@/components/dashboard/billing/aviso-caja-cerrada.component";
import { abonoAlPlan } from "@/lib/invoices/cobrar-hoy";
import type { ModoCobroHoy, PlanConCuenta } from "@/lib/treatments/sin-doble-cobro";
import h from "./cobrar-hoy.module.css";

export interface AbonoAlPlanProps {
  titulo: string;
  plan: PlanConCuenta;
  modo: Exclude<ModoCobroHoy, "nota_nueva">;
  puedeCobrar: boolean;
  puedeEnviarComprobante?: boolean;
  /** Relee las cuentas del paciente (tras crear la nota del plan). Devuelve el plan ya con su nota. */
  releer: () => Promise<PlanConCuenta | null>;
  ocupado: React.MutableRefObject<boolean>;
  onClose: () => void;
  onListo?: (nota: { id: string; invoiceNumber: string }) => void;
  /** «¿Qué se cobra hoy?» (abono al plan u otra cosa): lo pinta la hoja, arriba del cuerpo. */
  selector?: React.ReactNode;
}

const LLAVE_FALTA = {
  sin_nota: "planTratamiento.cobro.faltaSinNota",
  pago_invalido: "planTratamiento.cobro.faltaAbono",
  pago_mayor: "planTratamiento.cobro.faltaAbonoMayor",
} as const;

export function AbonoAlPlan({ titulo, plan: planInicial, modo: modoInicial, puedeCobrar, puedeEnviarComprobante, releer, ocupado, onClose, onListo, selector }: AbonoAlPlanProps) {
  const t = useT();
  const locale = useLocale();
  const hoy = useHoyDeLaClinica();
  const [plan, setPlan] = useState(planInicial);
  const [modo, setModo] = useState(modoInicial);
  const [pago, setPago] = useState("");
  const [metodo, setMetodo] = useState<PaymentMethod>("cash");
  const [referencia, setReferencia] = useState("");
  const [comprobante, setComprobante] = useState(false);
  const [guardando, setGuardando] = useState(false);
  // Lo ya abonado en este intento, por nota (reintento = solo lo que falta), contra lo pagado al abrir.
  const abonado = useRef(new Map<string, number>());
  const pagadoAlAbrir = useRef(new Map(planInicial.notas.map((n) => [n.invoiceId, n.paid] as const)));
  // Hubo un pago sin respuesta: antes de seguir, se relee qué guardó el servidor.
  const dudoso = useRef(false);
  const [hecho, setHecho] = useState<{ folios: string[]; primera: string; cobrado: number; queda: number; comprobante: string | null } | null>(null);
  const freno = useFrenoCajaCerrada(true, metodo === "cash");

  const notas = useMemo(
    () => plan.notas.map((n) => ({ invoiceId: n.invoiceId, invoiceNumber: n.invoiceNumber, status: n.status, total: n.total, paid: n.paid, createdAt: n.createdAt })),
    [plan.notas],
  );
  // Al crear la nota del plan, lo que va a deber es lo que falta por facturar.
  const debeAntes = modo === "nota_del_plan" ? plan.porFacturar : plan.saldo;
  const vista = modo === "abono" ? abonoAlPlan(notas, pago) : null;
  const pagoNum = Number(String(pago).replace(",", "."));
  const pagoValido = pago === "" ? 0 : Number.isFinite(pagoNum) && pagoNum >= 0 ? Math.round(pagoNum * 100) / 100 : NaN;
  const falta =
    modo === "abono"
      ? vista!.falta
      : !Number.isFinite(pagoValido)
        ? "pago_invalido"
        : pagoValido > debeAntes + 0.005
          ? "pago_mayor"
          : null;
  const pagoHoy = modo === "abono" ? vista!.abonado : Number.isFinite(pagoValido) ? pagoValido : 0;
  const quedaria = Math.max(0, Math.round((debeAntes - pagoHoy) * 100) / 100);

  async function registrarPago(invoiceId: string, monto: number): Promise<string | null> {
    let res: Response;
    try {
      res = await fetch(`/api/invoices/${invoiceId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: monto,
          method: metodo,
          paidAt: paidAtInstant(hoy, undefined, hoy)?.toISOString(),
          reference: referencia.trim() || undefined,
        }),
      });
    } catch (e) {
      // Sin respuesta: el pago pudo guardarse. El siguiente clic lo comprueba antes de cobrar nada.
      dudoso.current = true;
      return mensajeDeError(e, t, { porDefecto: t("clinical.paymentModal.registerErrorGeneric") });
    }
    if (res.ok) return null;
    const cuerpo = await res.json().catch(() => ({}));
    return mensajeDeError(cuerpo, t, { estado: res.status, porDefecto: t("clinical.paymentModal.registerErrorGeneric") });
  }

  async function guardar(sinAvisoCaja?: unknown) {
    if (guardando || falta) return;
    if (pagoHoy > 0 && !puedeCobrar) return;
    if (pagoHoy > 0 && metodo === "transfer" && !referencia.trim()) {
      toast.error(textosDinero(locale).cobro.faltaReferencia);
      return;
    }
    setGuardando(true);
    ocupado.current = true;
    try {
      if (pagoHoy > 0 && sinAvisoCaja !== true && (await freno.frenar())) return;
      freno.ocultar();

      // 0) Un pago anterior se quedó sin respuesta: lo que el servidor guardó cuenta como abonado.
      let actual = plan;
      if (dudoso.current) {
        const fresco = await releer();
        if (!fresco) {
          toast.error(t("planTratamiento.cobro.errorAbono", { folio: "", motivo: t("planTratamiento.cobro.planSinLeer") }));
          return;
        }
        for (const n of fresco.notas) {
          const antes = pagadoAlAbrir.current.get(n.invoiceId);
          if (antes === undefined) pagadoAlAbrir.current.set(n.invoiceId, n.paid);
          else abonado.current.set(n.invoiceId, Math.max(0, Math.round((n.paid - antes) * 100) / 100));
        }
        dudoso.current = false;
        actual = fresco;
        setPlan(fresco);
      }

      // 1) Sin nota todavía: la nota del plan (idempotente: un segundo clic no cobra dos veces nada).
      if (modo === "nota_del_plan") {
        const res = await fetch(`/api/treatments/${encodeURIComponent(plan.planId)}/nota-de-cobro`, { method: "POST" });
        const out = await res.json().catch(() => ({}));
        if (!res.ok) {
          toast.error(mensajeDeError(out, t, { estado: res.status, porDefecto: t("planTratamiento.cobro.errorNota") }));
          return;
        }
        const nuevo = await releer();
        if (!nuevo || nuevo.notas.length === 0) {
          toast.error(t("planTratamiento.cobro.errorNota"));
          return;
        }
        actual = nuevo;
        for (const n of nuevo.notas) if (!pagadoAlAbrir.current.has(n.invoiceId)) pagadoAlAbrir.current.set(n.invoiceId, n.paid);
        setPlan(nuevo);
        setModo("abono");
        if (out?.estado === "creada") toast.success(t("planTratamiento.cobro.notaCreada", { folio: String(out?.nota?.invoiceNumber ?? "") }));
      }

      // 2) El abono, repartido entre las notas del plan (lo ya abonado en este intento no se repite).
      const notasDeAhora = actual.notas.map((n) => ({
        invoiceId: n.invoiceId, invoiceNumber: n.invoiceNumber, status: n.status, total: n.total,
        paid: (pagadoAlAbrir.current.get(n.invoiceId) ?? n.paid) + (abonado.current.get(n.invoiceId) ?? 0), createdAt: n.createdAt,
      }));
      const yaAbonado = Array.from(abonado.current.values()).reduce((a, b) => a + b, 0);
      const pedido = Math.max(0, Math.round((pagoHoy - yaAbonado) * 100) / 100);
      // La nota recién creada pudo tomar el saldo a favor (anticipo): nunca se abona más de lo que debe.
      const debe = abonoAlPlan(notasDeAhora, 0).debe;
      const resta = Math.min(pedido, debe);
      if (resta < pedido - 0.005) {
        toast(t("cobrarHoy.anticipo", { cobra: fmtMXNdec(resta), pedido: fmtMXNdec(pedido) }), { duration: 10000 });
      }
      const reparto = resta > 0 ? abonoAlPlan(notasDeAhora, resta) : null;
      if (reparto && reparto.falta) {
        toast.error(t(LLAVE_FALTA[reparto.falta], { saldo: fmtMXNdec(reparto.debe) }));
        return;
      }
      const pagadas: string[] = [];
      for (const r of reparto?.reparto ?? []) {
        const error = await registrarPago(r.invoiceId, r.monto);
        if (error) {
          toast.error(t("planTratamiento.cobro.errorAbono", { folio: r.invoiceNumber, motivo: error }), { duration: 12000 });
          return;
        }
        abonado.current.set(r.invoiceId, (abonado.current.get(r.invoiceId) ?? 0) + r.monto);
        pagadas.push(r.invoiceId);
      }
      const cobrado = Math.round(Array.from(abonado.current.values()).reduce((a, b) => a + b, 0) * 100) / 100;

      // 3) Comprobante de cada nota abonada, solo si se pidió. Si no sale, el abono sigue hecho.
      let estadoComprobante: string | null = null;
      if (comprobante && cobrado > 0 && freno.whatsappConectado !== false) {
        for (const id of Array.from(abonado.current.keys()).filter((k) => (abonado.current.get(k) ?? 0) > 0)) {
          try {
            const res = await fetch(`/api/invoices/${id}/send-receipt`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
            const out = await res.json().catch(() => ({}));
            estadoComprobante = res.ok ? t("cobrarHoy.comprobanteEnviado") : t("cobrarHoy.comprobanteNo", { motivo: mensajeDeError(out, t, { estado: res.status }) });
          } catch (e) {
            estadoComprobante = t("cobrarHoy.comprobanteNo", { motivo: mensajeDeError(e, t) });
          }
        }
      }

      const folios = actual.notas.filter((n) => (abonado.current.get(n.invoiceId) ?? 0) > 0).map((n) => n.invoiceNumber);
      const primeraNota = actual.notas.find((n) => (abonado.current.get(n.invoiceId) ?? 0) > 0) ?? actual.notas[0];
      const debeAhora = actual.notas.reduce((s, n) => s + Math.max(0, n.total - (pagadoAlAbrir.current.get(n.invoiceId) ?? n.paid)), 0);
      const queda = Math.max(0, Math.round((debeAhora - cobrado) * 100) / 100);
      setHecho({ folios: folios.length ? folios : actual.notas.map((n) => n.invoiceNumber), primera: primeraNota?.invoiceId ?? "", cobrado, queda, comprobante: estadoComprobante });
      toast.success(cobrado > 0
        ? t("planTratamiento.cobro.toastAbonado", { monto: fmtMXNdec(cobrado), plan: actual.nombre })
        : t("planTratamiento.cobro.toastSinAbono", { plan: actual.nombre }));
      if (primeraNota) onListo?.({ id: primeraNota.invoiceId, invoiceNumber: primeraNota.invoiceNumber });
    } catch (e) {
      toast.error(mensajeDeError(e, t, { porDefecto: t("planTratamiento.cobro.errorNota") }));
    } finally {
      setGuardando(false);
      ocupado.current = false;
    }
  }

  if (hecho) {
    return (
      <>
        <DialogHeader className={c.cabecera}>
          <DialogTitle className={c.titulo}>{titulo}</DialogTitle>
        </DialogHeader>
        <div className={c.cuerpo}>
          <div className={c.resumen} role="status" data-abono-hecho>
            <div className={c.resumenFila}>
              <span className={c.rotulo}>{t("planTratamiento.cobro.notaDelPlan")}</span>
              <span className={`${c.cifra} ${c.folio}`}>{hecho.folios.join(", ")}</span>
            </div>
            <div className={c.resumenFila}>
              <span className={c.rotulo}>{t("planTratamiento.cobro.abonadoHoy")}</span>
              <span className={`${c.cifra} ${c.cifraExito}`}>{fmtMXNdec(hecho.cobrado)}</span>
            </div>
            <div className={c.resumenFila}>
              <span className={c.rotulo}>{hecho.queda > 0 ? t("planTratamiento.cobro.saldoDelPlan") : t("cobrarHoy.liquidada")}</span>
              <span className={`${c.cifra} ${c.cifraTotal} ${hecho.queda > 0 ? c.cifraPeligro : c.cifraExito}`}>{fmtMXNdec(hecho.queda)}</span>
            </div>
          </div>
          {hecho.comprobante && <p className={c.ayuda}>{hecho.comprobante}</p>}
        </div>
        <DialogFooter className={c.pie}>
          {hecho.primera && (
            <a className={c.enlace} href={`/api/invoices/${hecho.primera}/print`} target="_blank" rel="noopener noreferrer">
              <ExternalLink size={13} aria-hidden /> {t("cobrarHoy.verComprobante")}
            </a>
          )}
          <ButtonNew variant="primary" onClick={onClose}>{t("cobrarHoy.cerrar")}</ButtonNew>
        </DialogFooter>
      </>
    );
  }

  return (
    <>
      <DialogHeader className={c.cabecera}>
        <DialogTitle className={c.titulo}>{titulo}</DialogTitle>
      </DialogHeader>
      <div className={c.cuerpo}>
      {/* A medio cobro (algo ya abonado en este intento) no se cambia de camino: el reintento sigue aquí. */}
      {!guardando && !dudoso.current && Array.from(abonado.current.values()).every((m) => m <= 0) && selector}
      <div className={c.bloque} data-abono-plan={plan.planId}>
        <h3 className={c.bloqueTitulo}>{t("planTratamiento.cobro.planTitulo", { plan: plan.nombre })}</h3>
        <div className={c.resumen}>
          <div className={c.resumenFila}>
            <span className={c.rotulo}>{t("planTratamiento.cobro.total")}</span>
            <span className={c.cifra}>{fmtMXNdec(plan.total)}</span>
          </div>
          <div className={c.resumenFila}>
            <span className={c.rotulo}>{t("planTratamiento.cobro.abonado")}</span>
            <span className={`${c.cifra} ${c.cifraExito}`}>{fmtMXNdec(plan.pagado)}</span>
          </div>
          {/* Lo HECHO menos lo pagado (26-oct). Abonar más es un adelanto: queda pagado por adelantado dentro del plan (no es saldo a favor). */}
          {modo === "abono" && plan.debe !== undefined && (
            <div className={c.resumenFila} data-abono-debe-hoy>
              <span className={c.rotulo}>{t("planTratamiento.cobro.debeHoy")}</span>
              <span className={`${c.cifra} ${plan.debe > 0.005 ? c.cifraPeligro : c.cifraExito}`}>{fmtMXNdec(plan.debe)}</span>
            </div>
          )}
          <div className={c.resumenFila}>
            <span className={c.rotulo}>{modo === "nota_del_plan" ? t("planTratamiento.cobro.porFacturar") : t("planTratamiento.cobro.saldo")}</span>
            <span className={`${c.cifra} ${c.cifraPeligro}`}>{fmtMXNdec(debeAntes)}</span>
          </div>
        </div>
        {modo === "abono" && plan.debe !== undefined && debeAntes > plan.debe + 0.005 && (
          <p className={c.ayuda} data-abono-adelanto>{t("planTratamiento.cobro.ayudaAdelanto", { debe: fmtMXNdec(plan.debe), saldo: fmtMXNdec(debeAntes) })}</p>
        )}
        <p className={c.ayuda}>
          {modo === "nota_del_plan"
            ? t("planTratamiento.cobro.ayudaNotaDelPlan")
            : t("planTratamiento.cobro.ayudaAbono", { folios: plan.notas.filter((n) => n.total - n.paid > 0.005).map((n) => n.invoiceNumber).join(", ") })}
        </p>
      </div>

      {!puedeCobrar ? (
        <div className={c.bloque}>
          <h3 className={c.bloqueTitulo}>{t("planTratamiento.cobro.abonoTitulo")}</h3>
          <p className={c.ayuda}>{t("planTratamiento.cobro.sinPermisoAbono")}</p>
        </div>
      ) : (
        <div className={c.bloque}>
          <div className={`${c.bloqueCabeza} ${h.cabeza}`}>
            <h3 className={c.bloqueTitulo}>{t("planTratamiento.cobro.abonoTitulo")}</h3>
            <div className={c.bloqueAcciones}>
              <button type="button" className={c.enlace} onClick={() => setPago(String(debeAntes))} disabled={guardando}>
                {t("planTratamiento.cobro.todoElSaldo")}
              </button>
            </div>
          </div>
          <label className={c.campo}>
            <span className={c.campoRotulo}>{t("cobrarHoy.monto")}</span>
            <input className={c.input} type="number" inputMode="decimal" min={0} step="0.01" value={pago}
              onChange={(e) => setPago(e.target.value)} disabled={guardando} data-abono-monto />
          </label>
          {pagoHoy > 0 && (
            <div className={c.campo}>
              <span className={c.campoRotulo}>{t("clinical.paymentModal.paymentMethod")}</span>
              <div className={c.metodos}>
                {METHODS.map((m) => {
                  const Icono = m.icon;
                  const activo = m.value === metodo;
                  return (
                    <button key={m.value} type="button" aria-pressed={activo} className={`${c.metodo} ${activo ? c.metodoActivo : ""}`}
                      onClick={() => setMetodo(m.value)} disabled={guardando}>
                      <Icono size={14} aria-hidden /> {t(m.labelKey)}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {pagoHoy > 0 && <AvisoCajaDeOtraPersona nombre={freno.cajaDe} />}
          {pagoHoy > 0 && metodo !== "cash" && (
            <label className={c.campo}>
              <span className={c.campoRotulo}>{metodo === "transfer" ? textosDinero(locale).cobro.referenciaObligatoria : t("cobrarHoy.referencia")}</span>
              <input className={c.input} value={referencia} onChange={(e) => setReferencia(e.target.value)} disabled={guardando} required={metodo === "transfer"} aria-required={metodo === "transfer"} />
            </label>
          )}
          {puedeEnviarComprobante && pagoHoy > 0 && freno.whatsappConectado === false && (
            <p className={c.ayuda}>{textosDinero(locale).cobro.sinWhatsapp}</p>
          )}
          {puedeEnviarComprobante && pagoHoy > 0 && freno.whatsappConectado !== false && (
            <label className={c.casilla}>
              <input type="checkbox" checked={comprobante} onChange={(e) => setComprobante(e.target.checked)} disabled={guardando} />
              <span>
                {t("cobrarHoy.comprobante")}
                <span className={`${c.ayuda} ${h.ayudaCasilla}`}>{t("cobrarHoy.comprobanteAyuda")}</span>
              </span>
            </label>
          )}
        </div>
      )}

      <div className={c.totales} aria-live="polite">
        <div className={c.totalFila}>
          <span>{t("planTratamiento.cobro.abonaHoy")}</span>
          <span className={`${c.cifra} ${c.cifraExito}`}>{fmtMXNdec(pagoHoy)}</span>
        </div>
        <div className={`${c.totalFila} ${c.totalFinal}`}>
          <span>{quedaria > 0 ? t("planTratamiento.cobro.saldoDelPlan") : t("cobrarHoy.liquidada")}</span>
          <span className={`${c.cifra} ${c.cifraTotal} ${quedaria > 0 ? c.cifraPeligro : c.cifraExito}`}>{fmtMXNdec(quedaria)}</span>
        </div>
      </div>
      {falta && pago !== "" && (
        <p className={`${c.ayuda} ${c.cifraPeligro}`} role="alert">{t(LLAVE_FALTA[falta], { saldo: fmtMXNdec(debeAntes) })}</p>
      )}
      </div>

      {freno.visible && <AvisoCajaCerrada onCobrarDeTodosModos={() => guardar(true)} ocupado={guardando} />}

      <DialogFooter className={c.pie}>
        <ButtonNew variant="ghost" onClick={onClose} disabled={guardando}>{t("common.cancel")}</ButtonNew>
        <ButtonNew
          variant="primary"
          onClick={() => guardar()}
          disabled={guardando || (modo === "abono" && (!!falta || pagoHoy <= 0)) || (modo === "nota_del_plan" && !!falta)}
          data-abono-guardar
        >
          {guardando ? t("cobrarHoy.guardando") : (
            <>
              <Check size={14} aria-hidden />{" "}
              {modo === "nota_del_plan"
                ? pagoHoy > 0 ? t("planTratamiento.cobro.botonNotaYAbono", { monto: fmtMXNdec(pagoHoy) }) : t("planTratamiento.cobro.botonNota")
                : t("planTratamiento.cobro.botonAbono", { monto: fmtMXNdec(pagoHoy) })}
            </>
          )}
        </ButtonNew>
      </DialogFooter>
    </>
  );
}
