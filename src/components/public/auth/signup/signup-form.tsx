"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import { Logo } from "../../landing/primitives/logo";
import { SocialButtons, GOOGLE_OAUTH_ENABLED } from "../social-buttons";
import { Divider } from "../divider";
import { Stepper } from "./stepper";
import { Step1Account } from "./step-1-account";
import { Step2Clinic } from "./step-2-clinic";
import { Step3PlanPayment, type CardDetails } from "./step-3-plan-payment";
import type { Billing, PlanId } from "./plan-card";
import { isPlanId } from "@/lib/billing/plans";
import { RefClickTracker } from "@/components/afiliados/ref-click-tracker";
import { trackSignupConversionAndRedirect } from "@/lib/gtag";

interface SignupState {
  // Step 1
  nombre: string;
  email: string;
  password: string;
  // Step 2
  clinicName: string;
  specialty: string;
  clinicSize: string;
  city: string;
  state: string;
  // Step 3
  plan: PlanId;
  billing: Billing;
  payMethod: "card" | "spei" | "oxxo";
  card: CardDetails;
  coupon: string;
  acceptedTerms: boolean;
  acceptedCharge: boolean;
}

const INITIAL: SignupState = {
  nombre: "",
  email: "",
  password: "",
  clinicName: "",
  specialty: "",
  clinicSize: "",
  city: "",
  state: "",
  plan: "PRO",
  billing: "monthly",
  payMethod: "card",
  card: { number: "", expiry: "", cvc: "", name: "", zip: "" },
  coupon: "",
  acceptedTerms: false,
  acceptedCharge: false,
};

// Maps specialty slug (from specialty-data.ts) to Prisma ClinicCategory enum.
const SPECIALTY_TO_CATEGORY: Record<string, string> = {
  "odontologia-general": "DENTAL",
  ortodoncia: "DENTAL",
  endodoncia: "DENTAL",
  periodoncia: "DENTAL",
  "medicina-general": "MEDICINE",
  dermatologia: "DERMATOLOGY",
  cardiologia: "MEDICINE",
  ginecologia: "MEDICINE",
  pediatria: "MEDICINE",
  oftalmologia: "MEDICINE",
  psicologia: "PSYCHOLOGY",
  psiquiatria: "PSYCHOLOGY",
  nutricion: "NUTRITION",
  fisioterapia: "PHYSIOTHERAPY",
  "medicina-estetica": "AESTHETIC_MEDICINE",
  acupuntura: "ALTERNATIVE_MEDICINE",
  homeopatia: "ALTERNATIVE_MEDICINE",
};

