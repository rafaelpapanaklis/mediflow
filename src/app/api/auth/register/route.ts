import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { rateLimit } from "@/lib/rate-limit";
import { sendWelcomeEmail } from "@/lib/email";
import { SITE_URL } from "@/lib/seo";
import { logError } from "@/lib/safe-log";
import { resolveApprovedAffiliateByCode } from "@/lib/affiliates";
import { sendAffiliateNewReferralEmail } from "@/lib/affiliate-emails";

const CATEGORY_MAP: Record<string, string> = {
  dental: "DENTAL", odontologia: "DENTAL",
  medicine: "MEDICINE", medicina: "MEDICINE",
  nutrition: "NUTRITION", nutricion: "NUTRITION",
  psychology: "PSYCHOLOGY", psicologia: "PSYCHOLOGY",
  dermatology: "DERMATOLOGY", dermatologia: "DERMATOLOGY",
};

const schema = z.object({
  firstName: z.string().min(2), lastName: z.string().min(2),
  email: z.string().email(), password: z.string().min(8),
  clinicName: z.string().min(2),
  specialty: z.string().optional(), // @deprecated — backwards compat
  category: z.string().optional(),  // new: ClinicCategory enum value
  country: z.string().min(1), city: z.string().optional(),
  state: z.string().optional(),           // MX state (signup step 2)
  clinicSize: z.string().optional(),      // 1 | 2-5 | 6-15 | 16+
  phone: z.string().optional(), plan: z.enum(["BASIC","PRO","CLINIC"]).default("PRO"),
  slug: z.string().optional(),
  paymentMethod: z
    .enum(["stripe", "transfer", "card", "paypal", "none"])
    .default("transfer"),
  paymentMethodLast4: z.string().regex(/^\d{4}$/).optional(), // solo para card
  billing: z.enum(["monthly", "annual"]).default("monthly"),
  ref: z.string().optional(), // referralCode de afiliado (atribución en el alta)
  campaign: z.string().optional(), // campaña del link de afiliado (?c=)
  coupon: z.string().optional(), // código de cupón/socio (best-effort, nunca rompe el alta)
});

async function generateSlug(name: string) {
  let base = name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 30);
  let slug = base; let i = 1;
  while (await prisma.clinic.findUnique({ where: { slug } })) { slug = `${base}-${i++}`; }
  return slug;
}

