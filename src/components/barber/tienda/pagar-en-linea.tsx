"use client";

import { useEffect, useState } from "react";

/**
 * «Pagar ahora en línea» en la página del folio. Solo aparece si la ruta de
 * ws6-t5 dice que esta barbería cobra con Mercado Pago (404 o error = no se
 * pinta nada). Al pulsar pide el link del pedido y lleva a Mercado Pago.
 */
export function PagarEnLinea({ slug, orderId, label }: { slug: string; orderId: string; label: string }) {
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    fetch(`/api/barber/mercadopago/status?slug=${encodeURIComponent(slug)}`, { cache: "no-store" })
      .then(async (r) => (r.ok ? ((await r.json()) as { connected?: boolean }) : null))
      .then((d) => {
        if (alive && d?.connected === true) setShow(true);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [slug]);
  if (!show) return null;
  async function go() {
    setBusy(true);
    try {
      const r = await fetch(`/api/barber/public/orders/${encodeURIComponent(orderId)}/mercadopago`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ returnPath: window.location.pathname }),
      });
      const d = (await r.json().catch(() => ({}))) as { initPoint?: string };
      if (r.ok && d.initPoint) {
        window.location.assign(d.initPoint);
        return;
      }
      setShow(false);
    } catch {
      setShow(false);
    } finally {
      setBusy(false);
    }
  }
  return (
    <button type="button" className="dcb-btn dcb-btn--primary" onClick={go} disabled={busy} data-accion="pagar-en-linea">
      {label}
    </button>
  );
}
