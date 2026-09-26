"use client";

import { BotonCopiar } from "./boton-copiar";
import {
  centavosADecimal,
  centavosAMxn,
  clabeAgrupada,
  type CuentaBancaria,
  type ImporteSpei,
} from "@/lib/billing/spei-directo-core";
import s from "./pago.module.css";

/**
 * Los datos para hacer la transferencia: la cuenta de la plataforma (banco,
 * beneficiario, CLABE), el importe EXACTO y la referencia para el concepto,
 * cada uno con su botón de copiar. Solo pinta lo que recibe: la cuenta sale de
 * /admin/settings → Datos banco, el importe lo calcula `importeSpei` (el mismo
 * que la solicitud guarda) y la referencia es el folio de la clínica.
 * Se usa en la pantalla de pago (al elegir SPEI) y en la de espera.
 */
export function DatosTransferencia({
  cuenta,
  importe,
  referencia,
  periodo,
}: {
  cuenta: CuentaBancaria;
  importe: ImporteSpei;
  referencia: string;
  /** «mensual» / «anual»: para el pie del importe. */
  periodo: "mensual" | "anual";
}) {
  return (
    <div className={s.datos} data-testid="datos-transferencia">
      <p className={s.datosTitulo}>Haz tu transferencia SPEI a esta cuenta</p>

      <div className={s.dato}>
        <span className={s.datoK}>Banco</span>
        <span className={s.datoV}>{cuenta.banco}</span>
      </div>
      <div className={s.dato}>
        <span className={s.datoK}>Beneficiario</span>
        <span className={s.datoV}>{cuenta.beneficiario}</span>
        <BotonCopiar valor={cuenta.beneficiario} etiqueta="el beneficiario" />
      </div>
      <div className={s.dato}>
        <span className={s.datoK}>CLABE interbancaria</span>
        <span className={`${s.datoV} ${s.datoClabe}`}>{clabeAgrupada(cuenta.clabe)}</span>
        <BotonCopiar valor={cuenta.clabe} etiqueta="la CLABE" />
      </div>
      <div className={s.dato}>
        <span className={s.datoK}>Importe exacto a transferir (MXN)</span>
        <span className={`${s.datoV} ${s.datoVGrande}`}>{centavosAMxn(importe.totalCents)}</span>
        <BotonCopiar valor={centavosADecimal(importe.totalCents)} etiqueta="el importe" />
        <span className={s.datoDesglose}>
          {`Plan ${periodo}: ${centavosAMxn(importe.subtotalCents)} + IVA 16 % ${centavosAMxn(importe.ivaCents)}`}
        </span>
      </div>
      <div className={s.dato}>
        <span className={s.datoK}>Referencia (ponla en el concepto)</span>
        <span className={`${s.datoV} ${s.datoClabe}`}>{referencia}</span>
        <BotonCopiar valor={referencia} etiqueta="la referencia" />
      </div>

      <p className={s.datosNota}>
        Transfiere <strong>el importe exacto</strong> y escribe la referencia en el <strong>concepto</strong> para
        que identifiquemos tu pago.
      </p>
    </div>
  );
}
