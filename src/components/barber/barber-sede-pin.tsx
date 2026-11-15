"use client";

import { installSedePin } from "@/lib/barber/sede-pin";

/**
 * Fija la sede con la que se pintó el panel para todas sus escrituras (ronda
 * 2, M3; ver src/lib/barber/sede-pin.ts). Se instala DURANTE el render y no
 * en un efecto: los efectos de los hijos corren antes que los del padre, y una
 * escritura temprana saldría sin la sede. No pinta nada.
 */
export function BarberSedePin({ branchId, message }: { branchId: string; message: string }) {
  if (typeof window !== "undefined") {
    installSedePin(window as unknown as Parameters<typeof installSedePin>[0], branchId, message);
  }
  return null;
}
