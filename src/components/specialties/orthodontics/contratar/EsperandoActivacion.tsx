"use client";
// Contratar Ortodoncia — la vuelta de Stripe (ws1-t3). El pago ya se hizo,
// pero quien ACTIVA el módulo es el webhook de Stripe, que puede tardar unos
// segundos. Mientras, esta pieza vuelve a preguntar al servidor; cuando el
// módulo ya está activo, entra con una carga COMPLETA de la página: así el
// menú (que venía con candado) y el submenú del módulo se pintan de nuevo.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Hourglass } from "lucide-react";
import { RUTA_MODULO_ORTODONCIA } from "@/lib/orthodontics/contratar";
import s from "./contratar.module.css";

const CADA_MS = 4000;
const INTENTOS = 15;

export function EsperandoActivacion({ activo }: { activo: boolean }) {
  const router = useRouter();
  const [intentos, setIntentos] = useState(0);

  useEffect(() => {
    if (activo) {
      window.location.replace(RUTA_MODULO_ORTODONCIA);
      return;
    }
    if (intentos >= INTENTOS) return;
    const reloj = window.setTimeout(() => {
      setIntentos((n) => n + 1);
      router.refresh();
    }, CADA_MS);
    return () => window.clearTimeout(reloj);
  }, [activo, intentos, router]);

  if (activo) {
    return (
      <div className={`${s.aviso} ${s.avisoExito}`} role="status">
        <CheckCircle2 size={18} strokeWidth={1.9} aria-hidden />
        <div className={s.avisoCuerpo}>
          <strong>Ortodoncia ya está activa</strong>
          Entrando al módulo…
        </div>
      </div>
    );
  }

  const agotado = intentos >= INTENTOS;
  return (
    <div className={`${s.aviso} ${agotado ? s.avisoAlerta : s.avisoExito}`} role="status">
      {agotado ? (
        <Hourglass size={18} strokeWidth={1.9} aria-hidden />
      ) : (
        <CheckCircle2 size={18} strokeWidth={1.9} aria-hidden />
      )}
      <div className={s.avisoCuerpo}>
        <strong>{agotado ? "Tu pago se recibió; la activación está tardando" : "Pago recibido. Estamos activando Ortodoncia…"}</strong>
        {agotado ? (
          <>
            No hace falta que pagues otra vez.{" "}
            <a className={s.avisoEnlace} href={RUTA_MODULO_ORTODONCIA}>
              Vuelve a intentar entrar
            </a>{" "}
            en un minuto o escríbenos desde{" "}
            <a className={s.avisoEnlace} href="/dashboard/soporte">
              Soporte
            </a>
            .
          </>
        ) : (
          "Suele tardar unos segundos. No cierres esta página."
        )}
      </div>
    </div>
  );
}
