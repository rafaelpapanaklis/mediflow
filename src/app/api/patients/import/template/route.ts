import { NextResponse } from "next/server";
import * as XLSX from "xlsx";

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/patients/import/template  (WS2-T2; ampliada en ws1-t4)
// Plantilla .xlsx con UNA HOJA POR TIPO DE DATO — Pacientes, Saldos, Citas,
// Expedientes, Notas y Presupuestos — cada una con sus encabezados + filas de
// muestra. La usa el flujo "Mi Excel / Otro" del wizard de importación.
//
// El motor lee cada entidad de SU pestaña (por el nombre de la hoja, ver
// `sheetNames` en src/lib/import/entities.ts), así que el mismo libro sirve
// para todo. Los encabezados son variantes que la autodetección de cada
// entidad reconoce (`headerVariants`): cambiarlos aquí obliga a mirarlos allí.
//
// `xlsx` (SheetJS) se usa SOLO para GENERAR (output de confianza); el PARSEO de
// archivos subidos va por exceljs (ver src/lib/import/engine.ts).
// ═══════════════════════════════════════════════════════════════════════════

export const runtime = "nodejs";

interface SheetDef {
  name: string;
  headers: string[];
  /** Filas de muestra (la de Presupuestos trae dos líneas del MISMO presupuesto). */
  rows: Record<string, string>[];
  widths: number[];
}

const TEMPLATE_SHEETS: SheetDef[] = [
  {
    name: "Pacientes",
    headers: ["nombre", "apellido", "email", "telefono", "fecha de nacimiento", "genero", "tipo sangre", "direccion", "notas"],
    rows: [{
      nombre: "María",
      apellido: "Hernández",
      email: "maria.h@example.com",
      telefono: "5551234567",
      "fecha de nacimiento": "15/03/1985",
      genero: "F",
      "tipo sangre": "O+",
      direccion: "Av. Reforma 123, CDMX",
      notas: "Alergia a penicilina",
    }],
    widths: [18, 18, 28, 14, 20, 8, 12, 32, 32],
  },
  {
    name: "Saldos",
    headers: ["nombre", "apellido", "telefono", "saldo", "tipo", "concepto", "fecha"],
    rows: [{
      nombre: "María",
      apellido: "Hernández",
      telefono: "5551234567",
      saldo: "1250.00",
      tipo: "adeudo", // adeudo | favor
      concepto: "Tratamiento de ortodoncia",
      fecha: "01/06/2026",
    }],
    widths: [18, 18, 14, 12, 10, 32, 14],
  },
  {
    name: "Citas",
    headers: ["nombre", "apellido", "telefono", "fecha", "hora", "motivo", "doctor"],
    rows: [{
      nombre: "María",
      apellido: "Hernández",
      telefono: "5551234567",
      fecha: "20/06/2026",
      hora: "10:30",
      motivo: "Limpieza dental",
      doctor: "Dr. Pérez",
    }],
    widths: [18, 18, 14, 14, 8, 28, 20],
  },
  {
    // Antecedentes de pacientes que YA existen. Varias alergias: separadas por «;».
    name: "Expedientes",
    headers: ["nombre", "apellido", "telefono", "alergias", "padecimientos", "medicamentos", "antecedentes heredofamiliares", "antecedentes no patologicos"],
    rows: [{
      nombre: "María",
      apellido: "Hernández",
      telefono: "5551234567",
      alergias: "Penicilina; Látex",
      padecimientos: "Hipertensión",
      medicamentos: "Losartán 50 mg",
      "antecedentes heredofamiliares": "Madre con diabetes tipo 2",
      "antecedentes no patologicos": "No fuma. Cepillado 2 veces al día",
    }],
    widths: [18, 18, 14, 24, 24, 24, 32, 32],
  },
  {
    // Notas de evolución de otro sistema: entran marcadas como MIGRADAS, con su fecha.
    name: "Notas",
    headers: ["nombre", "apellido", "telefono", "fecha", "doctor", "titulo", "nota"],
    rows: [{
      nombre: "María",
      apellido: "Hernández",
      telefono: "5551234567",
      fecha: "12/03/2024",
      doctor: "Dr. Pérez",
      titulo: "Resina en 16",
      nota: "Paciente refiere sensibilidad al frío. Se coloca resina oclusal en 16. Sin complicaciones.",
    }],
    widths: [18, 18, 14, 14, 20, 24, 60],
  },
  {
    // Una fila por LÍNEA. Las filas con el mismo paciente y folio forman un presupuesto.
    name: "Presupuestos",
    headers: ["nombre", "apellido", "telefono", "folio", "fecha", "titulo", "procedimiento", "pieza", "cantidad", "precio", "descuento", "estado", "doctor"],
    rows: [
      {
        nombre: "María",
        apellido: "Hernández",
        telefono: "5551234567",
        folio: "1043",
        fecha: "05/02/2024",
        titulo: "Rehabilitación",
        procedimiento: "Resina simple",
        pieza: "16",
        cantidad: "1",
        precio: "850.00",
        descuento: "0",
        estado: "Aprobado",
        doctor: "Dr. Pérez",
      },
      {
        nombre: "María",
        apellido: "Hernández",
        telefono: "5551234567",
        folio: "1043",
        fecha: "05/02/2024",
        titulo: "Rehabilitación",
        procedimiento: "Profilaxis",
        pieza: "",
        cantidad: "1",
        precio: "600.00",
        descuento: "100",
        estado: "Aprobado",
        doctor: "Dr. Pérez",
      },
    ],
    widths: [18, 18, 14, 10, 14, 20, 28, 8, 10, 12, 12, 12, 20],
  },
];

export async function GET() {
  const wb = XLSX.utils.book_new();

  for (const def of TEMPLATE_SHEETS) {
    const ws = XLSX.utils.json_to_sheet(def.rows, { header: def.headers });
    ws["!cols"] = def.widths.map((wch) => ({ wch }));
    XLSX.utils.book_append_sheet(wb, ws, def.name);
  }

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  const body = new Uint8Array(buf);

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="plantilla-dalecontrol.xlsx"',
    },
  });
}
