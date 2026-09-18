-- Migration: PayPal-backed "Guaranteed Article" package
-- Run once: node run-migration.js add-paypal-fields-to-submissions.sql

-- 1. New optional columns
ALTER TABLE music_submissions
  ADD COLUMN IF NOT EXISTS payment_provider  TEXT DEFAULT 'stripe',
  ADD COLUMN IF NOT EXISTS paypal_order_id   TEXT,
  ADD COLUMN IF NOT EXISTS paypal_capture_id TEXT,
  ADD COLUMN IF NOT EXISTS paid_at           TIMESTAMP;

-- 2. Idempotency backstop: the same PayPal order can never create two rows.
-- (NULLs are unaffected by a unique index -- Stripe/free rows never set this.)
-- This migration is meant to run once (see header); re-running it will error
-- here with "constraint already exists", which is the correct signal.
ALTER TABLE music_submissions ADD CONSTRAINT music_submissions_paypal_order_id_key UNIQUE (paypal_order_id);

-- 3. Expand submission_type check constraint to include the new package
DO $$
BEGIN
  ALTER TABLE music_submissions DROP CONSTRAINT IF EXISTS music_submissions_submission_type_check;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

ALTER TABLE music_submissions
  ADD CONSTRAINT music_submissions_submission_type_check
  CHECK (submission_type IN ('regular', 'featured', 'free', 'priority', 'genius', 'guaranteed_article'));
