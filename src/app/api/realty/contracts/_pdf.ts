import "server-only";

// ═══════════════════════════════════════════════════════════════════════
// EL PDF, ARMADO UNA SOLA VEZ PARA LOS DOS LADOS.
//
// Lo piden dos rutas muy distintas:
//   · el panel  → /api/realty/contracts/[id]/pdf   (con sesión)
//   · el que firma → /api/realty/signatures/[token]/pdf  (con la liga)
//
// 🔴 POR ESO EL BUILDER RECIBE accountId Y NO UN RealtyContext. Quien
// entra por la liga NO tiene sesión y no debe poder fabricarse una: su
// accountId sale del token, resuelto contra la base. Si este archivo
// aceptara un contexto, la ruta pública tendría que inventarse uno — y ahí
// es donde se cuelan los "por ahora paso el accountId que venga".
//
// El PDF se genera AL VUELO y no se guarda: el documento vive en la tabla y
// su prueba es el sha256 del texto. Un PDF guardado sería una copia más que
// mantener sincronizada, con el riesgo de que un día no coincida.
// ═══════════════════════════════════════════════════════════════════════

import { renderToBuffer } from "@react-pdf/renderer";
import { createElement } from "react";
import { prisma } from "@/lib/prisma";
import { contractForPdf, signaturesForPdf } from "@/lib/realty/contracts";
import { hashMatches } from "@/lib/realty/signature";
import {
  ContractDocument,
  type ContractPdfSignature,
} from "@/components/realty/contracts/contract-pdf";

/** Nombre de archivo sin acentos ni espacios: viaja por una cabecera HTTP. */
function fileNameFor(folio: string, title: string): string {
  const limpio = String(title ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${folio}${limpio ? `-${limpio}` : ""}.pdf`;
}

export async function buildContractPdf(
  accountId: string,
  contractId: string,
): Promise<{ buffer: Buffer; fileName: string } | null> {
  const contract = await contractForPdf(accountId, contractId);
  if (!contract) return null;

  const [account, strokes] = await Promise.all([
    prisma.realtyAccount.findUnique({
      where: { id: accountId },
      select: {
        name: true,
        legalName: true,
        address: true,
        city: true,
        state: true,
        phone: true,
        email: true,
        timezone: true,
      },
    }),
    signaturesForPdf(accountId, contractId),
  ]);

  const porParte = new Map(strokes.map((s) => [s.partyId, s]));

  // Se recorren las PARTES y no las firmas: así una parte que todavía no
  // firma sale con su línea en blanco y su nombre debajo, que es lo que
  // convierte este PDF también en la hoja para firmar en papel cuando
  // alguien no quiere hacerlo en el celular.
  const signatures: ContractPdfSignature[] = contract.parties.map((p) => {
    const s = porParte.get(p.id);
    return {
      role: p.role,
      name: p.name,
      dataUrl: s?.dataUrl || null,
      signedAt: s?.signedAt ? s.signedAt.toISOString() : p.signedAt ? p.signedAt.toISOString() : null,
      ip: s?.ip ?? null,
      userAgent: s?.userAgent ?? null,
      documentHash: s?.documentHash ?? null,
      matchesCurrent: s ? hashMatches(s.documentHash, contract.documentHash) : true,
    };
  });

  const required = contract.parties.filter((p) => p.mustSign).length;
  const signed = contract.parties.filter((p) => p.mustSign && p.signedAt).length;

  const buffer = await renderToBuffer(
    createElement(ContractDocument, {
      accountName: account?.name ?? contract.accountName,
      accountLegalName: account?.legalName ?? null,
      accountAddress: [account?.address, account?.city, account?.state].filter(Boolean).join(", ") || null,
      accountPhone: account?.phone ?? null,
      accountEmail: account?.email ?? null,
      kind: contract.kind,
      status: contract.status,
      folio: contract.folio,
      title: contract.title,
      body: contract.body,
      documentHash: contract.documentHash,
      timeZone: account?.timezone || "America/Mexico_City",
      createdAt: contract.createdAt.toISOString(),
      signedAt: contract.signedAt ? contract.signedAt.toISOString() : null,
      voidedAt: contract.voidedAt ? contract.voidedAt.toISOString() : null,
      voidReason: contract.voidReason,
      signatures,
      signed,
      required,
    }),
  );

  return { buffer, fileName: fileNameFor(contract.folio, contract.title) };
}
