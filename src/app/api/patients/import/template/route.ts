import { NextResponse } from "next/server";
import * as XLSX from "xlsx";

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/patients/import/template  (WS2-T2)
// Plantilla .xlsx con TRES hojas — Pacientes, Saldos, Citas — cada una con
// encabezados de ejemplo + una fila de muestra. La usa el flujo "Mi Excel /
// Otro" del wizard de importación.
//
// `xlsx` (SheetJS) se usa SOLO para GENERAR (output de confianza); el PARSEO de
// archivos subidos va por exceljs (ver src/app/api/patients/import/route.ts).
// Los encabezados de "Pacientes" coinciden con los que reconoce ese importador.
// ═══════════════════════════════════════════════════════════════════════════

export const runtime = "nodejs";

interface SheetDef {
  name: string;
  headers: string[];
  sample: Record<string, string>;
  widths: number[];
}

const SHEETS: SheetDef[] = [
  {
    name: "Pacientes",
    headers: ["nombre", "apellido", "email", "telefono", "fecha de nacimiento", "genero", "tipo sangre", "direccion", "notas"],
    sample: {
      nombre: "María",
      apellido: "Hernández",
      email: "maria.h@example.com",
      telefono: "5551234567",
      "fecha de nacimiento": "15/03/1985",
      genero: "F",
      "tipo sangre": "O+",
      direccion: "Av. Reforma 123, CDMX",
      notas: "Alergia a penicilina",
    },
    widths: [18, 18, 28, 14, 20, 8, 12, 32, 32],
  },
  {
    name: "Saldos",
    headers: ["nombre", "apellido", "telefono", "saldo", "tipo", "concepto", "fecha"],
    sample: {
      nombre: "María",
      apellido: "Hernández",
      telefono: "5551234567",
      saldo: "1250.00",
      tipo: "adeudo", // adeudo | favor
      concepto: "Tratamiento de ortodoncia",
      fecha: "01/06/2026",
    },
    widths: [18, 18, 14, 12, 10, 32, 14],
  },
  {
    name: "Citas",
    headers: ["nombre", "apellido", "telefono", "fecha", "hora", "motivo", "doctor"],
    sample: {
      nombre: "María",
      apellido: "Hernández",
      telefono: "5551234567",
      fecha: "20/06/2026",
      hora: "10:30",
      motivo: "Limpieza dental",
      doctor: "Dr. Pérez",
    },
    widths: [18, 18, 14, 14, 8, 28, 20],
  },
];

export async function GET() {
  const wb = XLSX.utils.book_new();

  for (const def of SHEETS) {
    const ws = XLSX.utils.json_to_sheet([def.sample], { header: def.headers });
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
