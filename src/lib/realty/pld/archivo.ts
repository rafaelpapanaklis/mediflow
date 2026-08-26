// ═══════════════════════════════════════════════════════════════════════
// DaleControl INMUEBLES · PLD — EL ARCHIVO DEL AVISO.
//
// ── 🔴 LO QUE ESTE ARCHIVO ES, Y LO QUE DELIBERADAMENTE NO ES ─────────
//
// LO QUE ES: una HOJA DE CONCENTRADO. Junta, ya ordenados, los datos que el
// portal del SAT pide capturar del periodo: las operaciones que rebasaron
// el umbral y los datos de identificación de cada cliente. Sale en CSV
// porque es lo que se abre en Excel sin instalar nada y lo que un oficial
// de cumplimiento puede revisar renglón por renglón antes de capturar.
//
// LO QUE **NO** ES: el XML oficial del aviso. NO se genera, y no es un
// pendiente ni un recorte de alcance — es una decisión.
//
// El formato del acuse del SAT (el esquema XSD del Anexo, sus catálogos de
// claves, sus reglas de validación) es un documento normativo que hay que
// leer, versionar y probar contra el validador real del portal. Un XML
// generado "de memoria" tiene dos finales posibles, y los dos son malos:
//   · lo rechaza el portal → la inmobiliaria pierde el día del corte
//     peleando con un archivo que le vendimos como listo;
//   · lo ACEPTA con los campos mal mapeados → declaró datos incorrectos
//     ante la autoridad, y la responsabilidad es suya.
// El segundo es el caro. Un CSV que nadie confunde con un acuse oficial es
// honesto; un XML que parece oficial y no lo es, no.
//
// Cuando alguien confronte el esquema vigente contra el validador del
// portal, esto se amplía. Hasta entonces, el archivo dice en su primera
// línea qué es y qué no es, y la pantalla lo repite junto al botón.
//
// ── 🔴 EL ARCHIVO NO LO PRESENTA DALECONTROL ──────────────────────────
// Lo baja el cliente y lo sube ÉL en el portal. La leyenda va DENTRO del
// archivo, no solo en la pantalla: el CSV se reenvía por correo y llega a
// gente que nunca vio nuestro botón.
//
// ── 🔴 EL CSV SE ESCAPA CONTRA INYECCIÓN DE FÓRMULAS ──────────────────
// Un nombre de contacto que empiece por "=", "+", "-" o "@" se convierte en
// una fórmula viva al abrir el archivo en Excel. Aquí los datos son nombres
// y direcciones que capturó cualquiera, así que se neutralizan todos.
// ═══════════════════════════════════════════════════════════════════════
import "server-only";
import { prisma } from "@/lib/prisma";
import type { RealtyContext } from "@/lib/realty-auth";
import { fmtMXN2, toCents } from "@/lib/realty/calc/money";
import {
  LEYENDA_DESCARGA_AVISO,
  PLD_ESTADO_LABELS,
  PLD_NIVEL_LABELS,
  PLD_PEP_LABELS,
  PLD_PERSON_KIND_LABELS,
  type OperacionRow,
} from "./contrato";
import { etiquetaPeriodo, umbralesEnPesos, type PldParams } from "./umbrales";
import { leerBeneficiarios } from "./expedientes";

/**
 * Neutraliza una celda de CSV.
 *
 * Dos cosas distintas, y las dos hacen falta:
 *   1. INYECCIÓN DE FÓRMULAS — un valor que empieza por = + - @ (o por tab
 *      / retorno de carro, que Excel se come antes de mirar) se prefija con
 *      una comilla simple. Sin esto, "=1+1" se ejecuta al abrir el archivo.
 *   2. COMILLAS Y SALTOS — se duplica la comilla y se envuelve todo, que es
 *      lo que dice el RFC 4180.
 */
