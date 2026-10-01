/**
 * CSV que Excel de Windows abre bien: BOM UTF-8 (sin él «Teléfono» sale
 * «TelÃ©fono»), CRLF y cada texto entre comillas con las comillas internas
 * duplicadas. Un texto que empieza con `= + - @` (o tab/retorno) lleva un
 * apóstrofo delante para que Excel no lo ejecute como fórmula: nombres y
 * correos vienen de datos de la clínica.
 */
export const BOM_UTF8 = "﻿";

/** Un texto como celda de CSV. Los números van sin comillas (`numeroCsv`) para que Excel los sume. */
export function celdaCsv(valor: string | null | undefined): string {
  const t = String(valor ?? "");
  const seguro = /^[=+\-@\t\r]/.test(t) ? `'${t}` : t;
  return `"${seguro.replace(/"/g, '""')}"`;
}

/** Filas de celdas → texto del archivo: números crudos, el resto como `celdaCsv`. */
export function armarCsvExcel(filas: ReadonlyArray<ReadonlyArray<string | number | null | undefined>>): string {
  const lineas = filas.map((fila) =>
    fila.map((c) => (typeof c === "number" && Number.isFinite(c) ? String(c) : celdaCsv(typeof c === "number" ? "" : c))).join(","),
  );
  return BOM_UTF8 + lineas.join("\r\n") + "\r\n";
}
