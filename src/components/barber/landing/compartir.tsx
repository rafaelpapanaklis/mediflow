"use client";

/* ═══════════════════════════════════════════════════════════════════════
   COMPARTIR LA PÁGINA: liga y código QR.

   La liga es lo que la barbería pega en la bio de Instagram y en su ficha
   de Google. El QR es para imprimirlo y pegarlo en la puerta, en el
   espejo o en la tarjeta — y por eso se DESCARGA como PNG, no solo se
   mira.

   La descarga es un `<a download>` con el dataURL del canvas: sin
   servidor, sin librería extra y sin que la imagen salga nunca del
   navegador de quien la pide.
   ═══════════════════════════════════════════════════════════════════════ */

import { useRef, useState } from "react";
import { QRCodeCanvas } from "qrcode.react";
import type { TFn } from "./controles";

export function Compartir({ t, url, slug }: { t: TFn; url: string; slug: string }) {
  const caja = useRef<HTMLDivElement>(null);
  const [copiada, setCopiada] = useState(false);

  async function copiar() {
    try {
      await navigator.clipboard.writeText(url);
      setCopiada(true);
      window.setTimeout(() => setCopiada(false), 2000);
    } catch {
      // Sin permiso de portapapeles (o navegador viejo): se selecciona
      // el texto para que se pueda copiar a mano. Nunca se deja al
      // usuario sin salida.
      const input = caja.current?.querySelector("input");
      input?.select();
    }
  }

  function descargarQr() {
    const canvas = caja.current?.querySelector("canvas");
    if (!canvas) return;
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = `qr-${slug}.png`;
    a.click();
  }

  return (
    <div ref={caja} className="dcbwe-compartir">
      <p className="dcbwe-ayuda">{t("compartirAyuda")}</p>

      <div className="dcbwe-liga">
        <input type="text" readOnly value={url} className="dcbwe-input" aria-label={t("copiarLiga")} />
        <button type="button" className="dcbwe-btn dcbwe-btn-suave" onClick={copiar}>
          {copiada ? t("ligaCopiada") : t("copiarLiga")}
        </button>
      </div>

      <div className="dcbwe-qr">
        <QRCodeCanvas
          value={url}
          size={220}
          level="M"
          marginSize={2}
          bgColor="#ffffff"
          fgColor="#14100e"
          title={t("qrAlt")}
        />
        <div className="dcbwe-qr-acciones">
          <button type="button" className="dcbwe-btn dcbwe-btn-suave" onClick={descargarQr}>
            {t("descargarQr")}
          </button>
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="dcbwe-btn dcbwe-btn-texto"
          >
            {t("verPagina")}
          </a>
        </div>
      </div>
    </div>
  );
}
