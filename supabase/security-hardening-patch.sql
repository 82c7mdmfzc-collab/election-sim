-- Elector security hardening patch runner.
--
-- Use with psql / Supabase CLI from the supabase/ directory:
--   psql "$DATABASE_URL" -f security-hardening-patch.sql
--
-- Supabase Dashboard SQL Editor does not support \ir includes; dashboard users
-- should run these same canonical files manually in this order. Each file is
-- idempotent and can be re-run safely.

\ir profiles.sql
\ir lobbies.sql
\ir rewards.sql
\ir referrals.sql
