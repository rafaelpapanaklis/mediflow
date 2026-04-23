import { NextResponse } from "next/server";
import * as XLSX from "xlsx";

export const runtime = "nodejs";

export async function GET() {
  const rows = [
    {
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
    {
      nombre: "Juan",
      apellido: "Pérez",
      email: "juan.perez@example.com",
      telefono: "5559876543",
      "fecha de nacimiento": "22/07/1990",
      genero: "M",
      "tipo sangre": "A-",
      direccion: "",
      notas: "",
    },
  ];

  const ws = XLSX.utils.json_to_sheet(rows, {
    header: ["nombre", "apellido", "email", "telefono", "fecha de nacimiento", "genero", "tipo sangre", "direccion", "notas"],
  });
  ws["!cols"] = [
    { wch: 18 }, { wch: 18 }, { wch: 28 }, { wch: 14 }, { wch: 20 },
    { wch: 8 }, { wch: 12 }, { wch: 32 }, { wch: 32 },
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Pacientes");

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  const body = new Uint8Array(buf);

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="plantilla-pacientes.xlsx"',
    },
  });
}
