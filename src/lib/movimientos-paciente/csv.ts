import type { MovimientoVista } from "./consultar-tipos";

export const ETIQUETA_CATEGORIA: Record<string, string> = {
  citas: "Citas",
  perfil: "Perfil y datos personales",
  expediente: "Expediente clínico",
  archivos: "Archivos",
  dinero: "Facturación y pagos",
  otros: "Otros",
};

/**
 * Una celda de CSV a salvo: comillas dobles escapadas y, si empieza con
 * `= + - @` (o tab/retorno), se antepone un apóstrofo para que Excel no la
 * ejecute como fórmula. El nombre de quien hizo el cambio y la frase vienen de
 * datos de la clínica; un `=HYPERLINK(...)` en un nombre no debe correr.
 */
export function celdaCsv(valor: string): string {
  const seguro = /^[=+\-@\t\r]/.test(valor) ? `'${valor}` : valor;
  return `"${seguro.replace(/"/g, '""')}"`;
}

export function fechaHoraLegible(iso: string, zona: string): string {
  try {
    return new Intl.DateTimeFormat("es-MX", {
      timeZone: zona,
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function movimientosACsv(items: readonly MovimientoVista[], zona: string): string {
  const filas = [["Fecha y hora", "Quién", "Tipo", "Qué cambió"].map(celdaCsv).join(",")];
  for (const m of items) {
    filas.push(
      [fechaHoraLegible(m.fecha, zona), m.actor, ETIQUETA_CATEGORIA[m.categoria] ?? m.categoria, m.texto]
        .map(celdaCsv)
        .join(","),
    );
  }
  // BOM para que Excel abra el UTF-8 con acentos; CRLF, el fin de línea del formato.
  return "﻿" + filas.join("\r\n") + "\r\n";
}
