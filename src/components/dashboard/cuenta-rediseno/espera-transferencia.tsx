"use client";

import { useEffect, useRef } from "react";
import { CreditCard, LifeBuoy } from "lucide-react";
import { DatosTransferencia } from "./datos-transferencia";
import type { SolicitudSpeiDTO } from "@/lib/billing/spei-directo";
import s from "./pago.module.css";

/** Cada cuánto se le pregunta al servidor si ya confirmamos (ms). */
const CADA_MS = 15_000;

/**
 * Pantalla de ESPERA: la clínica avisó que hizo la transferencia y sigue sin
 * acceso hasta que un admin la confirma en /admin/payments. Es lo que ve cada
 * vez que entra a su panel (el gate la manda a /dashboard/suspended y la página
 * la trae aquí mientras haya una solicitud pendiente).
 *
 * La ruedita gira mientras dura la espera. Cada 15 s (y al volver a la pestaña)
 * se pregunta a GET /api/billing/spei-transferencia:
 *   · activa     → la confirmaron: al panel con una carga COMPLETA (`location`,
 *                  no un enlace suave: el layout aún tendría a la clínica
 *                  «vencida» en su caché de rutas y rebotaría a esta pantalla);
 *   · ni pendiente ni activa → la rechazaron: se recarga y la página muestra el
 *                  motivo y la pantalla de pago.
 * Si la consulta falla (sin red) se ignora y se vuelve a intentar.
 * Además de los datos de la transferencia, deja pagar con tarjeta en su lugar.
 */
export function EsperaTransferencia({
  solicitud,
  planNombre,
  hrefTarjeta,
}: {
  solicitud: SolicitudSpeiDTO;
  planNombre: string;
  hrefTarjeta: string;
}) {
  const consultando = useRef(false);

  useEffect(() => {
    async function preguntar() {
      if (consultando.current) return;
      consultando.current = true;
      try {
        const res = await fetch("/api/billing/spei-transferencia", { cache: "no-store" });
        if (!res.ok) return;
        const d = (await res.json()) as { pendiente?: boolean; activa?: boolean };
        if (d.activa) window.location.href = "/dashboard";
        else if (d.pendiente === false) window.location.reload();
      } catch {
        /* sin red: la siguiente vuelta lo reintenta */
      } finally {
        consultando.current = false;
      }
    }
    const id = setInterval(preguntar, CADA_MS);
    const alVolver = () => {
      if (document.visibilityState === "visible") void preguntar();
    };
    document.addEventListener("visibilitychange", alVolver);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", alVolver);
    };
  }, []);

  const anual = solicitud.billing === "annual";

  return (
    <div className={s.espera} data-testid="espera-transferencia">
      <div className={s.esperaTarjeta}>
        <div className={s.esperaCabeza} role="status" aria-live="polite">
          <div className={s.rueda} aria-hidden />
          <h1 className={s.esperaTitulo}>Esperando la confirmación de tu transferencia</h1>
          <p className={s.esperaTexto}>
            Confirmamos las transferencias a mano, en cuanto las vemos en el banco. No necesitas hacer nada más:
            esta pantalla se actualiza sola y tu panel se activa apenas la confirmemos.
          </p>
        </div>

        <div className={s.esperaResumen}>
          <div className={s.esperaResumenCelda}>
            <span className={s.esperaResumenK}>Plan</span>
            <span className={s.esperaResumenV}>{planNombre}</span>
          </div>
          <div className={s.esperaResumenCelda}>
            <span className={s.esperaResumenK}>Periodo</span>
            <span className={s.esperaResumenV}>{anual ? "Anual" : "Mensual"}</span>
          </div>
        </div>

        <DatosTransferencia
          cuenta={{ banco: solicitud.banco, beneficiario: solicitud.beneficiario, clabe: solicitud.clabe }}
          importe={{ subtotalCents: solicitud.subtotalCents, ivaCents: solicitud.ivaCents, totalCents: solicitud.amountCents }}
          referencia={solicitud.reference}
          periodo={anual ? "anual" : "mensual"}
        />

        <div className={s.esperaAcciones}>
          <a href={hrefTarjeta} className={`${s.boton} ${s.botonPrincipal}`}>
            <CreditCard size={16} aria-hidden />
            Pagar con tarjeta en su lugar
          </a>
          <a href="mailto:soporte@dalecontrol.com" className={s.boton}>
            <LifeBuoy size={16} aria-hidden />
            Hablar con soporte
          </a>
        </div>
      </div>
    </div>
  );
}
