import fetch from 'node-fetch';

/**
 * Notify search engines that the sitemap has been updated
 * This helps search engines discover new/updated content faster
 */
export const pingSitemap = async (sitemapUrl = 'https://cry808.com/sitemap.xml') => {
  const results = {
    google: { success: false, error: null },
    bing: { success: false, error: null }
  };

  // Google Search Console Ping
  try {
    const googlePingUrl = `https://www.google.com/ping?sitemap=${encodeURIComponent(sitemapUrl)}`;
    const googleResponse = await fetch(googlePingUrl, { method: 'GET' });

    if (googleResponse.ok || googleResponse.status === 200) {
      results.google.success = true;
      console.log('✓ Successfully pinged Google about sitemap update');
    } else {
      results.google.error = `HTTP ${googleResponse.status}`;
      console.warn('⚠ Google sitemap ping returned non-200 status:', googleResponse.status);
    }
  } catch (error) {
    results.google.error = error.message;
    console.error('✗ Failed to ping Google:', error.message);
  }

  // Bing Webmaster Tools Ping
  try {
    const bingPingUrl = `https://www.bing.com/ping?sitemap=${encodeURIComponent(sitemapUrl)}`;
    const bingResponse = await fetch(bingPingUrl, { method: 'GET' });

    if (bingResponse.ok || bingResponse.status === 200) {
      results.bing.success = true;
      console.log('✓ Successfully pinged Bing about sitemap update');
    } else {
      results.bing.error = `HTTP ${bingResponse.status}`;
      console.warn('⚠ Bing sitemap ping returned non-200 status:', bingResponse.status);
    }
  } catch (error) {
    results.bing.error = error.message;
    console.error('✗ Failed to ping Bing:', error.message);
  }

  return results;
};

/**
 * Request immediate indexing for a specific URL using Google's IndexNow API
 * IndexNow is supported by Google, Bing, Yandex, and other search engines
 */
export const requestIndexing = async (url, apiKey = null) => {
  if (!apiKey) {
    console.warn('⚠ No IndexNow API key provided. Skipping instant indexing request.');
    return { success: false, error: 'No API key' };
  }

  try {
    // IndexNow API endpoint (works for Google, Bing, Yandex, etc.)
    const indexNowUrl = 'https://api.indexnow.org/indexnow';

    const response = await fetch(indexNowUrl, {
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
      console.log('✓ Successfully requested indexing for:', url);
      return { success: true, url };
    } else {
      console.warn('⚠ IndexNow request returned status:', response.status);
      return { success: false, error: `HTTP ${response.status}`, url };
    }
  } catch (error) {
    console.error('✗ Failed to request indexing:', error.message);
    return { success: false, error: error.message, url };
  }
};

export default { pingSitemap, requestIndexing };
