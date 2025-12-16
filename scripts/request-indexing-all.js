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
 * Request indexing for a single URL using Google Indexing API
 *
 * IMPORTANT: This requires Google Indexing API credentials
 * See setup instructions in GOOGLE_INDEXING_SETUP.md
 */
async function requestGoogleIndexing(url, accessToken) {
  try {
    const response = await fetch('https://indexing.googleapis.com/v3/urlNotifications:publish', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`
      },
      body: JSON.stringify({
        url: url,
        type: 'URL_UPDATED'
      })
    });

    if (response.ok) {
      const data = await response.json();
      console.log(`✓ Requested indexing for: ${url}`);
      return { success: true, url, data };
    } else {
      const error = await response.text();
      console.error(`✗ Failed to request indexing for ${url}:`, response.status, error);
      return { success: false, url, error: `HTTP ${response.status}: ${error}` };
    }
  } catch (error) {
    console.error(`✗ Error requesting indexing for ${url}:`, error.message);
    return { success: false, url, error: error.message };
  }
}

/**
 * Submit URL to IndexNow API (instant indexing for Bing, Google, Yandex, etc.)
 * This is simpler than Google Indexing API and doesn't require OAuth
 */
async function requestIndexNow(url, apiKey) {
  try {
    const response = await fetch('https://api.indexnow.org/indexnow', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        host: 'cry808.com',
        key: apiKey,
        keyLocation: `https://cry808.com/${apiKey}.txt`,
        urlList: [url]
      })
    });

    if (response.ok || response.status === 200 || response.status === 202) {
      console.log(`✓ IndexNow: ${url}`);
      return { success: true, url };
    } else {
      console.warn(`⚠ IndexNow failed for ${url}: HTTP ${response.status}`);
      return { success: false, url, error: `HTTP ${response.status}` };
    }
  } catch (error) {
    console.error(`✗ IndexNow error for ${url}:`, error.message);
    return { success: false, url, error: error.message };
  }
}

/**
 * Main function to request indexing for all articles
 */
async function requestIndexingForAllArticles() {
  console.log('🚀 Starting indexing request for all articles...\n');

  try {
    // Fetch all articles from database
    const result = await pool.query(
      'SELECT id, title, created_at FROM articles ORDER BY created_at DESC'
    );

    const articles = result.rows;
    console.log(`📊 Found ${articles.length} articles to request indexing for\n`);

    if (articles.length === 0) {
      console.log('No articles found in database.');
      await pool.end();
      return;
    }

    // Check for IndexNow API key in environment
    const indexNowKey = process.env.INDEXNOW_API_KEY;
    const googleAccessToken = process.env.GOOGLE_INDEXING_ACCESS_TOKEN;

    if (!indexNowKey && !googleAccessToken) {
      console.warn('⚠ WARNING: No API keys found!');
      console.warn('Set INDEXNOW_API_KEY or GOOGLE_INDEXING_ACCESS_TOKEN in your .env file');
      console.warn('See GOOGLE_INDEXING_SETUP.md for instructions\n');
      console.log('📝 Here are all your article URLs for manual submission:\n');

      // Just print URLs for manual submission
      articles.forEach((article, index) => {
        const url = generateArticleUrl(article.id, article.title);
        console.log(`${index + 1}. ${url}`);
      });

      console.log('\n💡 Copy these URLs and submit them manually to:');
      console.log('   - Google Search Console: https://search.google.com/search-console');
      console.log('   - Bing Webmaster Tools: https://www.bing.com/webmasters');

      await pool.end();
      return;
    }

    // Request indexing for each article
    const results = {
      indexNow: { success: 0, failed: 0 },
      google: { success: 0, failed: 0 }
    };

    for (let i = 0; i < articles.length; i++) {
      const article = articles[i];
      const url = generateArticleUrl(article.id, article.title);

      console.log(`[${i + 1}/${articles.length}] Processing: ${article.title.substring(0, 60)}...`);

      // Try IndexNow first (simpler, no auth required)
      if (indexNowKey) {
        const indexNowResult = await requestIndexNow(url, indexNowKey);
        if (indexNowResult.success) {
          results.indexNow.success++;
        } else {
          results.indexNow.failed++;
        }

        // Rate limiting - wait 1 second between requests
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      // Try Google Indexing API (requires OAuth token)
      if (googleAccessToken) {
        const googleResult = await requestGoogleIndexing(url, googleAccessToken);
        if (googleResult.success) {
          results.google.success++;
        } else {
          results.google.failed++;
        }

        // Rate limiting - wait 1 second between requests
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('📊 INDEXING REQUEST SUMMARY');
    console.log('='.repeat(60));
    console.log(`Total articles: ${articles.length}`);

    if (indexNowKey) {
      console.log(`\nIndexNow API:`);
      console.log(`  ✓ Success: ${results.indexNow.success}`);
      console.log(`  ✗ Failed: ${results.indexNow.failed}`);
    }

    if (googleAccessToken) {
      console.log(`\nGoogle Indexing API:`);
      console.log(`  ✓ Success: ${results.google.success}`);
      console.log(`  ✗ Failed: ${results.google.failed}`);
    }

    console.log('\n✅ Done! Search engines have been notified.');
    console.log('⏱  It may take 24-48 hours for URLs to appear in search results.');
    console.log('='.repeat(60) + '\n');

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await pool.end();
  }
}

// Run the script
requestIndexingForAllArticles();
