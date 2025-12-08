import express from 'express';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const router = express.Router();

// Database connection
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

/**
 * Slugify function (matches frontend)
 */
const slugify = (text) => {
  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\w\-]+/g, '')
    .replace(/\-\-+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');
};

/**
 * Generate article URL (matches frontend)
 */
const generateArticleUrl = (id, title) => {
  const slug = slugify(title);
  return `/article/${id}-${slug}`;
};

/**
 * GET /sitemap.xml - Generate dynamic XML sitemap
 */
router.get('/sitemap.xml', async (req, res) => {
  try {
    // Fetch all articles from database
    const result = await pool.query(
      'SELECT id, title, created_at, updated_at FROM articles ORDER BY created_at DESC'
    );

    const articles = result.rows;
    const baseUrl = 'https://cry808.com';

    // Start XML
    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';

    // Homepage
    xml += '  <url>\n';
    xml += `    <loc>${baseUrl}/</loc>\n`;
    xml += '    <changefreq>daily</changefreq>\n';
    xml += '    <priority>1.0</priority>\n';
    xml += '  </url>\n';

    // Add each article
    articles.forEach(article => {
      const articleUrl = generateArticleUrl(article.id, article.title);
      const lastmod = article.updated_at || article.created_at;
      const formattedDate = new Date(lastmod).toISOString().split('T')[0];

      xml += '  <url>\n';
      xml += `    <loc>${baseUrl}${articleUrl}</loc>\n`;
      xml += `    <lastmod>${formattedDate}</lastmod>\n`;
      xml += '    <changefreq>weekly</changefreq>\n';
      xml += '    <priority>0.8</priority>\n';
      xml += '  </url>\n';
    });

    // Close XML
    xml += '</urlset>';

    // Set proper headers for XML
    res.header('Content-Type', 'application/xml');
    res.send(xml);
  } catch (error) {
    console.error('Error generating sitemap:', error);
    res.status(500).send('Error generating sitemap');
  }
});

export default router;
