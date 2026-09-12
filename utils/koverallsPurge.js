import { purgeUrls } from './cloudflarePurge.js';

// 2KOveralls' own public route structure. Two content types render at the
// same /news/:id-slug URL shape via the same generateNewsUrl() convention on
// the frontend, but live in separate tables with separate id spaces:
//   - koveralls_articles ("write-ups", 2koveralls-only table)
//   - articles WHERE site='lowkeygrid' ("trends")
// Both use the purgeNewsItem* helpers below since the purge target (the URL)
// is computed the same way regardless of which table the row came from.
const SITE = '2koveralls';
const SITE_URL = 'https://2koveralls.com';

const LISTING_PAGES = [
  `${SITE_URL}/`,
  `${SITE_URL}/news`,
  `${SITE_URL}/overalls`,
  `${SITE_URL}/rankings`,
  `${SITE_URL}/sitemap.xml`,
];

// Matches the slug logic already used in routes/lowkeygridSitemap.js and
// src/utils/slugify.js on the frontend.
function slugify(title) {
  return (title || '')
    .toString()
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\w-]+/g, '')
    .replace(/-{2,}/g, '-');
}

function newsUrl(item) {
  if (!item) return null;
  return `${SITE_URL}/news/${item.id}-${slugify(item.title)}`;
}

function overallUrl(overall) {
  if (!overall) return null;
  return `${SITE_URL}/overalls/${overall.slug}`;
}

/**
 * A news item (write-up or trends article) went live.
 */
export function purgeNewsItemCreated(item) {
  return purgeUrls(SITE, [...LISTING_PAGES, newsUrl(item)]);
}

/**
 * A news item was deleted — purge the listing pages plus the URL it used to
 * occupy.
 */
export function purgeNewsItemDeleted(item) {
  return purgeUrls(SITE, [...LISTING_PAGES, newsUrl(item)]);
}

/**
 * A news item was edited — purge the union of its pre- and post-edit URLs
 * (title changes the slug) plus the listing pages.
 */
export function purgeNewsItemUpdated(before, after) {
  return purgeUrls(SITE, [...LISTING_PAGES, newsUrl(before), newsUrl(after)]);
}

/**
 * A rating went live.
 */
export function purgeOverallCreated(overall) {
  return purgeUrls(SITE, [...LISTING_PAGES, overallUrl(overall)]);
}

/**
 * A rating was deleted.
 */
export function purgeOverallDeleted(overall) {
  return purgeUrls(SITE, [...LISTING_PAGES, overallUrl(overall)]);
}

/**
 * A rating was edited — union of pre- and post-edit slugs (editing the title
 * regenerates the slug on Server808's side).
 */
export function purgeOverallUpdated(before, after) {
  return purgeUrls(SITE, [...LISTING_PAGES, overallUrl(before), overallUrl(after)]);
}

/**
 * Home-only toggles: featured write-up/trends article, hero/square-featured
 * overall. None of these change the item's own detail page, only what shows
 * on the home page.
 */
export function purgeHome() {
  return purgeUrls(SITE, [`${SITE_URL}/`]);
}
