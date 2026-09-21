"use client";

// ═══════════════════════════════════════════════════════════════════════════
// Píldora "¿ya leyó la clínica nuestra respuesta?" — la usan la lista y la
// ficha de /admin/soporte para que digan exactamente lo mismo.
// Se lee por FORMA y por COLOR: ojo tachado (sin leer) · doble palomita
// (leído) · raya (no hay nada que leer). Tonos vía BadgeNew → tokens del
// rediseño, claro y oscuro salen solos. Ni un hex a mano.
// ═══════════════════════════════════════════════════════════════════════════

import { CheckCheck, EyeOff } from "lucide-react";
import { BadgeNew } from "@/components/ui/design-system/badge-new";
import { LECTURA_DETALLE, LECTURA_LABEL, type EstadoLectura } from "./lectura-clinica";

export function EtiquetaLectura({ estado }: { estado: EstadoLectura }) {
  // Sin respuesta nuestra: ni píldora ni color. No es un estado de lectura,
  // y pintarlo como uno haría que "sin leer" dejara de saltar.
  if (estado === "sin-respuesta") {
    return (
      <span style={{ color: "var(--text-3)", fontSize: 12 }} title={LECTURA_DETALLE[estado]}>
        <span aria-hidden>—</span>
        <span className="sr-only">{LECTURA_DETALLE[estado]}</span>
      </span>
    );
  }

  const sinLeer = estado === "sin-leer";
  return (
    <span title={LECTURA_DETALLE[estado]} style={{ display: "inline-flex" }}>
      <BadgeNew tone={sinLeer ? "danger" : "neutral"}>
        {sinLeer ? (
          <EyeOff size={11} strokeWidth={2.25} aria-hidden />
        ) : (
          <CheckCheck size={11} strokeWidth={2.25} aria-hidden />
        )}
        {LECTURA_LABEL[estado]}
      </BadgeNew>
    </span>
  );
}
