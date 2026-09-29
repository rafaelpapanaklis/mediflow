// Reporte de errores de una importación (ws1-t10). Puro: sin DOM ni React; `descargarReporte` es lo único que toca el
// navegador. Antes «Descargar reporte» no descargaba nada (`errorReportUrl` nunca existió): el motor ya devolvía las
// filas con error y su motivo, pero el cliente las tiraba.
import { neutralizeFormulaPrefix } from "@/lib/import/spreadsheet-safety";
import type { CommitResult, Entity, ErrorDeFila } from "./import-client";

/** «06.csv» + pestaña «Presupuestos» → «06.csv · Presupuestos»; el nombre que ve quien importa. */
export function nombreDelArchivo(file: { name?: string } | null | undefined, sheet?: string | null): string {
  const nombre = (file?.name ?? "").trim();
  const hoja = (sheet ?? "").trim();
  return hoja ? `${nombre} · ${hoja}` : nombre;
}

/** Todas las filas con error de un resultado (o de varios: un asistente que importa un archivo por entidad). */
export function filasConError(resultados: Array<CommitResult | undefined | null>): ErrorDeFila[] {
  const salida: ErrorDeFila[] = [];
  for (const r of resultados) if (r?.errorRows) salida.push(...r.errorRows);
  return salida;
}

/** Las filas agrupadas por archivo (y entidad), en el orden en que aparecieron, cada grupo ordenado por fila. */
export function agruparPorArchivo(filas: ErrorDeFila[]): Array<{ fileName: string; entity: Entity; filas: ErrorDeFila[] }> {
  const grupos = new Map<string, { fileName: string; entity: Entity; filas: ErrorDeFila[] }>();
  for (const f of filas) {
    const k = `${f.fileName}\u0000${f.entity}`;
    const g = grupos.get(k);
    if (g) g.filas.push(f);
    else grupos.set(k, { fileName: f.fileName, entity: f.entity, filas: [f] });
  }
  const lista = Array.from(grupos.values());
  for (const g of lista) g.filas.sort((a, b) => a.row - b.row);
  return lista;
}

/**
 * Dentro de un archivo, las filas que fallaron por el MISMO motivo van juntas («Filas 2, 3, 4, 5, 6: …»): un caso
 * de ortodoncia con 5 renglones no se cuenta como 5 problemas distintos. Orden: por la primera fila de cada motivo.
 */
export function agruparPorMotivo(filas: ErrorDeFila[]): Array<{ motivo: string; filas: number[] }> {
  const motivos = new Map<string, number[]>();
  for (const f of [...filas].sort((a, b) => a.row - b.row)) {
    for (const m of f.errors.length > 0 ? f.errors : ["Sin motivo registrado"]) {
      const lista = motivos.get(m);
      if (lista) { if (!lista.includes(f.row)) lista.push(f.row); } else motivos.set(m, [f.row]);
    }
  }
  return Array.from(motivos, ([motivo, rows]) => ({ motivo, filas: rows }));
}

/** Una celda de CSV: sin fórmulas ejecutables (`=`, `+`, `-`, `@`), entre comillas si trae coma, comilla o salto. */
export function celdaCsv(valor: unknown): string {
  const t = neutralizeFormulaPrefix(String(valor ?? ""));
  return /[",\r\n;]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}

/**
 * El CSV del reporte: una línea por fila con error y por motivo. Con BOM UTF-8 para que Excel respete los acentos.
 * `etiquetaDeEntidad` traduce la clave de la entidad («treatmentPlans» → «Tratamientos activos»).
 */
export function armarReporteCsv(filas: ErrorDeFila[], etiquetaDeEntidad: (e: Entity) => string = (e) => e): string {
  const lineas = [["Archivo", "Datos", "Fila", "Motivo"].map(celdaCsv).join(",")];
  for (const f of filas) {
    const motivos = f.errors.length > 0 ? f.errors : ["Sin motivo registrado"];
    for (const m of motivos) lineas.push([f.fileName, etiquetaDeEntidad(f.entity), f.row > 0 ? f.row : "Todo el archivo", m].map(celdaCsv).join(","));
  }
  return "﻿" + lineas.join("\r\n") + "\r\n";
}

/** «reporte-de-errores-2026-09-29.csv» (la fecha en la zona del navegador, como la ve quien importa). */
export function nombreDelReporte(ahora: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `reporte-de-errores-${ahora.getFullYear()}-${p(ahora.getMonth() + 1)}-${p(ahora.getDate())}.csv`;
}

/** Baja el CSV en el navegador. Devuelve false si no hay nada que bajar (el llamador lo dice en pantalla). */
export function descargarReporte(filas: ErrorDeFila[], etiquetaDeEntidad?: (e: Entity) => string): boolean {
  if (filas.length === 0 || typeof document === "undefined") return false;
  const blob = new Blob([armarReporteCsv(filas, etiquetaDeEntidad)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nombreDelReporte();
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Firefox necesita que la URL siga viva un instante tras el click.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}
