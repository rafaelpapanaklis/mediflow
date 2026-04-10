-- Migration: Allow users to belong to multiple clinics
-- Changes supabaseId from unique to composite unique with clinicId

-- Step 1: Drop the existing unique constraint on supabaseId
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_supabaseId_key;

-- Step 2: Create composite unique constraint (supabaseId + clinicId)
ALTER TABLE users ADD CONSTRAINT users_supabaseId_clinicId_key UNIQUE ("supabaseId", "clinicId");

-- Step 3: Create index on supabaseId for fast lookups
CREATE INDEX IF NOT EXISTS users_supabaseId_idx ON users ("supabaseId");
