import "server-only";
import { prisma } from "@/lib/prisma";
import { labelParentesco } from "@/lib/consent/default-signer";
import { normalizarFiscales, type DatosFiscales, type ResponsableParaCfdi } from "./receptor-responsable";

// Ortodoncia — ws1-t10, punto 9. Lee y guarda los datos fiscales del responsable
// de pago de la factura de un caso. Las columnas (`sql/ortodoncia-responsable-
// fiscal.sql`) NO están declaradas en schema.prisma a propósito: con una
// columna de menos, un `select` normal de Guardian tiraría P2022 en TODA la
// app. Van por SQL crudo con una sonda de columna, como el catálogo de ortodoncia.

let sonda: { existe: boolean; at: number } | null = null;
const TTL_MS = 60_000;

async function columnasExisten(): Promise<boolean> {
  const t = Date.now();
  if (sonda && (sonda.existe || t - sonda.at < TTL_MS)) return sonda.existe;
  try {
    const filas = await prisma.$queryRaw<{ existe: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_name = 'ped_guardians' AND column_name = 'rfcFiscal'
      ) AS existe`;
    sonda = { existe: filas[0]?.existe === true, at: t };
    return sonda.existe;
  } catch (e) {
    console.warn("[ortodoncia:responsable-fiscal] no se pudo comprobar la columna:", e);
    return false;
  }
}

/** Solo para pruebas. */
export function _olvidarSonda(): void {
  sonda = null;
}

/** El id del responsable de pago del caso cuya factura es `invoiceId` (de esta clínica), o null. */
async function responsableDeLaFactura(clinicId: string, invoiceId: string): Promise<string | null> {
  if (!clinicId || !invoiceId) return null;
  try {
    const plan = await prisma.orthodonticTreatmentPlan.findFirst({
      where: { clinicId, invoiceId, deletedAt: null },
      select: { responsibleGuardianId: true },
    });
    return plan?.responsibleGuardianId ?? null;
  } catch (e) {
    const code = (e as { code?: string } | null)?.code;
    if (code === "P2021" || code === "P2022") return null;
    throw e;
  }
}

export async function leerResponsableParaCfdi(
  clinicId: string,
  invoiceId: string,
): Promise<{ responsable: ResponsableParaCfdi | null; columnasListas: boolean }> {
  const columnasListas = await columnasExisten();
  const guardianId = await responsableDeLaFactura(clinicId, invoiceId);
  if (!guardianId) return { responsable: null, columnasListas };
  const g = await prisma.guardian.findFirst({
    where: { id: guardianId, clinicId, deletedAt: null },
    select: { id: true, fullName: true, parentesco: true, email: true },
  });
  if (!g) return { responsable: null, columnasListas };

  let fiscales: DatosFiscales = { rfc: "", nombre: "", regimen: "", cp: "" };
  if (columnasListas) {
    const filas = await prisma.$queryRaw<
      { rfcFiscal: string | null; razonSocialFiscal: string | null; regimenFiscal: string | null; cpFiscal: string | null }[]
    >`SELECT "rfcFiscal", "razonSocialFiscal", "regimenFiscal", "cpFiscal" FROM "ped_guardians" WHERE "id" = ${g.id} AND "clinicId" = ${clinicId}`;
    const f = filas[0];
    if (f) fiscales = normalizarFiscales({ rfc: f.rfcFiscal ?? "", nombre: f.razonSocialFiscal ?? "", regimen: f.regimenFiscal ?? "", cp: f.cpFiscal ?? "" });
  }
  return {
    columnasListas,
    responsable: {
      guardianId: g.id,
      nombreCompleto: g.fullName,
      parentesco: labelParentesco(g.parentesco),
      email: g.email,
      fiscales,
    },
  };
}

/** Guarda los fiscales del responsable de la factura. `sinColumnas` = falta pegar el SQL. */
export async function guardarFiscalesDelResponsable(
  clinicId: string,
  invoiceId: string,
  datos: Partial<DatosFiscales>,
): Promise<{ ok: true } | { ok: false; motivo: "sin-responsable" | "sin-columnas" }> {
  const guardianId = await responsableDeLaFactura(clinicId, invoiceId);
  if (!guardianId) return { ok: false, motivo: "sin-responsable" };
  if (!(await columnasExisten())) return { ok: false, motivo: "sin-columnas" };
  const d = normalizarFiscales(datos);
  const n = await prisma.$executeRaw`
    UPDATE "ped_guardians"
       SET "rfcFiscal" = ${d.rfc || null}, "razonSocialFiscal" = ${d.nombre || null},
           "regimenFiscal" = ${d.regimen || null}, "cpFiscal" = ${d.cp || null}
     WHERE "id" = ${guardianId} AND "clinicId" = ${clinicId}`;
  return n > 0 ? { ok: true } : { ok: false, motivo: "sin-responsable" };
}
