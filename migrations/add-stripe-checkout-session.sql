-- Migration: Stripe Checkout session tracking
-- Run once: node run-migration.js add-stripe-checkout-session.sql

ALTER TABLE music_submissions
  ADD COLUMN IF NOT EXISTS stripe_session_id VARCHAR(255);
