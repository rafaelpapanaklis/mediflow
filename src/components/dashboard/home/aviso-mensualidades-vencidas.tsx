"use client";

// Ortodoncia — Recepción (ws1-t5, Ola 1): R3, aviso en la pantalla Hoy de
// mensualidades vencidas. Se calla solo si no hay ninguna, y no manda nada al
// paciente (solo para el equipo). El número sale de la MISMA lectura que Caja
// (`listarMensualidadesPorCobrar`, R2) para que Hoy y Caja nunca digan cosas
// distintas.
//
// Ronda 6 (ws1-t5, 28-sep-2026): el aviso vive ahora en `OrtodonciaEnHoy`,
// junto al de los controles de hoy, y ya no manda siempre a Caja: quien puede
// entrar al módulo va a Ortodoncia → Cobranza; recepción sin ese permiso
// sigue yendo a Caja → Facturas, al ancla de `ListaMensualidades`
// (`#mensualidades-ortodoncia`). Este archivo se queda como la puerta de
// siempre para los cuatro «Hoy» que ya lo montan.

import { OrtodonciaEnHoy } from "./ortodoncia-en-hoy";

export function AvisoMensualidadesVencidas() {
  return <OrtodonciaEnHoy />;
}
