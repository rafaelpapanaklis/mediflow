// POST /api/consent/public/[token]/witness — testigos del acto.
//
// La NOM-004-SSA3-2012 numeral 10.1.1.7 incluye el nombre y la firma de los
// testigos en la carta de consentimiento. En la práctica son las dos personas
// que estaban en el consultorio cuando el paciente firmó, así que se capturan
// en la MISMA tableta, justo después de su firma — no en el panel horas
// después, que sería firmar algo que no se presenció.
//
// Por eso:
//   · solo se admiten DESPUÉS de que el paciente firmó;
//   · solo mientras la liga sigue viva (una carta firmada hace tres semanas ya
//     no puede estrenar testigos presenciales);
//   · un espacio ya ocupado NO se puede repisar.
//
// Es opcional: una firma a distancia no lleva testigos, y el panel lo muestra
// como "Testigos 0/2" en vez de bloquear nada.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";
import { signaturePath, uploadSignature, validateSignatureDataUrl } from "@/lib/consent/signature";

const MAX_NAME = 120;

export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  const rl = rateLimit(req, 10);
  if (rl) return rl;

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const slot = Number(body.witness);
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (slot !== 1 && slot !== 2) {
    return NextResponse.json({ error: "Testigo inválido" }, { status: 400 });
  }
  if (!name) {
    return NextResponse.json({ error: "Escribe el nombre del testigo." }, { status: 400 });
  }

  const form = await prisma.consentForm.findUnique({
    where: { token: params.token },
    select: {
      id: true, clinicId: true, deletedAt: true, expiresAt: true,
      signedAt: true, revokedAt: true,
      witness1SignedAt: true, witness2SignedAt: true,
    },
  });
  if (!form || form.deletedAt) {
    return NextResponse.json({ error: "Formulario no encontrado" }, { status: 404 });
  }
  if (new Date() > form.expiresAt) {
    return NextResponse.json({ error: "El enlace ha expirado" }, { status: 410 });
  }
  if (!form.signedAt) {
    return NextResponse.json(
      { error: "Primero debe firmar el paciente." },
      { status: 409 },
    );
  }
  if (form.revokedAt) {
    return NextResponse.json({ error: "Este consentimiento fue revocado." }, { status: 409 });
  }
  const taken = slot === 1 ? form.witness1SignedAt : form.witness2SignedAt;
  if (taken) {
    return NextResponse.json({ error: "Ese testigo ya firmó." }, { status: 409 });
  }

  const check = await validateSignatureDataUrl(body.signatureDataUrl);
  if (check.error) {
    return NextResponse.json(
      check.detail ? { error: check.error, detalle: check.detail } : { error: check.error },
      { status: check.status },
    );
  }

  const who = slot === 1 ? "witness1" : "witness2";
  const stored = await uploadSignature(signaturePath(form.clinicId, form.id, who), check.buffer);
  if (!stored) {
    // La firma del testigo SÍ falla si no se pudo guardar: sin imagen no hay
    // testigo, y quien está frente a la tableta puede reintentar en el momento.
    return NextResponse.json(
      { error: "No se pudo guardar la firma del testigo. Inténtalo de nuevo." },
      { status: 502 },
    );
  }

  const now = new Date();
  const res = await prisma.consentForm.updateMany({
    where:
      slot === 1
        ? { id: form.id, witness1SignedAt: null, signedAt: { not: null }, revokedAt: null, deletedAt: null }
        : { id: form.id, witness2SignedAt: null, signedAt: { not: null }, revokedAt: null, deletedAt: null },
    data:
      slot === 1
        ? { witness1Name: name.slice(0, MAX_NAME), witness1SignatureUrl: stored, witness1SignedAt: now }
        : { witness2Name: name.slice(0, MAX_NAME), witness2SignatureUrl: stored, witness2SignedAt: now },
  });
  if (res.count === 0) {
    return NextResponse.json({ error: "Ese testigo ya firmó." }, { status: 409 });
  }

  return NextResponse.json({ success: true, witness: slot, signedAt: now.toISOString() });
}