export async function POST(req: NextRequest) {
  const rl = rateLimit(req, 5); // 5 requests per minute per IP
  if (rl) return rl;

  try {
    const body = await req.json();
    const data = schema.parse(body);
    const supabase = createClient();

    if (data.slug) {
      const existing = await prisma.clinic.findUnique({ where: { slug: data.slug } });
      if (existing) return NextResponse.json({ error: "Ese subdominio ya está en uso" }, { status: 400 });
    }

    const { data: authData, error: authError } = await supabase.auth.signUp({
      email: data.email, password: data.password,
      options: { data: { first_name: data.firstName, last_name: data.lastName } },
    });
    if (authError || !authData.user) {
      return NextResponse.json({ error: authError?.message ?? "Error al crear cuenta" }, { status: 400 });
    }

    const slug = data.slug ?? await generateSlug(data.clinicName);
    const trialEndsAt = new Date();
    trialEndsAt.setDate(trialEndsAt.getDate() + 14);

    // Resolve category from new field or legacy specialty
    const resolvedCategory = data.category
      ? data.category
      : data.specialty
        ? (CATEGORY_MAP[data.specialty.toLowerCase()] ?? "OTHER")
        : "OTHER";
    const specialtyLabel = data.specialty ?? data.category ?? "other";

    // Trial siempre activo — el método de pago se cobra al terminar los 14 días
    // (cuando Stripe/PayPal estén wired). Hasta entonces, sólo capturamos la preferencia.
    const paymentMethodType =
      data.paymentMethod === "card" || data.paymentMethod === "stripe"
        ? "card"
        : data.paymentMethod; // "paypal" | "transfer" | "none"

    const paymentMethodCollected =
      paymentMethodType === "card"
        ? !!data.paymentMethodLast4
        : paymentMethodType === "paypal" || paymentMethodType === "transfer";
    // "none" cae al else implícito → false (correcto, no hay método capturado)

    // Atribución de afiliado (best-effort): ?ref=<referralCode> del body o del
    // query string. Solo se aplica si es un Affiliate APPROVED. Nunca rompe el
    // registro si el ref es inválido (resolveApprovedAffiliateByCode → null).
    const refCode = data.ref ?? req.nextUrl.searchParams.get("ref") ?? undefined;
    let referringAffiliate = await resolveApprovedAffiliateByCode(refCode);
    // Anti self-referral: si el email del registro es el del propio afiliado,
    // se anula SOLO la atribución (el alta procede normal, sin comisión).
    if (
      referringAffiliate &&
      referringAffiliate.email.trim().toLowerCase() === data.email.trim().toLowerCase()
    ) {
      referringAffiliate = null;
    }

    // Campaña del link de afiliado (body o query ?c=), solo para atribución
    // de la conversión. Formato estricto; inválida → se ignora en silencio.
    const rawCampaign = data.campaign ?? req.nextUrl.searchParams.get("c") ?? "";
    const campaign = /^[a-z0-9-]{1,40}$/.test(rawCampaign) ? rawCampaign : undefined;

    // Cupón (best-effort, NUNCA rompe el alta): valida contra el sistema
    // existente de coupons. Un cupón inválido solo se reporta en la respuesta.
    let couponRow: any = null;
    let couponValid = false;
    let conversionSource: string | null = null;
    if (data.coupon) {
      try {
        const couponCode = data.coupon.trim().toUpperCase();
        if (couponCode) {
          couponRow = await prisma.coupon.findUnique({ where: { code: couponCode } });
          if (couponRow) {
            const now = new Date();
            couponValid =
              couponRow.active &&
              couponRow.validFrom <= now &&
              (!couponRow.validUntil || couponRow.validUntil > now) &&
              (!couponRow.maxUses || couponRow.usedCount < couponRow.maxUses) &&
              (couponRow.appliesTo === "all" || couponRow.appliesTo === data.plan);
          }
        }
      } catch {
        couponRow = null;
        couponValid = false;
      }
    }

    // Atribución por cupón de afiliado: si el cupón pertenece a un socio
    // (tabla puente affiliate_coupons) y el alta NO venía ya atribuida por
    // ?ref, se atribuye al socio con el MISMO anti self-referral de arriba.
    // Tablas nuevas pueden no existir aún → try/catch defensivo.
    if (couponValid && couponRow && !referringAffiliate) {
      try {
        const ac = await prisma.affiliateCoupon
          .findUnique({ where: { couponId: couponRow.id } })
          .catch(() => null);
        if (ac) {
          const affiliate = await prisma.affiliate.findUnique({
            where: { id: ac.affiliateId },
            select: { id: true, status: true, commissionPct: true, email: true },
          });
          if (
            affiliate &&
            affiliate.status === "APPROVED" &&
            affiliate.email.trim().toLowerCase() !== data.email.trim().toLowerCase()
          ) {
            referringAffiliate = {
              id: affiliate.id,
              commissionPct: affiliate.commissionPct,
              email: affiliate.email,
            };
            conversionSource = "coupon";
          }
        }
      } catch {}
    }

    const clinic = await prisma.clinic.create({
      data: {
        name: data.clinicName, slug, specialty: specialtyLabel,
        affiliateId: referringAffiliate?.id,
        category: resolvedCategory as any,
        country: data.country,
        state: data.state,
        city: data.city,
        clinicSize: data.clinicSize,
        phone: data.phone,
        email: data.email, plan: data.plan as any, trialEndsAt,
        subscriptionStatus: "trialing",
        preferredPaymentMethod: paymentMethodType,
        paymentMethodCollected,
        paymentMethodType,
        paymentMethodLast4: paymentMethodType === "card" ? data.paymentMethodLast4 : undefined,
        users: { create: { supabaseId: authData.user.id, email: data.email, firstName: data.firstName, lastName: data.lastName, role: "SUPER_ADMIN", specialty: specialtyLabel } },
        schedules: { createMany: { data: [0,1,2,3,4].map(day => ({ dayOfWeek: day, enabled: true, openTime: "09:00", closeTime: "18:00" })) } },
      },
    });

    // Conversión de afiliado (best-effort): registra la atribución con su
    // campaña y origen. Si la tabla nueva no existe aún, silencio total.
    if (referringAffiliate) {
      try {
        await prisma.affiliateConversion.create({
          data: {
            affiliateId: referringAffiliate.id,
            clinicId: clinic.id,
            campaign: campaign ?? null,
            source: conversionSource ?? "link",
            couponId: couponValid ? couponRow.id : null,
          },
        });
      } catch {}
    }

    // Atribución a VENDEDOR (best-effort, ADITIVO): si el alta vino por el link
    // o cupón de un vendedor (hijo del afiliado padre atribuido), registra una
    // atribución aparte con su % CONGELADO (no retroactivo). NO cambia la
    // atribución del afiliado ni clinics.affiliateId (la clínica sigue ligada al
    // PADRE, que cuenta para su nivel). Tablas nuevas pueden no existir → silencio.
    if (referringAffiliate) {
      try {
        // 1) Determinar el sellerId candidato (link del padre o cupón del padre).
        let candidato: string | null = null;
        if (campaign) {
          const link = await prisma.affiliateLink
            .findUnique({
              where: { affiliateId_campaign: { affiliateId: referringAffiliate.id, campaign } },
            })
            .catch(() => null);
          if (link?.sellerId) candidato = link.sellerId;
        }
        if (!candidato && conversionSource === "coupon" && couponRow) {
          const ac = await prisma.affiliateCoupon
            .findUnique({ where: { couponId: couponRow.id } })
            .catch(() => null);
          if (ac?.sellerId) candidato = ac.sellerId;
        }

        // 2) Validar el vendedor: existe, activo, hijo del padre atribuido y
        //    anti self-referral (su email ≠ el del alta).
        if (candidato) {
          const seller = await prisma.affiliateSeller.findUnique({ where: { id: candidato } });
          if (
            seller &&
            seller.isActive === true &&
            seller.affiliateId === referringAffiliate.id &&
            seller.email.trim().toLowerCase() !== data.email.trim().toLowerCase()
          ) {
            // 3) Congela el pct al momento del alta y registra la atribución.
            //    clinicId es @unique → en P2002 se ignora.
            const pct = seller.commissionPct;
            await prisma.affiliateSellerAttribution.create({
              data: {
                clinicId: clinic.id,
                sellerId: seller.id,
                affiliateId: referringAffiliate.id,
                sellerPct: pct,
              },
            });
          }
        }
      } catch {}
    }

    // Canje del cupón (best-effort): suma 1 a usedCount.
    if (couponValid && couponRow) {
      try {
        await prisma.coupon.update({
          where: { id: couponRow.id },
          data: { usedCount: { increment: 1 } },
        });
      } catch {}
    }

    // Welcome email (no bloquea el response si falla)
    sendWelcomeEmail({
      email: data.email,
      firstName: data.firstName,
      clinicName: data.clinicName,
      trialEndsAt,
      dashboardUrl: `${SITE_URL}/dashboard`,
    }).catch(err => logError("[register] welcome email failed:", err));

    // Aviso al afiliado referente (no bloquea el response si falla). Aplica
    // igual si la atribución vino por link (?ref) o por cupón del socio.
    if (referringAffiliate) {
      sendAffiliateNewReferralEmail({
        affiliateId: referringAffiliate.id,
        clinicName: data.clinicName,
      }).catch(err => logError("[register] affiliate referral email failed:", err));
    }

    return NextResponse.json({
      success: true,
      // "applied" | "invalid" | null — informativo para el form (no bloquea)
      coupon: data.coupon ? (couponValid ? "applied" : "invalid") : null,
    });
  } catch (err: any) {
    logError("[register]", err);
    return NextResponse.json({ error: err.message ?? "Error interno" }, { status: 500 });
  }
}
