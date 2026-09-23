"use client";

import type { ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { DateField } from "@/components/ui/date-field";
import { Label } from "@/components/ui/label";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { fmtMXNdec } from "@/lib/format";
import { todayLocalISO } from "@/lib/billing/paid-at";
import { useT } from "@/i18n/i18n-provider";
import { METHODS } from "@/components/dashboard/billing/payment-modal";
import { CLASES_CALENDARIO_REDISENO, clasesFactura as c } from "@/components/dashboard/factura-rediseno/raiz";
import { BotonMercadoPago, LinkMercadoPago } from "@/components/dashboard/billing/link-mercado-pago";
import type { Cobro } from "./use-cobro";
import u from "./un-popup.module.css";

/** El campo «Monto a cobrar»: es donde cae el foco al abrir, como en la ventana de cobro. */
export const ID_MONTO_COBRO = "factura-cobro-monto";

/**
 * Para `onOpenAutoFocus` del detalle: el foco va al monto (seleccionado, listo
 * para escribir encima), igual que hacía la segunda ventana, y no al primer
 * campo que haya en el DOM.
 */
export function enfocarMontoAlAbrir(e: Event) {
  const monto = document.getElementById(ID_MONTO_COBRO) as HTMLInputElement | null;
  if (!monto) return;
  e.preventDefault();
  monto.focus();
  monto.select();
}

/**
 * La sección «Registrar pago» DENTRO del detalle de la factura: monto, los
 * seis métodos, fecha, referencia y notas — los campos de la segunda ventana
 * (`billing/payment-modal.tsx`), sin su resumen (Factura, Paciente, Total,
 * Pagado, Saldo), que el detalle ya enseña a su lado.
 *
 * Solo pinta campos: el estado y el POST viven en `useCobro`, y el botón
 * «Registrar pago» va en el pie del detalle, donde hoy está «Cobrar ahora».
 * Se viste con las clases de `factura-rediseno` (cuelga de su `.raiz`).
 */
export function SeccionCobro({ cobro, bloqueado, descuento, bajoElMonto, mercadoPago }: {
  cobro: Cobro;
  /** El detalle está ocupado con otra acción (o cobrando): campos quietos. */
  bloqueado: boolean;
  /** La fila del descuento, cuando la factura todavía lo admite. */
  descuento?: ReactNode;
  /** Lo que se enseña justo debajo del monto: a qué cuota del plan va (ws1-t2). */
  bajoElMonto?: ReactNode;
  /**
   * Mercado Pago (ws1-t1). Solo se pasa si la clínica tiene la cuenta conectada:
   * entonces sale el método, y al elegirlo el link ocupa el lugar del monto, la
   * fecha, la referencia y las notas (el servidor cobra el saldo y el pago se
   * registra solo).
   */
  mercadoPago?: { invoiceId: string; alCambiar?: (link: unknown) => void } | null;
}) {
  const t = useT();
  const esMercadoPago = !!mercadoPago && cobro.method === "mercadopago";
  return (
    <section className={u.cobro} aria-label={t("clinical.paymentModal.title")}>
      <h3 className={u.cobroTitulo}>{t("clinical.paymentModal.title")}</h3>

      {descuento}

      {!esMercadoPago && (
      <div className={c.campo}>
        <Label>{t("clinical.paymentModal.amountToCharge")}</Label>
        <Input
          id={ID_MONTO_COBRO}
          type="number"
          inputMode="decimal"
          step="0.01"
          min={0}
          value={cobro.amount}
          onChange={(e) => cobro.setAmount(e.target.value)}
          disabled={bloqueado}
        />
        {cobro.isOverpay && (
          <p className={u.avisoPeligro}>
            {t("clinical.paymentModal.overpayWarning", { balance: fmtMXNdec(cobro.balance) })}
          </p>
        )}
        {bajoElMonto}
      </div>
      )}

      <div className={c.campo}>
        <Label>{t("clinical.paymentModal.paymentMethod")}</Label>
        <div className={c.metodos}>
          {METHODS.map((m) => {
            const Icon = m.icon;
            const active = m.value === cobro.method;
            return (
              <button
                key={m.value}
                type="button"
                onClick={() => cobro.setMethod(m.value)}
                disabled={bloqueado}
                aria-pressed={active}
                className={`${c.metodo} ${active ? c.metodoActivo : ""}`}
              >
                <Icon size={14} aria-hidden />
                {t(m.labelKey)}
              </button>
            );
          })}
          {mercadoPago && (
            <BotonMercadoPago
              activo={esMercadoPago}
              alElegir={() => cobro.setMethod("mercadopago")}
              disabled={bloqueado}
              className={`${c.metodo} ${esMercadoPago ? c.metodoActivo : ""}`}
            />
          )}
        </div>
      </div>

      {esMercadoPago ? (
        <LinkMercadoPago invoiceId={mercadoPago.invoiceId} modo="cobro" bloqueado={bloqueado} alCambiar={mercadoPago.alCambiar} />
      ) : (
      <>
      <div className={c.rejilla2}>
        <div className={c.campo}>
          <Label>{t("common.date")}</Label>
          {/* max = hoy: el pago se registra cuando OCURRE (el servidor rechaza
              una fecha futura con 400). Igual que en la ventana de cobro. */}
          <DateField max={todayLocalISO()} className={c.campoFecha} popoverClassName={CLASES_CALENDARIO_REDISENO} value={cobro.paidAt} onChange={(e) => cobro.setPaidAt(e.target.value)} />
        </div>
        <div className={c.campo}>
          <Label>{t("clinical.paymentModal.reference")}</Label>
          <Input
            placeholder={cobro.method === "transfer" ? t("clinical.paymentModal.refTransfer") : cobro.method === "check" ? t("clinical.paymentModal.refCheck") : t("clinical.paymentModal.refAuthorization")}
            value={cobro.reference}
            onChange={(e) => cobro.setReference(e.target.value)}
            disabled={bloqueado}
          />
        </div>
      </div>

      <div className={c.campo}>
        <Label>{t("common.notes")}</Label>
        <textarea
          className={`input-new ${u.notas}`}
          placeholder={t("common.optional")}
          value={cobro.notes}
          onChange={(e) => cobro.setNotes(e.target.value)}
          disabled={bloqueado}
        />
      </div>
      </>
      )}
    </section>
  );
}

/**
 * La fila del descuento dentro de la sección de cobro: lo que hoy es el
 * diálogo «Aplicar descuento» (subtotal actual, importe, la nota de cómo se
 * recalcula y el botón). El estado y la llamada son los del detalle
 * (`discountAmt` + `handleDiscount`): aquí no hay lógica.
 */
export function DescuentoEnLinea({ subtotal, valor, alCambiar, alAplicar, ocupado, pendiente }: {
  subtotal: number;
  valor: string;
  alCambiar: (valor: string) => void;
  alAplicar: () => void;
  ocupado: boolean;
  /** Hay un descuento escrito y sin aplicar: se avisa, porque cobrar así lo ignoraría. */
  pendiente: boolean;
}) {
  const t = useT();
  return (
    <div className={u.descuento}>
      <div className={c.campo}>
        {/* La cadena trae « *» porque en su diálogo el campo era lo único que
            había; aquí el descuento es opcional y el asterisco confundiría. */}
        <Label>{t("clinical.invoiceDetail.discountMxnLabel").replace(/\s*\*$/, "")}</Label>
        <div className={u.descuentoFila}>
          <Input type="number" inputMode="decimal" step="0.01" min={0} value={valor} onChange={(e) => alCambiar(e.target.value)} disabled={ocupado} />
          <ButtonNew variant="secondary" onClick={alAplicar} disabled={ocupado || !pendiente}>
            {t("clinical.invoiceDetail.applyDiscount")}
          </ButtonNew>
        </div>
        <p className={c.ayuda}>
          {t("clinical.invoiceDetail.currentSubtotalLabel")} <span className={u.cifraEnTexto}>{fmtMXNdec(subtotal)}</span>
          {" · "}{t("clinical.invoiceDetail.discountHelper")}
        </p>
        {pendiente && (
          <p className={u.aviso} role="status">{t("clinical.invoiceDetail.applyDiscountFirst")}</p>
        )}
      </div>
    </div>
  );
}
