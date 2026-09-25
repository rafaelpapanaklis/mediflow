"use client";

import { useCallback, useState } from "react";
import { Tilt3D } from "./tilt-3d";
import { HISTORIAS, WhatsappPhone } from "./whatsapp-phone";

/**
 * El teléfono más las tres tarjetas que flotan a su lado en 3D y cuentan lo
 * que pasa FUERA de la pantalla del paciente: de dónde salió el cobro, el pago
 * que cae en la cuenta de Mercado Pago de la clínica y cómo queda la factura o
 * el plan de pago. Cambian con la historia (implante / mensualidad) y se
 * encienden cuando el guion llega a su paso.
 */
const TARJETAS = {
  implante: {
    origen: { b: "Cobro enviado desde la factura", s: "El link de Mercado Pago sale del botón «Enviar por WhatsApp» de la factura." },
    pago: { b: "Pago aprobado · $18,500.00 MXN", s: "En la cuenta de Mercado Pago de Clínica Altabrisa." },
    cierre: { b: "Factura P-1024 al día", s: "El pago se registró solo en la factura como «Mercado Pago»." },
  },
  ortodoncia: {
    origen: { b: "Plan de pago · 12 mensualidades", s: "Ortodoncia en 12 pagos, con su calendario en la ficha." },
    pago: { b: "Pago aprobado · $1,250.00 MXN", s: "En la cuenta de Mercado Pago de Clínica Altabrisa." },
    cierre: { b: "Mensualidad 4 de 12 pagada", s: "Registrada en el plan de pago; quedan 8." },
  },
} as const;

export function WhatsappEscena() {
  // El servidor pinta la primera historia completa → las tres tarjetas encendidas.
  const [estado, setEstado] = useState({ historia: 0, paso: HISTORIAS[0].pasos.length });
  const onPaso = useCallback((historia: number, paso: number) => setEstado({ historia, paso }), []);
  const h = HISTORIAS[estado.historia];
  const t = TARJETAS[h.id];
  // El pago se aprueba cuando el paciente manda «ya pagué» (el paso anterior a la confirmación).
  const pagoOn = estado.paso >= h.pasos.length - 1;
  const cierreOn = estado.paso >= h.pasos.length;

  return (
    <Tilt3D max={7} className="dcv4-tilt--phone">
      <div className="dcv4-waesc" role="img" aria-label="Conversación de WhatsApp entre un paciente y Clínica Altabrisa: la clínica manda el cobro de un tratamiento con el link de Mercado Pago, el paciente paga desde su celular y llega la confirmación; se alterna con el cobro de una mensualidad de ortodoncia">
        <WhatsappPhone onPaso={onPaso} />

        {/* Lo que pasa FUERA del teléfono, en tarjetas que flotan a su lado */}
        <div className="dcv4-waesc__cards">
          <div className="dcv4-waesc__card dcv4-waesc__card--hora is-on">
            <span className="dcv4-waesc__ico dcv4-waesc__ico--fact">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 3h9l4 4v14H6z" /><path d="M15 3v4h4" /><path d="M9 13h6M9 17h6" /></svg>
            </span>
            <span>
              <b>{t.origen.b}</b>
              <span>{t.origen.s}</span>
            </span>
          </div>

          <div className={`dcv4-waesc__card dcv4-waesc__card--mp${pagoOn ? " is-on" : ""}`}>
            <span className="dcv4-waesc__ico dcv4-waesc__ico--mp">
              <svg width="26" height="18" viewBox="0 0 30 20" aria-hidden="true"><ellipse cx="15" cy="10" rx="14" ry="9.2" fill="#fff" /><path d="M6 10c3-3.6 6-3.6 9 0s6 3.6 9 0" fill="none" stroke="#009EE3" strokeWidth="2" strokeLinecap="round" /><path d="M4.5 12.5c3.5 4.2 7 4.2 10.5 0" fill="none" stroke="#009EE3" strokeWidth="1.6" strokeLinecap="round" /></svg>
            </span>
            <span>
              <b>{t.pago.b}</b>
              <span>En la cuenta de Mercado Pago de <u>Clínica Altabrisa</u>.</span>
            </span>
          </div>

          <div className={`dcv4-waesc__card dcv4-waesc__card--ag${cierreOn ? " is-on" : ""}`}>
            <span className="dcv4-waesc__ico dcv4-waesc__ico--ag">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12.5 4.2 4.2L19 7" /></svg>
            </span>
            <span>
              <b>{t.cierre.b}</b>
              <span>{t.cierre.s}</span>
            </span>
          </div>
        </div>
      </div>
    </Tilt3D>
  );
}
