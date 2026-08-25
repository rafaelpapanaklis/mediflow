"use client";

/* ═══════════════════════════════════════════════════════════════════════
   COMPARTIR LA WEB: liga, QR y el letrero imprimible.

   El QR se pinta con qrcode.react (SVG, sin peticiones) para verlo en
   pantalla. El del LETRERO se genera en el servidor con `qrcode` porque va
   dentro de una hoja imprimible que tiene que salir idéntica en cualquier
   impresora.
   ═══════════════════════════════════════════════════════════════════════ */

import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";

export function Compartir({ url, nombre }: { url: string; nombre: string }) {
  const [copiado, setCopiado] = useState(false);

  async function copiar() {
    try {
      await navigator.clipboard.writeText(url);
      setCopiado(true);
      window.setTimeout(() => setCopiado(false), 2000);
    } catch {
      // Sin permiso de portapapeles (o sin https): el input de al lado ya
      // enseña la liga completa para seleccionarla a mano.
      setCopiado(false);
    }
  }

  return (
    <div className="dcrwe-compartir">
      <div className="dcrwe-compartir-liga">
        <input type="text" className="dcrwe-input" value={url} readOnly aria-label="Liga de tu web" />
        <button type="button" className="dcrwe-btn" onClick={() => void copiar()}>
          {copiado ? "Copiada" : "Copiar"}
        </button>
      </div>

      <div className="dcrwe-compartir-qr">
        <QRCodeSVG value={url} size={132} level="M" marginSize={0} />
        <div>
          <strong>El QR de tu web</strong>
          <p>
            Quien lo escanee llega a tu página. Para el letrero de la reja, usa el generador: sale
            en tamaño de impresión y el prospecto entra al CRM marcado como <em>letrero</em>.
          </p>
          <a className="dcrwe-btn" href="/inmobiliaria/mi-web/letrero">
            Hacer un letrero
          </a>
        </div>
      </div>
      <p className="dcrwe-ayuda">Es la web de {nombre}. Ponla en la bio de Instagram.</p>
    </div>
  );
}
