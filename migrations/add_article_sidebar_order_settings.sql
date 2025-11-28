-- Add order settings for article page sidebar components
INSERT INTO settings (key, value, description)
VALUES ('hilltop_article_order', '1', 'Display order for Hilltop ads in article sidebar (lower number = higher position)')
ON CONFLICT (key) DO NOTHING;

INSERT INTO settings (key, value, description)
VALUES ('amazon_article_order', '2', 'Display order for Amazon products in article sidebar (lower number = higher position)')
ON CONFLICT (key) DO NOTHING;
