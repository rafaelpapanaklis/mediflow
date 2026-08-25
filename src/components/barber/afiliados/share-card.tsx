"use client";

// ═══════════════════════════════════════════════════════════════════════
// Imagen lista para mandar por WhatsApp: QR + código + nombre de quien
// recomienda. Se dibuja en un <canvas> EN EL NAVEGADOR y se descarga como
// PNG; no hay endpoint de imagen ni assets que mantener.
//
// 1080×1350 es la proporción que WhatsApp e Instagram no recortan al
// publicarla como estado.
//
// La liga se arma con window.location.origin (igual que el QR de la fila):
// así funciona en localhost, en el preview de Vercel y en el dominio real
// sin depender de una variable de entorno que se queda vieja.
// ═══════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useRef, useState } from "react";
import { Download, ImageIcon } from "lucide-react";

const W = 1080;
const H = 1350;

// Paleta caramelo en literal: un canvas no lee custom properties del tema.
// Son colores de marca, no datos de negocio.
const INK = "#241410";
const CREAM = "#FAF5EE";
const CARAMEL = "#A2612F";
const CARAMEL_SOFT = "#DDB587";

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function BarberShareCard({
  url,
  shopName,
  code,
  headline,
  sub,
  cta,
  altText,
  downloadLabel,
}: {
  url: string;
  shopName: string;
  code: string;
  headline: string;
  sub: string;
  cta: string;
  altText: string;
  downloadLabel: string;
}) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  // Evita pintar sobre un componente ya desmontado si el usuario cambia de
  // pantalla mientras se genera el QR.
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const draw = useCallback(async () => {
    if (!url) return;
    try {
      const QRCode = (await import("qrcode")).default;
      const qrDataUrl = await QRCode.toDataURL(url, { width: 640, margin: 0 });

      const qr = new Image();
      qr.src = qrDataUrl;
      await new Promise<void>((resolve, reject) => {
        qr.onload = () => resolve();
        qr.onerror = () => reject(new Error("qr"));
      });

      const canvas = document.createElement("canvas");
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      // Fondo
      const bg = ctx.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, INK);
      bg.addColorStop(1, "#3D2417");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      // Filo de marca arriba
      ctx.fillStyle = CARAMEL;
      ctx.fillRect(0, 0, W, 14);

      ctx.textAlign = "center";

      // Titular
      ctx.fillStyle = CREAM;
      ctx.font = "700 68px system-ui, -apple-system, Segoe UI, sans-serif";
      const lines = wrapText(ctx, headline, W - 160);
      let y = 190;
      for (const line of lines) {
        ctx.fillText(line, W / 2, y);
        y += 82;
      }

      // Quién lo recomienda
      ctx.fillStyle = CARAMEL_SOFT;
      ctx.font = "500 36px system-ui, -apple-system, Segoe UI, sans-serif";
      for (const line of wrapText(ctx, sub, W - 200)) {
        ctx.fillText(line, W / 2, y + 22);
        y += 48;
      }

      // Caja blanca del QR
      const qrSize = 460;
      const boxPad = 40;
      const boxSize = qrSize + boxPad * 2;
      const boxX = (W - boxSize) / 2;
      const boxY = 560;
      ctx.fillStyle = "#FFFFFF";
      roundedRect(ctx, boxX, boxY, boxSize, boxSize, 40);
      ctx.fill();
      ctx.drawImage(qr, boxX + boxPad, boxY + boxPad, qrSize, qrSize);

      // Código legible (por si el QR no escanea)
      ctx.fillStyle = CREAM;
      ctx.font = "700 54px ui-monospace, SFMono-Regular, Menlo, monospace";
      ctx.fillText(code, W / 2, boxY + boxSize + 92);

      // Llamada a la acción
      ctx.fillStyle = CARAMEL_SOFT;
      ctx.font = "600 34px system-ui, -apple-system, Segoe UI, sans-serif";
      ctx.fillText(cta, W / 2, boxY + boxSize + 152);

      // Marca abajo
      ctx.fillStyle = CARAMEL;
      ctx.font = "700 32px system-ui, -apple-system, Segoe UI, sans-serif";
      ctx.fillText("DaleControl Barber", W / 2, H - 68);

      if (alive.current) setDataUrl(canvas.toDataURL("image/png"));
    } catch {
      // Sin imagen no pasa nada: el texto de WhatsApp y la liga siguen ahí.
      if (alive.current) setDataUrl(null);
    }
  }, [url, code, headline, sub, cta]);

  useEffect(() => {
    void draw();
  }, [draw]);

  function download() {
    if (!dataUrl) return;
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = `dalecontrol-${code.toLowerCase()}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, alignItems: "flex-start" }}>
      {dataUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- data: URL generada en el cliente
        <img src={dataUrl} alt={altText} className="dcba-preview" />
      ) : (
        <div
          className="dcba-preview"
          style={{ aspectRatio: "4 / 5", background: "var(--bg-elev-2)" }}
          aria-hidden
        />
      )}
      <button
        type="button"
        className="dcba-btn"
        onClick={download}
        disabled={!dataUrl}
        aria-label={downloadLabel}
      >
        {dataUrl ? <Download size={15} aria-hidden /> : <ImageIcon size={15} aria-hidden />}
        {downloadLabel}
      </button>
    </div>
  );
}
