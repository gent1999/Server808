import express from 'express';
import pool from '../config/db.js';

const router = express.Router();

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
 * GET /lowkeygrid-sitemap.xml - Generate dynamic XML sitemap for 2koveralls
 */
router.get('/lowkeygrid-sitemap.xml', async (req, res) => {
  try {
    const baseUrl = 'https://www.2koveralls.com';

    // Fetch trends articles (news)
    const trendsResult = await pool.query(
      "SELECT id, title, created_at, updated_at FROM articles WHERE site = 'lowkeygrid' AND category = 'trends' ORDER BY created_at DESC"
    );

    // Fetch write-up articles
    const articlesResult = await pool.query(
      "SELECT id, title, created_at, updated_at FROM articles WHERE site = 'lowkeygrid' AND category IN ('article', 'interview') ORDER BY created_at DESC"
    );

    // Fetch overalls
    const overallsResult = await pool.query(
      'SELECT id, slug, title, created_at, updated_at FROM overalls ORDER BY created_at DESC'
    );

    // Start XML
    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';

    // Static pages
    xml += '  <url>\n';
    xml += `    <loc>${baseUrl}/</loc>\n`;
    xml += '    <changefreq>daily</changefreq>\n';
    xml += '    <priority>1.0</priority>\n';
    xml += '  </url>\n';

    xml += '  <url>\n';
    xml += `    <loc>${baseUrl}/news</loc>\n`;
    xml += '    <changefreq>daily</changefreq>\n';
    xml += '    <priority>0.9</priority>\n';
    xml += '  </url>\n';

    xml += '  <url>\n';
    xml += `    <loc>${baseUrl}/overalls</loc>\n`;
    xml += '    <changefreq>daily</changefreq>\n';
    xml += '    <priority>0.9</priority>\n';
    xml += '  </url>\n';

    xml += '  <url>\n';
    xml += `    <loc>${baseUrl}/submit-music</loc>\n`;
    xml += '    <changefreq>monthly</changefreq>\n';
    xml += '    <priority>0.7</priority>\n';
    xml += '  </url>\n';

    xml += '  <url>\n';
    xml += `    <loc>${baseUrl}/about</loc>\n`;
    xml += '    <changefreq>monthly</changefreq>\n';
    xml += '    <priority>0.5</priority>\n';
    xml += '  </url>\n';

    xml += '  <url>\n';
    xml += `    <loc>${baseUrl}/contact</loc>\n`;
    xml += '    <changefreq>monthly</changefreq>\n';
    xml += '    <priority>0.5</priority>\n';
    xml += '  </url>\n';

    xml += '  <url>\n';
    xml += `    <loc>${baseUrl}/privacy</loc>\n`;
    xml += '    <changefreq>yearly</changefreq>\n';
    xml += '    <priority>0.3</priority>\n';
    xml += '  </url>\n';

    xml += '  <url>\n';
    xml += `    <loc>${baseUrl}/terms</loc>\n`;
    xml += '    <changefreq>yearly</changefreq>\n';
    xml += '    <priority>0.3</priority>\n';
    xml += '  </url>\n';

    xml += '  <url>\n';
    xml += `    <loc>${baseUrl}/dmca</loc>\n`;
    xml += '    <changefreq>yearly</changefreq>\n';
    xml += '    <priority>0.3</priority>\n';
    xml += '  </url>\n';

    // Add trends/news articles
    trendsResult.rows.forEach(article => {
      const slug = slugify(article.title);
      const lastmod = article.updated_at || article.created_at;
      const formattedDate = new Date(lastmod).toISOString().split('T')[0];

      xml += '  <url>\n';
      xml += `    <loc>${baseUrl}/news/${article.id}-${slug}</loc>\n`;
      xml += `    <lastmod>${formattedDate}</lastmod>\n`;
      xml += '    <changefreq>weekly</changefreq>\n';
      xml += '    <priority>0.8</priority>\n';
      xml += '  </url>\n';
    });

    // Add write-up articles
    articlesResult.rows.forEach(article => {
      const slug = slugify(article.title);
      const lastmod = article.updated_at || article.created_at;
      const formattedDate = new Date(lastmod).toISOString().split('T')[0];

      xml += '  <url>\n';
      xml += `    <loc>${baseUrl}/article/${article.id}-${slug}</loc>\n`;
      xml += `    <lastmod>${formattedDate}</lastmod>\n`;
      xml += '    <changefreq>weekly</changefreq>\n';
      xml += '    <priority>0.8</priority>\n';
      xml += '  </url>\n';
    });

    // Add overalls
    overallsResult.rows.forEach(overall => {
      const lastmod = overall.updated_at || overall.created_at;
      const formattedDate = new Date(lastmod).toISOString().split('T')[0];

      xml += '  <url>\n';
      xml += `    <loc>${baseUrl}/overalls/${overall.slug}</loc>\n`;
      xml += `    <lastmod>${formattedDate}</lastmod>\n`;
      xml += '    <changefreq>weekly</changefreq>\n';
      xml += '    <priority>0.8</priority>\n';
      xml += '  </url>\n';
    });

    // Close XML
    xml += '</urlset>';

    res.header('Content-Type', 'application/xml');
    res.send(xml);
  } catch (error) {
    console.error('Error generating LowkeyGrid sitemap:', error);
    res.status(500).send('Error generating sitemap');
  }
});

export default router;
