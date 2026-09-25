"use client";

import { useCallback, useState } from "react";
import { Tilt3D } from "./tilt-3d";
import { WhatsappPhone } from "./whatsapp-phone";

/**
 * El teléfono más las tres tarjetas que flotan a su lado en 3D y cuentan lo
 * que pasa fuera de la pantalla del paciente: la hora, el pago que cae en la
 * cuenta de Mercado Pago de la clínica y la cita que aparece en la agenda.
 * Cada tarjeta se enciende cuando el guion llega a su paso.
 */
export function WhatsappEscena() {
  // El servidor pinta la charla completa → las tres tarjetas encendidas.
  const [paso, setPaso] = useState(6);
  const onPaso = useCallback((n: number) => setPaso(n), []);

  return (
    <Tilt3D max={7} className="dcv4-tilt--phone">
      <div className="dcv4-waesc" role="img" aria-label="Conversación de WhatsApp entre un paciente y el bot de Clínica Altabrisa a las once de la noche: el bot ofrece dos huecos reales, manda el link del anticipo de Mercado Pago y, una vez pagado, confirma la cita">
        <WhatsappPhone onPaso={onPaso} />

        {/* Lo que pasa FUERA del teléfono, en tarjetas que flotan a su lado */}
        <div className="dcv4-waesc__cards">
          <div className="dcv4-waesc__card dcv4-waesc__card--hora is-on">
            <span className="dcv4-waesc__ico dcv4-waesc__ico--luna"><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /></svg></span>
            <span>
              <b>23:04 · clínica cerrada</b>
              <span>Contesta el bot, en el número de siempre.</span>
            </span>
          </div>

          <div className={`dcv4-waesc__card dcv4-waesc__card--mp${paso >= 5 ? " is-on" : ""}`}>
            <span className="dcv4-waesc__ico dcv4-waesc__ico--mp">
              <svg width="26" height="18" viewBox="0 0 30 20" aria-hidden="true"><ellipse cx="15" cy="10" rx="14" ry="9.2" fill="#fff" /><path d="M6 10c3-3.6 6-3.6 9 0s6 3.6 9 0" fill="none" stroke="#009EE3" strokeWidth="2" strokeLinecap="round" /><path d="M4.5 12.5c3.5 4.2 7 4.2 10.5 0" fill="none" stroke="#009EE3" strokeWidth="1.6" strokeLinecap="round" /></svg>
            </span>
            <span>
              <b>Pago aprobado · $200.00 MXN</b>
              <span>En la cuenta de Mercado Pago de <u>Clínica Altabrisa</u>.</span>
            </span>
          </div>

          <div className={`dcv4-waesc__card dcv4-waesc__card--ag${paso >= 6 ? " is-on" : ""}`}>
            <span className="dcv4-waesc__ico dcv4-waesc__ico--ag">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2.5" /><path d="M3 10h18M8 3v4M16 3v4" /></svg>
            </span>
            <span>
              <b>Agenda · mañana 10:30 · Dra. Ruiz</b>
              <span>Confirmada. Los $200 quedan como saldo a favor del paciente.</span>
            </span>
          </div>
        </div>
      </div>
    </Tilt3D>
  );
}
