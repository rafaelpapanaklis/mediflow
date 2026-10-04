export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { SignatureClient } from "./signature-client";
import { menuDosNivelesEncendido } from "@/lib/menu-dos-niveles/interruptor";
import { direccionDeRebotePorRol } from "@/lib/auth/aviso-denegado";

export default async function SignatureSettingsPage() {
  const user = await getCurrentUser();
  if (!["DOCTOR", "ADMIN", "SUPER_ADMIN"].includes(user.role)) {
    redirect(direccionDeRebotePorRol("clinico")); // C-109: con motivo
  }

  // REDISEÑO (ws1-t2): el MISMO interruptor `menu-dos-niveles` de la clínica,
  // en el mismo Promise.all que el certificado (ni una consulta más; falla
  // cerrado → false = la pantalla de siempre).
  const [cert, rediseno] = await Promise.all([
    prisma.doctorSignatureCert.findUnique({
      where: { userId: user.id },
      select: {
        id: true, cerSerial: true, cerIssuer: true,
        validFrom: true, validUntil: true, rfc: true, isActive: true, createdAt: true,
      },
    }),
    menuDosNivelesEncendido(user.clinicId),
  ]);

  return (
    <SignatureClient
      cert={cert ? {
        ...cert,
        validFrom: cert.validFrom.toISOString(),
        validUntil: cert.validUntil.toISOString(),
        createdAt: cert.createdAt.toISOString(),
      } : null}
      rediseno={rediseno}
    />
  );
}
