"use client";

// Ortodoncia en la pantalla «Hoy» (ws1-t5, 28-sep-2026; fila 8 del mapa de la
// revisión de lógica de uso). Dos avisos, y cada uno se calla solo si no
// tiene nada que decir:
//
//  · «N controles de ortodoncia hoy» — cuántos faltan por registrar y cuál
//    es el siguiente. Lleva al caso del paciente (si solo falta uno) o a
//    Ortodoncia → Controles. El Hoy no abre la hoja de control: solo lleva
//    hasta donde se registra.
//  · «N mensualidades vencidas» — el de siempre, pero ahora lleva a
//    Ortodoncia → Cobranza a quien puede entrar al módulo (antes, siempre a
//    Caja). Recepción sin el permiso del módulo sigue yendo a Caja.
//
// Una sola lectura (`resumenOrtodonciaDeHoy`), que decide con la sesión qué le
// toca ver a cada quien. No manda nada al paciente.
//
// Misma ropa que el aviso de anticipos y el de mensualidades de siempre
// (`avisos.module.css`): sirve en el Hoy nuevo y en el de siempre.

import { useEffect, useState } from "react";
import { AlertTriangle, CalendarCheck, ChevronRight } from "lucide-react";
import Link from "next/link";
import {
  resumenOrtodonciaDeHoy,
  type ResumenOrtodonciaDeHoy,
} from "@/app/actions/orthodontics/hoy/resumenDeHoy";
import {
  destinoDeMensualidadesVencidas,
  resumirControlesDeHoy,
  subtituloDeMensualidadesVencidas,
} from "@/lib/orthodontics/hoy";
import s from "@/components/dashboard/cobros-inventario-rediseno/avisos.module.css";

const fmt = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" });

interface Props {
  /** El Hoy del doctor: sus controles, sin el aviso de dinero. */
  soloControles?: boolean;
}

export function OrtodonciaEnHoy({ soloControles }: Props) {
  const [resumen, setResumen] = useState<ResumenOrtodonciaDeHoy | null>(null);

  useEffect(() => {
    let vivo = true;
    resumenOrtodonciaDeHoy()
      .then((r) => {
        if (vivo && r.ok) setResumen(r.data);
      })
      .catch(() => {
        // Sin lectura no hay aviso: el resto del Hoy sigue igual.
      });
    return () => {
      vivo = false;
    };
  }, []);

  if (!resumen) return null;

  const controles = resumirControlesDeHoy(resumen.controles);
  const vencidas = !soloControles && resumen.vencidas && resumen.vencidas.count > 0 ? resumen.vencidas : null;
  if (!controles && !vencidas) return null;

  return (
    <>
      {controles && (
        <Link href={controles.href} className={`${s.aviso} ${s.avisoEnlace}`} data-aviso-orto="controles">
          <span className={`${s.icono} ${s.iconoInfo}`}>
            <CalendarCheck size={16} strokeWidth={1.75} aria-hidden />
          </span>
          <span className={s.textos}>
            <span className={s.titulo}>{controles.titulo}</span>
            <span className={s.sub}>{controles.sub}</span>
          </span>
          <ChevronRight size={16} strokeWidth={1.75} className={s.flecha} aria-hidden />
        </Link>
      )}

      {vencidas && (
        <Link
          href={destinoDeMensualidadesVencidas(resumen.puedeVerModulo)}
          className={`${s.aviso} ${s.avisoEnlace}`}
          role="alert"
          data-aviso-orto="mensualidades"
        >
          <span className={`${s.icono} ${s.iconoPeligro}`}>
            <AlertTriangle size={16} strokeWidth={1.75} aria-hidden />
          </span>
          <span className={s.textos}>
            <span className={s.titulo}>
              {vencidas.count === 1 ? "1 mensualidad vencida" : `${vencidas.count} mensualidades vencidas`}
            </span>
            <span className={s.sub}>{subtituloDeMensualidadesVencidas(resumen.puedeVerModulo)}</span>
          </span>
          <span className={`${s.importe} ${s.importePeligro}`}>{fmt.format(vencidas.total)}</span>
          <ChevronRight size={16} strokeWidth={1.75} className={s.flecha} aria-hidden />
        </Link>
      )}
    </>
  );
}
