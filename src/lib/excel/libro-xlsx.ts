import * as ExcelJS from "exceljs";
import JSZip from "jszip";

// ═══════════════════════════════════════════════════════════════════════════
// Exportes .xlsx con exceljs (ws1-t12, auditoría H4).
//
// Sustituye a `xlsx` (SheetJS 0.18.5), que tiene dos avisos sin parche en npm
// y aquí solo servía para ESCRIBIR. Las tres descargas que la usaban
// (plantilla del importador, reporte de /admin, reporte de afiliados) pasan
// por aquí y salen IGUAL que antes para quien abre el archivo:
//
//  · Columnas en el orden de `encabezados` y, detrás, las claves de las filas
//    que no estén ahí, por orden de aparición — lo mismo que hacía
//    `XLSX.utils.json_to_sheet(filas, { header })`. Sin encabezados ni filas,
//    la hoja sale vacía (sin fila de títulos), también como antes.
//  · Un número se escribe como número y un texto como texto, tal cual: nada
//    de convertir "5551234567" o "1250.00" en número. `null`, `undefined` y
//    "" dejan la celda vacía (SheetJS escribía "" como una celda sin valor).
//  · `anchos` va en caracteres (el `wch` de SheetJS) y se convierte con su
//    misma fórmula, así que cada columna mide lo mismo que antes.
//  · SheetJS marcaba cada hoja con `numberStoredAsText` ignorado: Excel no
//    pinta el triángulo verde en teléfonos, folios o importes de la plantilla.
//    exceljs no sabe escribir `<ignoredErrors>`, así que se añade al XML.
//  · La letra por defecto de SheetJS era Calibri 12 y la de exceljs, Calibri
//    11 (sin opción para cambiarla): se ajusta en styles.xml. Excel mide el
//    ancho de columna con esa letra, así que también cuenta para los anchos.
// ═══════════════════════════════════════════════════════════════════════════

export type ValorCelda = string | number | boolean | null | undefined;

export interface HojaXlsx {
  nombre: string;
  filas: Record<string, ValorCelda>[];
  encabezados?: string[];
  /** Ancho de cada columna en caracteres, en el orden de las columnas. */
  anchos?: number[];
}

/** El `wch` de SheetJS en unidades de ancho de Excel (MDW = 6 px, su valor por defecto). */
function anchoDeSheetJs(wch: number): number {
  return Math.round(((wch * 6 + 5) / 6) * 256) / 256;
}

function columnasDe(hoja: HojaXlsx): string[] {
  const columnas = [...(hoja.encabezados ?? [])];
  for (const fila of hoja.filas) {
    for (const clave of Object.keys(fila)) {
      if (!columnas.includes(clave)) columnas.push(clave);
    }
  }
  return columnas;
}

// Orden de CT_Worksheet: <ignoredErrors> va antes de estos elementos.
const DESPUES_DE_IGNORED_ERRORS =
  /<(?:smartTags|drawing|legacyDrawing|legacyDrawingHF|drawingHF|picture|oleObjects|controls|webPublishItems|tableParts|extLst)\b|<\/worksheet>/;

export async function libroXlsx(hojas: HojaXlsx[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const rangos: string[] = [];

  for (const hoja of hojas) {
    const ws = wb.addWorksheet(hoja.nombre);
    const columnas = columnasDe(hoja);
    if (columnas.length > 0) {
      ws.addRow(columnas);
      for (const fila of hoja.filas) {
        const r = ws.addRow([]);
        columnas.forEach((col, i) => {
          const v = fila[col];
          if (v !== null && v !== undefined && v !== "") r.getCell(i + 1).value = v;
        });
      }
    }
    hoja.anchos?.forEach((wch, i) => {
      ws.getColumn(i + 1).width = anchoDeSheetJs(wch);
    });
    rangos.push(columnas.length > 0 ? ws.dimensions.range : "A1");
  }

  const zip = await JSZip.loadAsync(await wb.xlsx.writeBuffer());
  for (let i = 0; i < rangos.length; i++) {
    const ruta = `xl/worksheets/sheet${i + 1}.xml`;
    const xml = await zip.file(ruta)!.async("string");
    const marca = `<ignoredErrors><ignoredError numberStoredAsText="1" sqref="${rangos[i]}"/></ignoredErrors>`;
    const pos = xml.search(DESPUES_DE_IGNORED_ERRORS);
    zip.file(ruta, xml.slice(0, pos) + marca + xml.slice(pos));
  }
  const estilos = await zip.file("xl/styles.xml")!.async("string");
  zip.file("xl/styles.xml", estilos.replace(/(<fonts\b[^>]*><font>(?:(?!<\/font>).)*?<sz val=")11"/, (_, antes) => `${antes}12"`));
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}
