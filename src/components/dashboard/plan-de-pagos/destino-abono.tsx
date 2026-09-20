"use client";

// A QUÉ CUOTA VA LO QUE SE ESTÁ COBRANDO (ws1-t2). Se pinta debajo de «Monto a
// cobrar», en Registrar pago y en el cobro del detalle de factura.
//
// Solo INFORMA. No cambia el monto, no elige cuota y no toca el POST del cobro:
// el dinero se sigue moviendo exactamente igual. El abono salda la cuota más
// vieja que quede, en cascada, y eso se deriva — nadie lo decide aquí.
//
// Sin condiciones a plazos (o sin la tabla) no pinta nada.

import { useMemo } from "react";
import { ArrowRight } from "lucide-react";
import { CLASES_MENU } from "@/components/dashboard/menu-dos-niveles/clases";
import { calendarioDeCuotas, destinoDelAbono, esPlanAPlazos } from "@/lib/invoices/plan-de-pagos";
import type { CondicionesPago } from "@/lib/quotes/condiciones-pago";
import { todayLocalISO } from "@/lib/billing/paid-at";
import { fmtMXNdec } from "@/lib/format";
import { useT } from "@/i18n/i18n-provider";
import { nombreDeCuota } from "./bloque-plan";
import { useCondicionesDeFactura } from "./use-condiciones";
import s from "./plan.module.css";

/** Al abrir, el monto es el saldo ENTERO: sin tope serían 25 filas encima de los métodos de pago. */
const MAX_FILAS = 3;

export function DestinoDelAbono({
  invoiceId, total, pagado, importe, activo = true, condiciones: dadas,
}: {
  invoiceId: string | null | undefined;
  total: number;
  pagado: number;
  /** Lo que hay escrito en «Monto a cobrar». */
  importe: number;
  /** `false` mientras el modal está cerrado: no se pregunta nada al servidor. */
  activo?: boolean;
  /** Quien ya las leyó (el detalle de factura) las pasa, y aquí no se vuelve a
   *  preguntar. `undefined` = no las tengo, léelas tú. */
  condiciones?: CondicionesPago | null;
}) {
  const t = useT();
  const leidas = useCondicionesDeFactura(invoiceId, activo && dadas === undefined);
  const condiciones = dadas === undefined ? leidas : dadas;
  const hoy = todayLocalISO();
  const destino = useMemo(
    () => destinoDelAbono(calendarioDeCuotas(condiciones, total), [{ importe: pagado }], importe, hoy),
    [condiciones, total, pagado, importe, hoy],
  );

  if (!esPlanAPlazos(condiciones) || destino.length === 0) return null;

  const visibles = destino.slice(0, MAX_FILAS);
  const resto = destino.slice(MAX_FILAS);
  const importeResto = resto.reduce((acc, d) => acc + Math.round(d.aplica * 100), 0) / 100;

  return (
    <div className={`${CLASES_MENU} ${s.destino}`} role="status">
      <span className={s.rotulo}>{t("planDePagos.destinoTitulo")}</span>
      <ul className={s.destinoLista}>
        {visibles.map((d) => (
          <li key={`${d.cuota.esEnganche ? "e" : "c"}-${d.cuota.numero}`} className={s.destinoFila}>
            <ArrowRight size={13} strokeWidth={2.4} aria-hidden className={s.destinoFlecha} />
            <span className={s.destinoNombre}>
              {d.laSalda
                ? t("planDePagos.destinoSalda", { cuota: nombreDeCuota(d.cuota, t) })
                : t("planDePagos.destinoAbona", { cuota: nombreDeCuota(d.cuota, t) })}
              {d.cuota.estado === "vencida" && <span className={s.destinoVencida}>{" · "}{t("planDePagos.estado.vencida")}</span>}
            </span>
            <span className={s.destinoImporte}>{fmtMXNdec(d.aplica)}</span>
          </li>
        ))}
        {resto.length > 0 && (
          <li className={s.destinoMas}>
            {t("planDePagos.destinoMas", { count: resto.length })}{" · "}<strong>{fmtMXNdec(importeResto)}</strong>
          </li>
        )}
      </ul>
      <p className={s.nota}>{t("planDePagos.destinoNota")}</p>
    </div>
  );
}