export function celdaCsv(valor: unknown): string {
  let s = valor === null || valor === undefined ? "" : String(valor);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

function fila(celdas: unknown[]): string {
  return celdas.map(celdaCsv).join(",");
}

export interface ArchivoAviso {
  nombre: string;
  contenido: string;
  /** Cuántas operaciones trae. 0 = informe en ceros. */
  operaciones: number;
}

/**
 * Arma la hoja de concentrado de un periodo.
 *
 * Trae las operaciones que REBASAN el umbral de aviso —las demás no se
 * reportan— y, por cada una, los datos del expediente de su cliente. Si el
 * expediente no está integrado, el renglón SALE IGUAL con los huecos
 * marcados "FALTA": esconder la operación incompleta sería fabricar un
 * archivo que se ve limpio y no lo está.
 */
export async function generarArchivoAviso(
  ctx: RealtyContext,
  periodMonth: string,
  operaciones: OperacionRow[],
  params: PldParams,
): Promise<ArchivoAviso> {
  const delMes = operaciones.filter((o) => o.periodMonth === periodMonth && o.requiereAviso);
  const umbrales = umbralesEnPesos(params);

  // Los expedientes de los clientes que salen en el archivo, de una sola
  // consulta. `in` con arreglo VACÍO devuelve cero filas, que es lo correcto
  // para un informe en ceros — pero se corta antes para no pegarle a la base.
  const contactIds = Array.from(
    new Set(delMes.map((o) => o.contactId).filter((v): v is string => !!v)),
  );
  const expedientes = contactIds.length
    ? await prisma.realtyPldFile.findMany({
        where: { accountId: ctx.accountId, contactId: { in: contactIds } },
        select: {
          contactId: true,
          personKind: true,
          rfc: true,
          curp: true,
          nationality: true,
          occupation: true,
          address: true,
          pep: true,
          pepDetail: true,
          beneficialOwners: true,
        },
      })
    : [];
  const porContacto = new Map(expedientes.map((e) => [e.contactId, e]));

  const cuenta = ctx.account;
  const FALTA = "FALTA";
  const lineas: string[] = [];

  // ── Encabezado: qué es esto, de quién y con qué números se comparó ──
  lineas.push(fila(["HOJA DE CONCENTRADO PARA EL AVISO — NO ES EL ARCHIVO OFICIAL DEL SAT"]));
  lineas.push(fila([LEYENDA_DESCARGA_AVISO]));
  lineas.push(
    fila([
      "Este documento reúne los datos del periodo para que los captures en el portal. " +
        "El formato oficial del aviso lo define la autoridad: confírmalo con tu oficial de cumplimiento.",
    ]),
  );
  lineas.push("");
  lineas.push(fila(["Inmobiliaria", cuenta.legalName || cuenta.name]));
  lineas.push(fila(["Periodo que se reporta", etiquetaPeriodo(periodMonth), periodMonth]));
  lineas.push(
    fila([
      "Tipo de informe",
      delMes.length > 0 ? "Con operaciones" : "EN CEROS (sin operaciones que avisar)",
    ]),
  );
  lineas.push(fila(["Operaciones incluidas", delMes.length]));
  lineas.push("");

  // Los parámetros con los que se comparó viajan DENTRO del archivo: dentro
  // de un año nadie se acordará de con qué UMA se sacó este corte, y sin eso
  // el archivo no se puede auditar.
  lineas.push(fila(["PARÁMETROS CON LOS QUE SE COMPARÓ"]));
  lineas.push(fila(["UMA diaria del año " + params.year, fmtMXN2(params.umaDiariaCents)]));
  lineas.push(
    fila([
      `Umbral de identificación (${params.identificacionUma} UMA)`,
      fmtMXN2(umbrales.identificacionCents),
    ]),
  );
  lineas.push(fila([`Umbral de aviso (${params.avisoUma} UMA)`, fmtMXN2(umbrales.avisoCents)]));
  lineas.push(
    fila([`Tope de efectivo (${params.efectivoUma} UMA)`, fmtMXN2(umbrales.efectivoCents)]),
  );
  if (params.porVerificar) {
    lineas.push(
      fila([
        "ADVERTENCIA",
        "Estos umbrales están marcados como NO VERIFICADOS contra el texto vigente de la ley.",
      ]),
    );
  }
  lineas.push("");

  if (delMes.length === 0) {
    lineas.push(fila(["SIN OPERACIONES QUE AVISAR EN ESTE PERIODO"]));
    lineas.push(
      fila([
        "Un mes sin operaciones TAMBIÉN se reporta. No presentar el informe en ceros se sanciona " +
          "igual que no presentar un aviso con operaciones.",
      ]),
    );
    return {
      nombre: `aviso-${periodMonth}-en-ceros.csv`,
      contenido: conBom(lineas.join("\r\n")),
      operaciones: 0,
    };
  }

  // ── El detalle ──────────────────────────────────────────────────────
  lineas.push(fila(["DETALLE DE LAS OPERACIONES"]));
  lineas.push(
    fila([
      "Fecha de cierre",
      "Tipo",
      "Inmueble",
      "Monto",
      "Efectivo",
      "Efectivo sobre el tope",
      "Nivel de umbral",
      "Cliente",
      "Tipo de persona",
      "RFC",
      "CURP",
      "Nacionalidad",
      "Ocupación o giro",
      "Domicilio",
      "PEP",
      "Detalle PEP",
      "Beneficiario controlador",
      "Estado del expediente",
    ]),
  );

  const fecha = new Intl.DateTimeFormat("es-MX", {
    dateStyle: "short",
    timeZone: cuenta.timezone || "America/Mexico_City",
  });

  for (const o of delMes) {
    const e = o.contactId ? porContacto.get(o.contactId) : null;
    const beneficiarios = e ? leerBeneficiarios(e.beneficialOwners) : [];
    lineas.push(
      fila([
        o.closedAt ? fecha.format(new Date(o.closedAt)) : FALTA,
        o.kind === "VENTA" ? "Venta" : "Renta",
        o.propertyTitle,
        fmtMXN2(toCents(o.amount)),
        fmtMXN2(toCents(o.efectivo)),
        o.efectivoProhibido ? "SÍ — PROHIBIDO POR LA LEY" : "No",
        PLD_NIVEL_LABELS[o.nivel],
        o.contactName ?? FALTA,
        e ? PLD_PERSON_KIND_LABELS[e.personKind] : FALTA,
        e?.rfc || FALTA,
        e?.curp || FALTA,
        e?.nationality || FALTA,
        e?.occupation || FALTA,
        e?.address || FALTA,
        e ? PLD_PEP_LABELS[e.pep] : FALTA,
        e?.pepDetail || "",
        beneficiarios.length
          ? beneficiarios
              .map((b) => `${b.name}${b.pct != null ? ` (${b.pct}%)` : ""}`)
              .join(" · ")
          : e && e.personKind !== "FISICA"
            ? FALTA
            : "No aplica",
        o.estadoExpediente ? PLD_ESTADO_LABELS[o.estadoExpediente] : "Sin expediente",
      ]),
    );
  }

  const incompletas = delMes.filter((o) => o.estadoExpediente !== "COMPLETO").length;
  if (incompletas > 0) {
    lineas.push("");
    lineas.push(
      fila([
        `ATENCIÓN: ${incompletas} de estas ${delMes.length} operaciones tienen el expediente sin integrar. ` +
          'Los huecos salen marcados como "FALTA" y hay que completarlos antes de capturar el aviso.',
      ]),
    );
  }

  return {
    nombre: `aviso-${periodMonth}.csv`,
    contenido: conBom(lineas.join("\r\n")),
    operaciones: delMes.length,
  };
}

/**
 * BOM de UTF-8. Sin él, Excel en Windows abre el CSV en la codificación del
 * sistema y "Ocupación" sale como "OcupaciÃ³n" — en un archivo que alguien
 * va a capturar a mano ante la autoridad, eso no es cosmético.
 */
function conBom(texto: string): string {
  return `﻿${texto}`;
}
