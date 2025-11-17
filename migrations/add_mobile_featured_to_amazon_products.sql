-- Migration: Add is_mobile_featured field to amazon_products table
-- Description: Allows marking one product to display as mobile homepage ad

ALTER TABLE amazon_products
ADD COLUMN IF NOT EXISTS is_mobile_featured BOOLEAN DEFAULT false;

-- Create index for mobile featured product
CREATE INDEX IF NOT EXISTS idx_amazon_products_mobile_featured ON amazon_products(is_mobile_featured);

-- Ensure only one product can be mobile featured at a time
-- This is a constraint that will be enforced in the application logic
COMMENT ON COLUMN amazon_products.is_mobile_featured IS 'Only one product should be mobile featured at a time';
