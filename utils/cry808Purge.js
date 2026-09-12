import { purgeUrls } from './cloudflarePurge.js';

// Cry808's own public route structure — deliberately not shared with
// lowkeygrid/2koveralls, which have entirely separate pages and purge needs.
const SITE_URL = 'https://cry808.com';

const LISTING_PAGES = [
  `${SITE_URL}/`,
  `${SITE_URL}/news`,
  `${SITE_URL}/interviews`,
  `${SITE_URL}/sitemap.xml`,
  `${SITE_URL}/rss.xml`,
];

// Matches the slug logic already used in routes/articles.js and routes/sitemap.js.
function slugify(title) {
  return (title || '')
    .toString()
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\w-]+/g, '')
    .replace(/-{2,}/g, '-');
}

function articleUrl(article) {
  if (!article) return null;
  return `${SITE_URL}/article/${article.id}-${slugify(article.title)}`;
}

/**
 * A new article went live — purge the listing pages plus its own URL.
 */
export function purgeArticleCreated(article) {
  return purgeUrls([...LISTING_PAGES, articleUrl(article)]);
}

/**
 * An article was deleted — purge the listing pages plus the URL it used to
 * occupy, so it stops showing up anywhere immediately.
 */
export function purgeArticleDeleted(article) {
  return purgeUrls([...LISTING_PAGES, articleUrl(article)]);
}

/**
 * An article was edited — purge the union of its pre- and post-edit URLs
 * (title/slug may have changed) plus the listing pages, so a stale entry
 * under the old slug/category never lingers.
 */
export function purgeArticleUpdated(before, after) {
  return purgeUrls([...LISTING_PAGES, articleUrl(before), articleUrl(after)]);
}

/**
 * Feature-carousel toggle — only the home page's carousel is affected.
 */
export function purgeHome() {
  return purgeUrls([`${SITE_URL}/`]);
}
