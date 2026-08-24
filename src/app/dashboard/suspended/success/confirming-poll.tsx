"use client";

// Espera al webhook de Stripe SIN afirmar nada: mientras la página del servidor
// diga "confirmando", este componente vuelve a pedirle al servidor su estado
// (router.refresh re-ejecuta el server component con la BD en mano) cada pocos
// segundos, hasta un tope. Cuando el webhook activa la clínica, la página
// cambia sola a "¡Pago confirmado!" y este componente se desmonta.
//
// Es refresh() y NO un <Link> a la misma ruta: la caché del router de Next
// sirve una página dinámica hasta 30 s sin volver al servidor, así que "Volver
// a verificar" con un Link podía repetir el "confirmando" viejo aunque el
// webhook ya hubiera llegado.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";

interface Props {
  /** Texto del botón manual ("Volver a verificar"). */
  label: string;
  /** Cada cuánto se vuelve a preguntar (ms). */
  intervalMs?: number;
  /** Tope de consultas automáticas; después queda solo el botón manual. */
  maxAttempts?: number;
}

export function ConfirmingPoll({ label, intervalMs = 3000, maxAttempts = 20 }: Props) {
  const router = useRouter();
  const [attempts, setAttempts] = useState(0);

  useEffect(() => {
    if (attempts >= maxAttempts) return;
    const id = setTimeout(() => {
      setAttempts((n) => n + 1);
      router.refresh();
    }, intervalMs);
    return () => clearTimeout(id);
  }, [attempts, intervalMs, maxAttempts, router]);

  return (
    <button
      type="button"
      onClick={() => router.refresh()}
      className="inline-flex items-center justify-center gap-2 rounded-xl px-6 py-3 text-base font-bold text-white shadow-lg transition hover:opacity-90"
      style={{
        background: "var(--brand)",
        boxShadow: "0 10px 30px -8px rgba(124, 58, 237, 0.4)",
      }}
    >
      <RefreshCw size={16} aria-hidden />
      {label}
    </button>
  );
}
