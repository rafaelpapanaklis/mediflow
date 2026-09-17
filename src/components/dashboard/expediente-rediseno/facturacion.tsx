"use client";

import { Plus, Receipt } from "lucide-react";
import type { PatientBillingInvoice } from "@/components/dashboard/patient-detail/billing-tab";
import { FichasFactura } from "@/components/dashboard/factura-ficha-rediseno/fichas-factura";
import type { CondicionesPago } from "@/lib/quotes/condiciones-pago";
import { useT } from "@/i18n/i18n-provider";
import { RaizExpediente } from "./raiz";
import s from "./expediente.module.css";

/**
 * La PESTAÑA Facturación del expediente, con el diseño nuevo. Enseña lo MISMO
 * que `patient-detail/billing-tab.tsx` —folio, fecha, total, pagado, saldo,
 * estado, CFDI y «Cobrar» por factura, con «Nueva factura» arriba—, con los
 * mismos callbacks al padre y el mismo objeto de factura de vuelta.
 *
 * Desde ws1-t1 cada factura es una FICHA como la de presupuesto y no una fila
 * de tabla: Rafael pidió que una factura creada se vea como un presupuesto
 * creado, con la frase del trato a la vista. La ficha vive en
 * `factura-ficha-rediseno/` (la comparte Caja); aquí quedan la tarjeta, la
 * cabecera y «Nueva factura».
 *
 * Lo que se abre desde aquí —el detalle de factura, el pago, la factura
 * nueva— son diálogos del padre y NO son de esta pantalla: los viste otra
 * (ws1-t3). Aquí termina la pestaña.
 *
 * El mini-resumen (total / pagado / saldo) no se pinta, igual que ya hacía
 * `billing-tab.tsx` con `redesignOn`: esta pestaña siempre va con el rail y
 * su «Estado de cuenta» enseña esas mismas tres cifras (N6).
 */

export interface FacturacionProps {
  facturas: PatientBillingInvoice[];
  facturApiEnabled: boolean;
  onNueva: () => void;
  /** Clic en la fila — abre el detalle de factura del padre. */
  onAbrir: (inv: PatientBillingInvoice) => void;
  /** «Cobrar» por fila — abre el pago directo del padre. */
  onCobrar: (inv: PatientBillingInvoice) => void;
  /** «Timbrar» — abre el detalle con el formulario SAT desplegado. */
  onTimbrar: (inv: PatientBillingInvoice) => void;
  /** «Duplicar» — abre Nueva factura con los mismos conceptos y el mismo trato. */
  onDuplicar: (inv: PatientBillingInvoice, condiciones: CondicionesPago | null) => void;
}

export function Facturacion({ facturas, facturApiEnabled, onNueva, onAbrir, onCobrar, onTimbrar, onDuplicar }: FacturacionProps) {
  const t = useT();

  return (
    <RaizExpediente>
      <section className={s.tarjeta}>
        <header className={s.tarjetaCabeza}>
          <span className={s.cabeceraIcono}>
            <Receipt size={16} strokeWidth={1.75} aria-hidden />
          </span>
          <h2 className={s.titulo}>{t("patients.billing.title")}</h2>
          <div className={s.acciones}>
            <button type="button" className={`${s.boton} ${s.botonPrincipal}`} onClick={onNueva}>
              <Plus size={14} strokeWidth={2} aria-hidden />
              {t("clinical.emptyStates.invoicesNewCta")}
            </button>
          </div>
        </header>

        {/* Cada factura es una FICHA como la de presupuesto (ws1-t1): folio,
            chips de estado y CFDI, importe grande, pagado y saldo, la frase del
            trato en violeta y las acciones. Todo lo que la tabla enseñaba sin
            clic sigue a la vista, y tocar la ficha abre el detalle igual que
            tocar la fila. Ver `factura-ficha-rediseno/fichas-factura.tsx`. */}
        <FichasFactura
          dentroDeTarjeta
          facturas={facturas}
          facturApiEnabled={facturApiEnabled}
          textoCobrar={t("patients.billing.rowCharge")}
          textoVacio={t("patients.billing.empty")}
          onAbrir={onAbrir}
          onCobrar={onCobrar}
          onTimbrar={onTimbrar}
          onDuplicar={onDuplicar}
        />
      </section>
    </RaizExpediente>
  );
}
