-- Add page selection columns to amazon_products table
ALTER TABLE amazon_products ADD COLUMN IF NOT EXISTS show_on_home BOOLEAN DEFAULT true;
ALTER TABLE amazon_products ADD COLUMN IF NOT EXISTS show_on_article BOOLEAN DEFAULT true;

-- Update existing products to show on both pages by default
UPDATE amazon_products SET show_on_home = true, show_on_article = true WHERE show_on_home IS NULL;
