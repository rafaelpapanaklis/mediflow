-- Signup flow: capture state, clinic size, payment method preference
-- Ejecutar en Supabase SQL editor (idempotente con IF NOT EXISTS).

ALTER TABLE public.clinics ADD COLUMN IF NOT EXISTS "state" TEXT;
ALTER TABLE public.clinics ADD COLUMN IF NOT EXISTS "clinicSize" TEXT;

-- Payment method capture (UI-only hasta que Stripe/PayPal estén wired)
ALTER TABLE public.clinics ADD COLUMN IF NOT EXISTS "paymentMethodCollected" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.clinics ADD COLUMN IF NOT EXISTS "paymentMethodType" TEXT;
ALTER TABLE public.clinics ADD COLUMN IF NOT EXISTS "paymentMethodLast4" TEXT;

-- Cancellation request
ALTER TABLE public.clinics ADD COLUMN IF NOT EXISTS "cancelRequested" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.clinics ADD COLUMN IF NOT EXISTS "cancelRequestedAt" TIMESTAMP(3);
