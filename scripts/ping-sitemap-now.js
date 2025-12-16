import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

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
  return `https://cry808.com/article/${id}-${slug}`;
};

/**
 * Ping Google and Bing about sitemap update
 */
async function pingSitemap() {
  const sitemapUrl = 'https://cry808.com/sitemap.xml';

  console.log('🔔 Pinging search engines about sitemap update...\n');

  // Ping Google
  try {
    const googlePingUrl = `https://www.google.com/ping?sitemap=${encodeURIComponent(sitemapUrl)}`;
    const googleResponse = await fetch(googlePingUrl, { method: 'GET' });

    if (googleResponse.ok || googleResponse.status === 200) {
      console.log('✅ Google: Sitemap ping successful');
    } else {
      console.log(`⚠️  Google: HTTP ${googleResponse.status} (may still work)`);
    }
  } catch (error) {
    console.log(`❌ Google: Failed - ${error.message}`);
  }

  // Ping Bing
  try {
    const bingPingUrl = `https://www.bing.com/ping?sitemap=${encodeURIComponent(sitemapUrl)}`;
    const bingResponse = await fetch(bingPingUrl, { method: 'GET' });

    if (bingResponse.ok || bingResponse.status === 200) {
      console.log('✅ Bing: Sitemap ping successful');
    } else {
      console.log(`⚠️  Bing: HTTP ${bingResponse.status} (may still work)`);
    }
  } catch (error) {
    console.log(`❌ Bing: Failed - ${error.message}`);
  }

  console.log('\n' + '='.repeat(70) + '\n');
}

/**
 * Main function
 */
async function main() {
  console.log('\n' + '='.repeat(70));
  console.log('  🚀 CRY808 IMMEDIATE INDEXING ACTION SCRIPT');
  console.log('='.repeat(70) + '\n');

  try {
    // Step 1: Ping sitemap to Google and Bing
    await pingSitemap();

    // Step 2: Fetch all articles and display URLs
    console.log('📋 Fetching all article URLs for manual submission...\n');

    const result = await pool.query(
      'SELECT id, title, created_at FROM articles ORDER BY created_at DESC'
    );

    const articles = result.rows;

    if (articles.length === 0) {
      console.log('⚠️  No articles found in database.');
      await pool.end();
      return;
    }

    console.log(`📊 Found ${articles.length} articles\n`);
    console.log('='.repeat(70));
    console.log('  YOUR ARTICLE URLS FOR GOOGLE SEARCH CONSOLE');
    console.log('='.repeat(70) + '\n');

    // Display all URLs
    articles.forEach((article, index) => {
      const url = generateArticleUrl(article.id, article.title);
      const date = new Date(article.created_at).toLocaleDateString();
      console.log(`${String(index + 1).padStart(3)}. ${url}`);
      console.log(`     Title: ${article.title.substring(0, 70)}${article.title.length > 70 ? '...' : ''}`);
      console.log(`     Date: ${date}\n`);
    });

    console.log('='.repeat(70) + '\n');

    // Instructions
    console.log('📝 NEXT STEPS - DO THESE NOW:\n');
    console.log('1️⃣  Go to Google Search Console: https://search.google.com/search-console');
    console.log('    - Make sure cry808.com is verified');
    console.log('    - Go to "Sitemaps" and submit: sitemap.xml\n');

    console.log('2️⃣  Request Indexing for Priority Articles:');
    console.log('    - In Google Search Console, click "URL Inspection" (top)');
    console.log('    - Copy/paste URLs from above (start with newest articles)');
    console.log('    - Click "Request Indexing" for each URL');
    console.log('    - You can do ~10-20 per day\n');

    console.log('3️⃣  Check Bing Webmaster Tools: https://www.bing.com/webmasters');
    console.log('    - Add your site if you haven\'t');
    console.log('    - Submit sitemap there too\n');

    console.log('4️⃣  Verify Your Articles Are Accessible:');
    console.log('    - Visit a few URLs from the list above');
    console.log('    - Make sure they load correctly');
    console.log('    - Check for proper titles and meta descriptions\n');

    console.log('⏱️  EXPECTED TIMELINE:\n');
    console.log('    - Sitemap crawl: 24-48 hours');
    console.log('    - Manual URL requests: Minutes to hours');
    console.log('    - Full indexing: 2-7 days for all articles\n');

    console.log('💡 AUTOMATION ALREADY SET UP:\n');
    console.log('    ✅ Every new article automatically pings Google & Bing');
    console.log('    ✅ Every updated article automatically pings Google & Bing');
    console.log('    ✅ Your sitemap is dynamic and always up-to-date\n');

    console.log('📖 For advanced setup (IndexNow API, Google Indexing API):');
    console.log('    See: GOOGLE_INDEXING_SETUP.md\n');

    console.log('='.repeat(70) + '\n');
    console.log('✅ Done! Now go submit those URLs to Google Search Console!\n');

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await pool.end();
  }
}

// Run the script
main();