export function SignupForm() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // OAuth flow detection
  const isOAuthFlow = searchParams.get("source") === "oauth";
  const initialEmail = searchParams.get("email") ?? "";
  // Atribución de afiliado: ?ref=<referralCode> (p. ej. desde /socio/<slug>).
  // Se reenvía al backend, que lo resuelve best-effort (ata la clínica al
  // afiliado APPROVED). Si es inválido, el registro sigue sin atribución.
  const ref = searchParams.get("ref") ?? undefined;
  // Campaña del link de afiliado: ?c=<campaign> (links nombrados del panel de
  // socios). Formato estricto; si no cumple, se ignora.
  const campaignParam = searchParams.get("c") ?? "";
  const campaign = /^[a-z0-9-]{1,40}$/.test(campaignParam) ? campaignParam : undefined;
  // Plan elegido en la home (?plan=basic|pro|clinic). El registro REQUIERE un
  // plan; sin uno válido (y fuera del flujo OAuth) mandamos de vuelta a /#precios.
  const planParam = (searchParams.get("plan") ?? "").toUpperCase();
  const initialPlan: PlanId | null = isPlanId(planParam) ? planParam : null;
  // Periodo elegido en la landing (?billing=annual|monthly). Viaja al registro;
  // el cobro real se hace en el panel de activación (Stripe Checkout).
  const initialBilling: Billing = searchParams.get("billing") === "annual" ? "annual" : "monthly";
  const initialStepParam = searchParams.get("step");
  const initialStep: 1 | 2 | 3 =
    initialStepParam === "2" ? 2 :
    initialStepParam === "3" ? 3 :
    isOAuthFlow ? 2 :
    1;

  const [step, setStep] = useState<1 | 2 | 3>(initialStep);
  const [form, setForm] = useState<SignupState>(() => ({
    ...INITIAL,
    plan: initialPlan ?? INITIAL.plan,
    billing: initialBilling,
    email: initialEmail,
    // En OAuth flow el "nombre" se tomará del Supabase user en el backend
    nombre: isOAuthFlow ? "(OAuth)" : "",
    password: isOAuthFlow ? "oauth-no-password" : "",
  }));
  const [loading, setLoading] = useState(false);
  const submitLockRef = useRef(false);

  // Sync email from query param si cambia
  useEffect(() => {
    if (initialEmail && !form.email) setForm(prev => ({ ...prev, email: initialEmail }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialEmail]);

  // El registro requiere un plan elegido en la home. Sin ?plan válido (y fuera
  // del flujo OAuth, que no arrastra el query) → de vuelta a la sección precios.
  useEffect(() => {
    if (!initialPlan && !isOAuthFlow) router.replace("/#precios");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const update = (patch: Partial<SignupState>) =>
    setForm(prev => ({ ...prev, ...patch }));

  // Stepper muestra solo pasos relevantes: en OAuth saltamos paso 1
  const effectiveSteps = useMemo<1 | 2 | 3>(() => step, [step]);
  void effectiveSteps;

  async function handleSubmit() {
    if (submitLockRef.current) return;
    submitLockRef.current = true;
    setLoading(true);
    try {
      // Sin slug en el payload: el backend lo autogenera único con sufijo
      // (-1, -2…); mandarlo derivado del nombre bloqueaba nombres comunes
      // con "Ese subdominio ya está en uso" sin que el usuario pudiera editarlo.
      const basePayload = {
        clinicName: form.clinicName,
        specialty: form.specialty,
        category: SPECIALTY_TO_CATEGORY[form.specialty] ?? "OTHER",
        country: "México",
        city: form.city || undefined,
        state: form.state || undefined,
        clinicSize: form.clinicSize || undefined,
        plan: form.plan,
        billing: form.billing,
        // El cobro real es vía Stripe Checkout (método elegido en el paso 3);
        // aquí solo guardamos una preferencia legacy que register/-oauth aceptan.
        paymentMethod: form.payMethod === "card" ? "card" : "transfer",
      };

      let res: Response;
      if (isOAuthFlow) {
        // Usuario ya autenticado via OAuth — solo crear Clinic + User en Prisma
        res = await fetch("/api/auth/register-oauth", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(basePayload),
        });
      } else {
        const trimmed = form.nombre.trim();
        const [firstName, ...rest] = trimmed.split(/\s+/);
        const lastName = rest.join(" ") || firstName;
        res = await fetch("/api/auth/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            firstName,
            lastName,
            email: form.email,
            password: form.password,
            ref,
            campaign,
            coupon: form.coupon.trim() || undefined,
            ...basePayload,
          }),
        });
      }

      const data = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        error?: string;
        coupon?: string | null; // "applied" | "invalid" | null
      };
      if (res.status === 409) {
        toast.error(data.error ?? "Ya existe una cuenta con este correo");
        setTimeout(() => router.push("/login"), 2000);
        setLoading(false);
        submitLockRef.current = false;
        return;
      }
      if (!res.ok) throw new Error(data.error ?? "Error al crear cuenta");

      // Aviso no bloqueante: el cupón no aplicó pero la cuenta ya existe.
      if (data.coupon === "invalid") {
        toast("El código de promoción no era válido; tu cuenta se creó de todas formas", {
          icon: "⚠️",
        });
      }

      // Auto-login sólo en flujo email/password (OAuth ya tiene sesión activa)
      if (!isOAuthFlow) {
        try {
          const { createClient } = await import("@/lib/supabase/client");
          const supa = createClient();
          await supa.auth.signInWithPassword({
            email: form.email,
            password: form.password,
          });
        } catch (signInErr) {
          console.warn("Auto sign-in after signup failed:", signInErr);
        }
      }

      // La cuenta nace SIN acceso (pending_payment). El pago se hace en la
      // pantalla de activación: mandamos DIRECTO a /dashboard/suspended (no a
      // /dashboard, así no pasa por el gating ni ve modal alguno) donde elige
      // plan, método y paga. El webhook activa la cuenta al confirmar el pago.
      toast.success("¡Cuenta creada! Elige cómo pagar para activar tu plan.");
      trackSignupConversionAndRedirect("/dashboard/suspended");
      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Error al crear cuenta";
      toast.error(msg);
      setLoading(false);
      submitLockRef.current = false;
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <RefClickTracker refCode={ref} />
      {/* Logo */}
      <div>
        <Logo size={22} color="var(--ld-brand-light)" />
      </div>

      {/* Title */}
      <div>
        <h1
          style={{
            margin: 0,
            marginBottom: 6,
            fontFamily: "var(--font-sans, system-ui, sans-serif)",
            fontSize: 26,
            fontWeight: 600,
            letterSpacing: "-0.025em",
            color: "var(--ld-fg)",
          }}
        >
          {step === 1 && "Crea tu cuenta"}
          {step === 2 && "Cuéntanos de tu clínica"}
          {step === 3 && "Elige tu plan"}
        </h1>
        <p style={{ margin: 0, fontSize: 13.5, color: "var(--ld-fg-muted)" }}>
          {step === 1 && "Crea tu cuenta para empezar."}
          {step === 2 &&
            "Configuramos tu espacio basado en tu especialidad."}
          {step === 3 &&
            "Confirma el plan con el que quieres empezar. El pago lo haces dentro del panel."}
        </p>
      </div>

      {/* Social buttons (only step 1, not in OAuth flow) */}
      {step === 1 && !isOAuthFlow && GOOGLE_OAUTH_ENABLED && (
        <>
          <SocialButtons redirectTo="/dashboard" />
          <Divider label="o con tu correo" />
        </>
      )}

      {/* OAuth banner (si vino de Google/Microsoft) */}
      {isOAuthFlow && step === 2 && (
        <div
          style={{
            padding: "10px 14px",
            borderRadius: 10,
            background: "rgba(5,150,105,0.07)",
            border: "1px solid rgba(5,150,105,0.3)",
            fontSize: 12,
            color: "#047857",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <span aria-hidden="true">✓</span>
          Cuenta verificada como <strong>{form.email || "usuario OAuth"}</strong>. Solo faltan los datos de tu clínica.
        </div>
      )}

      {/* Stepper */}
      <Stepper step={step} />

      {/* Steps */}
      {step === 1 && (
        <Step1Account
          values={{
            nombre: form.nombre,
            email: form.email,
            password: form.password,
          }}
          onChange={update}
          onContinue={() => setStep(2)}
        />
      )}

      {step === 2 && (
        <Step2Clinic
          values={{
            clinicName: form.clinicName,
            specialty: form.specialty,
            clinicSize: form.clinicSize,
            city: form.city,
            state: form.state,
          }}
          onChange={update}
          onContinue={() => setStep(3)}
          onBack={() => {
            if (isOAuthFlow) {
              // Sin paso 1 disponible: volver al home
              router.push("/");
            } else {
              setStep(1);
            }
          }}
        />
      )}

      {step === 3 && (
        <Step3PlanPayment
          values={{
            plan: form.plan,
            billing: form.billing,
            payMethod: form.payMethod,
            card: form.card,
            coupon: form.coupon,
            acceptedTerms: form.acceptedTerms,
            acceptedCharge: form.acceptedCharge,
          }}
          onChange={update}
          onBack={() => setStep(2)}
          onSubmit={handleSubmit}
          loading={loading}
        />
      )}
    </div>
  );
}
