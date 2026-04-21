"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import toast from "react-hot-toast";
import { Logo } from "../../landing/primitives/logo";
import { SocialButtons } from "../social-buttons";
import { Divider } from "../divider";
import { Stepper } from "./stepper";
import { Step1Account } from "./step-1-account";
import { Step2Clinic } from "./step-2-clinic";
import { Step3PlanPayment, type CardDetails } from "./step-3-plan-payment";
import type { Billing, PlanId } from "./plan-card";

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
  payMethod: "card" | "paypal";
  card: CardDetails;
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

function slugifyClinic(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 30);
}

export function SignupForm() {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [form, setForm] = useState<SignupState>(INITIAL);
  const [loading, setLoading] = useState(false);

  const update = (patch: Partial<SignupState>) =>
    setForm(prev => ({ ...prev, ...patch }));

  async function handleSubmit() {
    if (loading) return;
    setLoading(true);
    try {
      const trimmed = form.nombre.trim();
      const [firstName, ...rest] = trimmed.split(/\s+/);
      const lastName = rest.join(" ") || firstName;
      const slug = slugifyClinic(form.clinicName);

      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName,
          lastName,
          email: form.email,
          password: form.password,
          clinicName: form.clinicName,
          slug,
          specialty: form.specialty,
          category:
            SPECIALTY_TO_CATEGORY[form.specialty] ?? "OTHER",
          country: "México",
          city: form.city || undefined,
          state: form.state || undefined,
          clinicSize: form.clinicSize || undefined,
          plan: form.plan,
          billing: form.billing,
          paymentMethod: form.payMethod,
          paymentMethodLast4:
            form.payMethod === "card"
              ? form.card.number.replace(/\s/g, "").slice(-4) || undefined
              : undefined,
        }),
      });

      const data = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        error?: string;
      };

      if (!res.ok) {
        throw new Error(data.error ?? "Error al crear cuenta");
      }

      // Auto sign-in so the user lands in their dashboard already authenticated.
      try {
        const { createClient } = await import("@/lib/supabase/client");
        const supa = createClient();
        await supa.auth.signInWithPassword({
          email: form.email,
          password: form.password,
        });
      } catch (signInErr) {
        // If auto-login fails, user can still log in manually after confirming email.
        // eslint-disable-next-line no-console
        console.warn("Auto sign-in after signup failed:", signInErr);
      }

      toast.success("¡Cuenta creada! Bienvenido a MediFlow 🎉");
      router.push("/dashboard");
      router.refresh();
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Error al crear cuenta";
      toast.error(msg);
      setLoading(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
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
            fontFamily: "var(--font-sora, 'Sora', sans-serif)",
            fontSize: 26,
            fontWeight: 600,
            letterSpacing: "-0.025em",
            color: "var(--ld-fg)",
          }}
        >
          {step === 1 && "Crea tu cuenta gratis"}
          {step === 2 && "Cuéntanos de tu clínica"}
          {step === 3 && "Elige tu plan y empieza hoy"}
        </h1>
        <p style={{ margin: 0, fontSize: 13.5, color: "var(--ld-fg-muted)" }}>
          {step === 1 && "14 días gratis · Cancela cuando quieras"}
          {step === 2 &&
            "Configuramos tu espacio basado en tu especialidad."}
          {step === 3 &&
            "No se te cobrará nada hasta que termine tu prueba."}
        </p>
      </div>

      {/* Social buttons (only step 1) */}
      {step === 1 && (
        <>
          <SocialButtons redirectTo="/dashboard" />
          <Divider label="o con tu correo" />
        </>
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
          onBack={() => setStep(1)}
        />
      )}

      {step === 3 && (
        <Step3PlanPayment
          values={{
            plan: form.plan,
            billing: form.billing,
            payMethod: form.payMethod,
            card: form.card,
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
