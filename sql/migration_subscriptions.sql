-- Migration: Subscription billing (Stripe recurring + PayPal + OXXO)

ALTER TABLE clinics ADD COLUMN IF NOT EXISTS "stripeCustomerId" text;
ALTER TABLE clinics ADD COLUMN IF NOT EXISTS "stripeSubscriptionId" text;
ALTER TABLE clinics ADD COLUMN IF NOT EXISTS "stripePaymentMethodId" text;
ALTER TABLE clinics ADD COLUMN IF NOT EXISTS "paypalSubscriptionId" text;
ALTER TABLE clinics ADD COLUMN IF NOT EXISTS "paypalEmail" text;
ALTER TABLE clinics ADD COLUMN IF NOT EXISTS "preferredPaymentMethod" text;
