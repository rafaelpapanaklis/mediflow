"use client";

/**
 * WS1-T5 (ajuste 3) — una fila de `HomeAdminAlert` en la tarjeta "Avisos" de
 * Hoy (rediseño). El rediseño de julio nunca montó esto: la API ya calculaba
 * los avisos (inventario bajo, por caducar, caducado, facturas vencidas…)
 * pero ninguna pantalla los pintaba (REPORTE-ws1-t2.md, punto 3c).
 *
 * Diseño (ws1-t5): la ropa pasa de estilos en línea a
 * `cobros-inventario-rediseno/avisos.module.css`, porque en línea no se puede
 * escribir ni el `:hover` ni el foco de teclado, y la última fila se quedaba
 * con una raya debajo que no separaba nada.
 */

import Link from "next/link";
import { AlertTriangle, AlertCircle, ChevronRight, Info, type LucideIcon } from "lucide-react";
import type { HomeAdminAlert } from "@/lib/home/types";
import s from "@/components/dashboard/cobros-inventario-rediseno/avisos.module.css";

const ICONO: Record<HomeAdminAlert["tone"], LucideIcon> = {
  warning: AlertTriangle,
  danger:  AlertCircle,
  info:    Info,
};

const TONO: Record<HomeAdminAlert["tone"], string> = {
  warning: s.iconoAlerta,
  danger:  s.iconoPeligro,
  info:    s.iconoInfo,
};

export function FilaAviso({ alert }: { alert: HomeAdminAlert }) {
  const Icono = ICONO[alert.tone];

  const contenido = (
    <>
      <span className={`${s.icono} ${s.filaAvisoIcono} ${TONO[alert.tone]}`}>
        <Icono size={14} strokeWidth={1.75} aria-hidden />
      </span>
      <span className={s.filaAvisoTexto}>{alert.title}</span>
      {alert.href && <ChevronRight size={14} strokeWidth={1.75} className={s.flecha} aria-hidden />}
    </>
  );

  return alert.href
    ? <Link href={alert.href} className={s.filaAviso}>{contenido}</Link>
    : <div className={s.filaAviso}>{contenido}</div>;
}
