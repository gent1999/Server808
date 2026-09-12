import { purgeUrls } from './cloudflarePurge.js';

// Cry808's own public route structure — deliberately not shared with
// lowkeygrid/2koveralls, which have entirely separate pages, zones, and
// purge needs (see cloudflarePurge.js's SITES map).
const SITE = 'cry808';
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

// 2KOveralls cross-embeds Cry808's articles verbatim at the same
// /article/:id-slug shape on its own domain (see 2koveralls'
// ArticleDetail.jsx and api/article/[slug].js, which both query Cry808's
// own articles table directly, and src/utils/slugify.js's identical
// slugify()). A Cry808 article mutation has to purge that mirrored URL on
// 2koveralls' own zone too, or its cached copy goes stale independently.
const KOVERALLS_SITE = '2koveralls';
const KOVERALLS_URL = 'https://2koveralls.com';

function koverallsMirrorUrl(article) {
  if (!article) return null;
  return `${KOVERALLS_URL}/article/${article.id}-${slugify(article.title)}`;
}

/**
 * A new article went live — purge the listing pages plus its own URL, on
 * both Cry808's zone and 2KOveralls' mirrored copy.
 */
export function purgeArticleCreated(article) {
  return Promise.all([
    purgeUrls(SITE, [...LISTING_PAGES, articleUrl(article)]),
    purgeUrls(KOVERALLS_SITE, [koverallsMirrorUrl(article)]),
  ]);
}

/**
 * An article was deleted — purge the listing pages plus the URL it used to
 * occupy, so it stops showing up anywhere immediately, on both zones.
 */
export function purgeArticleDeleted(article) {
  return Promise.all([
    purgeUrls(SITE, [...LISTING_PAGES, articleUrl(article)]),
    purgeUrls(KOVERALLS_SITE, [koverallsMirrorUrl(article)]),
  ]);
}

/**
 * An article was edited — purge the union of its pre- and post-edit URLs
 * (title/slug may have changed) plus the listing pages, so a stale entry
 * under the old slug/category never lingers, on both zones.
 */
export function purgeArticleUpdated(before, after) {
  return Promise.all([
    purgeUrls(SITE, [...LISTING_PAGES, articleUrl(before), articleUrl(after)]),
    purgeUrls(KOVERALLS_SITE, [koverallsMirrorUrl(before), koverallsMirrorUrl(after)]),
  ]);
}

/**
 * Feature-carousel toggle — only the home page's carousel is affected.
 */
export function purgeHome() {
  return purgeUrls(SITE, [`${SITE_URL}/`]);
}
