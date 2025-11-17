-- Migration: Create amazon_products table
-- Description: Stores Amazon affiliate products for the sidebar widget

CREATE TABLE IF NOT EXISTS amazon_products (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  affiliate_link TEXT NOT NULL,
  image_url TEXT,
  is_active BOOLEAN DEFAULT true,
  display_order INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Add index for active products (for faster queries)
CREATE INDEX idx_amazon_products_active ON amazon_products(is_active, display_order);

-- Insert sample products (optional - can delete these after testing)
INSERT INTO amazon_products (name, description, affiliate_link, image_url, display_order) VALUES
  ('Focusrite Scarlett 2i2', 'Essential audio interface for recording', 'https://amzn.to/486vUD3', 'https://m.media-amazon.com/images/I/61LhzhxpC8L._AC_SL1500_.jpg', 1),
  ('Audio-Technica ATH-M50x', 'Studio headphones for mixing & production', 'https://amzn.to/4ph1dlI', 'https://m.media-amazon.com/images/I/71gW28F-wOL._AC_SL1500_.jpg', 2);
