"use client";

// Botón "QR" que genera el código en el cliente con la lib `qrcode` (ya en
// package.json, misma que usa el carnet de implantes) y dispara la descarga
// como PNG. Sin estado global; cada click genera fresco.
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
      title="Descargar código QR (PNG)"
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        padding: "0 14px",
        height: 40,
        flexShrink: 0,
        borderRadius: 10,
        border: "1px solid var(--border-brand)",
        background: "var(--brand-soft)",
        color: "var(--violet-400)",
        fontSize: 13,
        fontWeight: 600,
        cursor: busy ? "default" : "pointer",
        opacity: busy ? 0.6 : 1,
        fontFamily: "inherit",
        transition: "all .15s",
      }}
    >
      <QrCode size={15} />
      {label}
    </button>
  );
}
