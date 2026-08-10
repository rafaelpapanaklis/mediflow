"use client";

// Botón "QR" que genera el código en el cliente con la lib `qrcode` (ya en
// package.json, misma que usa el carnet de implantes) y dispara la descarga
// como PNG. Sin estado global; cada click genera fresco.
//
// Estilo: `dcafp-btn` de src/app/afiliados/panel.css — acción secundaria al
// lado de "Copiar". Sólo se usa dentro del panel de afiliado, cuyo shell carga
// esa hoja, así que la clase siempre existe donde se pinta.
import { useState } from "react";
import toast from "react-hot-toast";
import { QrCode } from "lucide-react";

export function QrDownloadButton({
  url,
  fileName,
  label = "QR",
}: {
  url: string;
  fileName: string; // sin extensión; se descarga como `${fileName}.png`
  label?: string;
}) {
  const [busy, setBusy] = useState(false);

  async function download() {
    if (busy) return;
    setBusy(true);
    try {
      const QRCode = (await import("qrcode")).default;
      const dataUrl = await QRCode.toDataURL(url, { width: 512, margin: 1 });
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = `${fileName}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      toast.success("QR descargado");
    } catch {
      toast.error("No se pudo generar el QR");
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={download}
      disabled={busy}
      // "QR" a secas no dice qué hace el botón: el nombre accesible lo explica.
      aria-label="Descargar código QR en PNG"
      title="Descargar código QR (PNG)"
      className="dcafp-btn"
    >
      <QrCode size={16} aria-hidden />
      {label}
    </button>
  );
}
