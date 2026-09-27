"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import { Logo } from "../../landing/primitives/logo";
import { SecureBadge } from "../../landing/primitives/secure-badge";
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
import { trackGa4SignUp } from "@/lib/analytics/ga4";
import { guardarEleccionAlta } from "@/lib/billing/eleccion-alta";
import { MENSAJE_CONTRASENA_FILTRADA } from "@/lib/auth/errores-contrasena";

interface SignupState {
  // Step 1
  nombre: string;
  email: string;
  // WhatsApp de la clínica. Se pide en el paso 1, o en el paso 2 cuando ese
  // paso 1 no existe (OAuth). Es obligatorio venga por donde venga el registro.
  phone: string;
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
  phone: "",
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
  // Quien no arranca en el paso 1 nunca ve el campo de WhatsApp de ese paso
  // (OAuth, o un enlace directo con ?step=2). A esos hay que pedírselo en el
  // paso 2: el teléfono es obligatorio se entre por donde se entre.
  const skippedAccountStep = initialStep !== 1;

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
  // Rechazo de Supabase a la contraseña; se borra en cuanto se teclea otra.
  const [passwordServerError, setPasswordServerError] = useState<string | undefined>();
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
        // Sin normalizar a propósito: el endpoint limpia y valida (es el gate
        // que manda), y así los dos caminos mandan exactamente lo que se tecleó.
        phone: form.phone,
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
        code?: string; // "weak_password" cuando Supabase rechaza la contraseña
        coupon?: string | null; // "applied" | "invalid" | null
      };
      if (res.status === 409) {
        toast.error(data.error ?? "Ya existe una cuenta con este correo");
        setTimeout(() => router.push("/login"), 2000);
        setLoading(false);
        submitLockRef.current = false;
        return;
      }
      // Supabase rechazó la contraseña (filtrada, corta…). La contraseña se
      // tecleó en el paso 1 y el rechazo llega en el 3: se regresa a donde se
      // corrige, con el motivo bajo el campo, en vez de dejar solo un toast.
      if (!res.ok && data.code === "weak_password" && !isOAuthFlow) {
        const motivo = data.error ?? MENSAJE_CONTRASENA_FILTRADA;
        setPasswordServerError(motivo);
        toast.error(motivo);
        setStep(1);
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
      // Plan y periodo elegidos aquí, en el navegador (el alta no persiste el
      // periodo): la pantalla de pago arranca con ese periodo en vez de
      // volver a preguntarlo. Caduca a los 7 días y se borra al iniciar el pago.
      guardarEleccionAlta({ plan: form.plan, billing: form.billing });
      toast.success("¡Cuenta creada! Elige cómo pagar para activar tu plan.");
      // GA4 `sign_up` (WS1-T6): mismo momento, ANTES de la conversión de Ads y sin
      // callback propio → la redirección espera lo mismo que antes. Evento aparte.
      trackGa4SignUp(isOAuthFlow ? "google" : "email");
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
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <RefClickTracker refCode={ref} />
      {/* Logo sólo en móvil/tableta: en PC ya está en el panel de marca. */}
      <div className="dca-logo-movil">
        <Logo size={22} color="#2563eb" />
      </div>

      {/* Title */}
      <div>
        <h1
          style={{
            margin: 0,
            marginBottom: 6,
            fontSize: "clamp(22px, 2vw, 26px)",
            fontWeight: 700,
            letterSpacing: "-0.035em",
            lineHeight: 1.1,
            color: "#0f172a",
          }}
        >
          {step === 1 && "Crea tu cuenta"}
          {step === 2 && "Cuéntanos de tu clínica dental"}
          {step === 3 && "Elige tu plan"}
        </h1>
        <p style={{ margin: 0, fontSize: 14, lineHeight: 1.45, color: "#475569" }}>
          {step === 1 && "Tu nombre, tu correo y una contraseña. Un minuto."}
          {step === 2 &&
            "Con tu especialidad y tamaño dejamos tu panel listo desde el primer día."}
          {step === 3 && initialPlan
            ? "Este es el plan que elegiste. El pago lo haces en el siguiente paso, dentro del panel."
            : step === 3
              ? "Confirma el plan con el que quieres empezar. El pago lo haces en el siguiente paso, dentro del panel."
              : null}
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
        <div className="dca-banner-ok">
          <span aria-hidden="true" style={{ color: "#16a34a", fontWeight: 800 }}>✓</span>
          <span>
            Cuenta verificada como <strong>{form.email || "usuario OAuth"}</strong>. Solo faltan los datos de tu clínica.
          </span>
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
            phone: form.phone,
            password: form.password,
          }}
          onChange={patch => {
            if (patch.password !== undefined) setPasswordServerError(undefined);
            update(patch);
          }}
          onContinue={() => setStep(2)}
          passwordServerError={passwordServerError}
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
            phone: form.phone,
          }}
          showPhone={skippedAccountStep}
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
          planFijo={initialPlan !== null}
        />
      )}

      {/* Sello de confianza: visible en los 3 pasos, incluido el de plan y pago. */}
      <div style={{ display: "flex", justifyContent: "center" }}>
        <SecureBadge tone="light" />
      </div>
    </div>
  );
}
