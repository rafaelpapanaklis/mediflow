export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { SignatureClient } from "./signature-client";

export default async function SignatureSettingsPage() {
  const user = await getCurrentUser();
  if (!["DOCTOR", "ADMIN", "SUPER_ADMIN"].includes(user.role)) {
    redirect("/dashboard");
  }

  const cert = await prisma.doctorSignatureCert.findUnique({
    where: { userId: user.id },
    select: {
      id: true, cerSerial: true, cerIssuer: true,
      validFrom: true, validUntil: true, rfc: true, isActive: true, createdAt: true,
    },
  });

  return (
    <SignatureClient
      cert={cert ? {
        ...cert,
        validFrom: cert.validFrom.toISOString(),
        validUntil: cert.validUntil.toISOString(),
        createdAt: cert.createdAt.toISOString(),
      } : null}
    />
  );
}
