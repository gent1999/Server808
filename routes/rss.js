import express from 'express';
import pool from '../config/db.js';

const router = express.Router();

const BASE_URL = 'https://cry808.com';

const slugify = (text) =>
  text.toString().toLowerCase().trim()
    .replace(/\s+/g, '-')
    .replace(/[^\w\-]+/g, '')
    .replace(/\-\-+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');

const articleUrl = (id, title) =>
  `${BASE_URL}/article/${id}-${slugify(title)}`;

const esc = (str) =>
  (str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const stripMarkdown = (text) =>
  (text || '')
    .replace(/!\[.*?\]\(.*?\)/g, '')
    .replace(/\[([^\]]+)\]\(.*?\)/g, '$1')
    .replace(/#{1,6}\s/g, '')
    .replace(/[*_~`>]/g, '')
    .replace(/\n+/g, ' ')
    .trim();

const CATEGORY_LABELS = {
  article:   'Music News',
  interview: 'Interview',
  review:    'Review',
  guides:    'Guide',
};

router.get('/rss.xml', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, title, author, content, image_url, categories, category, created_at
       FROM articles
       WHERE site = 'cry808'
       ORDER BY created_at DESC
       LIMIT 100`
    );

    const lastBuildDate = rows.length
      ? new Date(rows[0].created_at).toUTCString()
      : new Date().toUTCString();
    const year = new Date().getFullYear();

    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xml += '<rss version="2.0"\n';
    xml += '  xmlns:atom="http://www.w3.org/2005/Atom"\n';
    xml += '  xmlns:media="http://search.yahoo.com/mrss/">\n';
    xml += '  <channel>\n';
    xml += '    <title>Cry808</title>\n';
    xml += `    <link>${BASE_URL}</link>\n`;
    xml += '    <description>Independent Hip-Hop, Rap, and R&amp;B Music Blog</description>\n';
    xml += '    <language>en-us</language>\n';
    xml += `    <copyright>Copyright ${year} Cry808. All rights reserved.</copyright>\n`;
    xml += `    <lastBuildDate>${lastBuildDate}</lastBuildDate>\n`;
    xml += `    <atom:link href="${BASE_URL}/rss.xml" rel="self" type="application/rss+xml"/>\n`;

    for (const article of rows) {
      const url = articleUrl(article.id, article.title);
      const pubDate = new Date(article.created_at).toUTCString();
      const excerpt = esc(stripMarkdown(article.content).slice(0, 220));
      const cats = Array.isArray(article.categories) && article.categories.length
        ? article.categories
        : article.category ? [article.category] : ['article'];

      xml += '    <item>\n';
      xml += `      <title>${esc(article.title)}</title>\n`;
      xml += `      <link>${url}</link>\n`;
      xml += `      <guid isPermaLink="true">${url}</guid>\n`;
      xml += `      <pubDate>${pubDate}</pubDate>\n`;
      xml += '      <author>Cry808</author>\n';
      for (const cat of cats) {
        xml += `      <category>${esc(CATEGORY_LABELS[cat] || cat)}</category>\n`;
      }
      xml += `      <description>${excerpt}</description>\n`;
      if (article.image_url) {
        xml += `      <media:content url="${esc(article.image_url)}" medium="image"/>\n`;
      }
      xml += '    </item>\n';
    }

    xml += '  </channel>\n';
    xml += '</rss>';

    res.setHeader('Content-Type', 'application/rss+xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.send(xml);
  } catch (err) {
    console.error('[RSS] Error generating feed:', err.message);
    res.status(500).send('Error generating RSS feed');
  }
});

export default router;
