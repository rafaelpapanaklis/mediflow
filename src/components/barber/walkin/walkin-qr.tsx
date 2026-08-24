"use client";

// ═══════════════════════════════════════════════════════════════════════
// QR de la fila para pegar en el mostrador.
//
// La liga se arma en el NAVEGADOR con window.location.origin: así funciona
// igual en localhost, en el preview de Vercel y en el dominio real, sin
// depender de una variable de entorno que se puede quedar vieja.
// ═══════════════════════════════════════════════════════════════════════
import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Copy, Printer } from "lucide-react";
import { agendaCss } from "@/components/barber/agenda/agenda-ui";
import css from "./walkin.module.css";
// CSS normal (no module): las reglas de impresión tocan html/body y un
// module no las admite. Solo viaja con esta ruta.
import "./walkin-print.css";

export function WalkinQr({
  slug,
  shopName,
  t,
}: {
  slug: string;
  shopName: string;
  t: (key: string, vars?: Record<string, string | number>) => string;
}) {
  const [url, setUrl] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setUrl(`${window.location.origin}/barber/fila/${slug}`);
  }, [slug]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2200);
    } catch {
      /* sin permiso de portapapeles: la liga sigue visible para copiarla a mano */
    }
  };

  return (
    <>
      <div className={css.qrCard}>
        <h2 className={css.panelTitle}>{t("barber.agenda.queue.qr.title")}</h2>
        <p className={css.panelSub} style={{ marginBottom: 14 }}>
          {t("barber.agenda.queue.qr.body")}
        </p>

        <div className={css.qrBox}>
          {url ? <QRCodeSVG value={url} size={168} level="M" marginSize={0} /> : null}
        </div>

        <code className={css.qrLink}>{url || "…"}</code>

        <div className={css.qrActions}>
          <button type="button" className={agendaCss.btn} onClick={() => window.print()}>
            <Printer size={14} /> {t("barber.agenda.queue.qr.print")}
          </button>
          <button type="button" className={agendaCss.btn} onClick={copy} disabled={!url}>
            <Copy size={14} />{" "}
            {copied ? t("barber.agenda.queue.qr.copied") : t("barber.agenda.queue.qr.copy")}
          </button>
        </div>
      </div>

      {/* Hoja que sale al imprimir (invisible en pantalla). */}
      <div className="dc-barber-print" aria-hidden="true">
        <h1 className={css.printTitle}>{shopName}</h1>
        <p className={css.printSub}>{t("barber.agenda.public.title")}</p>
        {url ? <QRCodeSVG value={url} size={300} level="M" marginSize={0} /> : null}
        <ol className={css.printSteps}>
          <li>Apunta la cámara de tu celular al código.</li>
          <li>Escribe tu nombre y tu WhatsApp.</li>
          <li>Listo: ves tu lugar en la fila y cuánto falta.</li>
        </ol>
      </div>
    </>
  );
}
