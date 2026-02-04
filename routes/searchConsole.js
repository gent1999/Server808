import express from "express";
import { google } from "googleapis";
import auth from "../middleware/auth.js";

const router = express.Router();

// Initialize Google Search Console client
let searchConsole;
let initError = null;

try {
  // Check if we have JSON credentials in environment variable (for Vercel/production)
  if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
    console.log("🔍 Initializing Google Search Console with GOOGLE_SERVICE_ACCOUNT_KEY...");
    const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);

    const auth = new google.auth.GoogleAuth({
      credentials: credentials,
      scopes: ["https://www.googleapis.com/auth/webmasters.readonly"],
    });

    searchConsole = google.searchconsole({ version: "v1", auth });
    console.log("✅ Google Search Console initialized with GOOGLE_SERVICE_ACCOUNT_KEY");
  }
  // Fall back to file path (GOOGLE_APPLICATION_CREDENTIALS for local development)
  else {
    console.log("🔍 Using GOOGLE_APPLICATION_CREDENTIALS file path for Search Console");
    const auth = new google.auth.GoogleAuth({
      scopes: ["https://www.googleapis.com/auth/webmasters.readonly"],
    });

    searchConsole = google.searchconsole({ version: "v1", auth });
    console.log("✅ Google Search Console initialized with credentials file");
  }
} catch (error) {
  initError = error.message;
  console.error("❌ Google Search Console initialization failed:");
  console.error("Error:", error.message);
}

// Helper to resolve site URL from query param or env var
function getSiteUrl(req) {
  const site = req.query.site;
  if (site === '2koveralls') {
    return process.env.GSC_SITE_URL_2KOVERALLS || null;
  }
  // Default to cry808 / GSC_SITE_URL
  return process.env.GSC_SITE_URL || null;
}

// @route   GET /api/search-console/performance
// @desc    Get overall search performance metrics
// @access  Private (Admin only)
router.get("/performance", auth, async (req, res) => {
  try {
    if (!searchConsole) {
      return res.status(503).json({
        message: initError ? `Search Console initialization failed: ${initError}` : "Google Search Console not configured",
        error: initError,
        performance: {
          clicks: 0,
          impressions: 0,
          ctr: 0,
          position: 0,
        }
      });
    }

    const siteUrl = getSiteUrl(req);
    if (!siteUrl) {
      return res.status(503).json({
        message: "GSC site URL not configured for this site",
        performance: {
          clicks: 0,
          impressions: 0,
          ctr: 0,
          position: 0,
        }
      });
    }

    // Get last 28 days performance
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 28);

    const response = await searchConsole.searchanalytics.query({
      siteUrl: siteUrl,
      requestBody: {
        startDate: formatDate(startDate),
        endDate: formatDate(endDate),
        dimensions: [],
        rowLimit: 1,
      },
    });

    const data = response.data.rows?.[0] || {};

    res.json({
      performance: {
        clicks: Math.round(data.clicks || 0),
        impressions: Math.round(data.impressions || 0),
        ctr: Math.round((data.ctr || 0) * 1000) / 10, // Convert to percentage with 1 decimal
        position: Math.round((data.position || 0) * 10) / 10, // Round to 1 decimal
      }
    });
  } catch (error) {
    console.error("Error fetching Search Console performance:", error);
    res.status(500).json({
      message: "Error fetching search console data",
      error: error.message,
      performance: {
        clicks: 0,
        impressions: 0,
        ctr: 0,
        position: 0,
      }
    });
  }
});

// @route   GET /api/search-console/top-queries
// @desc    Get top performing search queries (keywords)
// @access  Private (Admin only)
router.get("/top-queries", auth, async (req, res) => {
  try {
    if (!searchConsole) {
      return res.status(503).json({
        message: "Google Search Console not configured",
        queries: []
      });
    }

    const siteUrl = getSiteUrl(req);
    if (!siteUrl) {
      return res.status(503).json({
        message: "GSC site URL not configured for this site",
        queries: []
      });
    }

    // Get last 28 days
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 28);

    const response = await searchConsole.searchanalytics.query({
      siteUrl: siteUrl,
      requestBody: {
        startDate: formatDate(startDate),
        endDate: formatDate(endDate),
        dimensions: ["query"],
        rowLimit: 10, // Top 10 queries
      },
    });

    const queries = (response.data.rows || []).map(row => ({
      query: row.keys[0],
      clicks: Math.round(row.clicks || 0),
      impressions: Math.round(row.impressions || 0),
      ctr: Math.round((row.ctr || 0) * 1000) / 10,
      position: Math.round((row.position || 0) * 10) / 10,
    }));

    res.json({ queries });
  } catch (error) {
    console.error("Error fetching top queries:", error);
    res.status(500).json({
      message: "Error fetching top queries",
      error: error.message,
      queries: []
    });
  }
});

// @route   GET /api/search-console/top-pages
// @desc    Get top performing pages
// @access  Private (Admin only)
router.get("/top-pages", auth, async (req, res) => {
  try {
    if (!searchConsole) {
      return res.status(503).json({
        message: "Google Search Console not configured",
        pages: []
      });
    }

    const siteUrl = getSiteUrl(req);
    if (!siteUrl) {
      return res.status(503).json({
        message: "GSC site URL not configured for this site",
        pages: []
      });
    }

    // Get last 28 days
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 28);

    const response = await searchConsole.searchanalytics.query({
      siteUrl: siteUrl,
      requestBody: {
        startDate: formatDate(startDate),
        endDate: formatDate(endDate),
        dimensions: ["page"],
        rowLimit: 10, // Top 10 pages
      },
    });

    const pages = (response.data.rows || []).map(row => ({
      page: row.keys[0],
      clicks: Math.round(row.clicks || 0),
      impressions: Math.round(row.impressions || 0),
      ctr: Math.round((row.ctr || 0) * 1000) / 10,
      position: Math.round((row.position || 0) * 10) / 10,
    }));

    res.json({ pages });
  } catch (error) {
    console.error("Error fetching top pages:", error);
    res.status(500).json({
      message: "Error fetching top pages",
      error: error.message,
      pages: []
    });
  }
});

// @route   GET /api/search-console/index-status
// @desc    Get index coverage status
// @access  Private (Admin only)
router.get("/index-status", auth, async (req, res) => {
  try {
    if (!searchConsole) {
      return res.status(503).json({
        message: "Google Search Console not configured",
        indexStatus: {
          valid: 0,
          warning: 0,
          error: 0,
          excluded: 0,
        }
      });
    }

    const siteUrl = getSiteUrl(req);
    if (!siteUrl) {
      return res.status(503).json({
        message: "GSC site URL not configured for this site",
        indexStatus: {
          valid: 0,
          warning: 0,
          error: 0,
          excluded: 0,
        }
      });
    }

    // Note: Index coverage requires different API endpoint
    // For now, returning placeholder - you'll need urlInspection API for detailed index status
    res.json({
      indexStatus: {
        valid: 0,
        warning: 0,
        error: 0,
        excluded: 0,
      },
      message: "Index coverage requires URL Inspection API - implement if needed"
    });
  } catch (error) {
    console.error("Error fetching index status:", error);
    res.status(500).json({
      message: "Error fetching index status",
      error: error.message,
      indexStatus: {
        valid: 0,
        warning: 0,
        error: 0,
        excluded: 0,
      }
    });
  }
});

// @route   GET /api/search-console/article/:slug
// @desc    Get Search Console data for a specific article
// @access  Private (Admin only)
router.get("/article/:slug", auth, async (req, res) => {
  try {
    if (!searchConsole) {
      return res.status(503).json({
        message: "Google Search Console not configured",
        seo: {
          clicks: 0,
          impressions: 0,
          ctr: 0,
          position: 0,
          topQueries: []
        }
      });
    }

    const siteUrl = getSiteUrl(req);
    if (!siteUrl) {
      return res.status(503).json({
        message: "GSC site URL not configured for this site",
        seo: {
          clicks: 0,
          impressions: 0,
          ctr: 0,
          position: 0,
          topQueries: []
        }
      });
    }

    const { slug } = req.params;

    // Get last 28 days
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 28);

    // Get overall stats for this page
    const pageResponse = await searchConsole.searchanalytics.query({
      siteUrl: siteUrl,
      requestBody: {
        startDate: formatDate(startDate),
        endDate: formatDate(endDate),
        dimensionFilterGroups: [{
          filters: [{
            dimension: 'page',
            operator: 'contains',
            expression: slug
          }]
        }],
        dimensions: [],
        rowLimit: 1,
      },
    });

    const pageData = pageResponse.data.rows?.[0] || {};

    // Get top queries for this page
    const queriesResponse = await searchConsole.searchanalytics.query({
      siteUrl: siteUrl,
      requestBody: {
        startDate: formatDate(startDate),
        endDate: formatDate(endDate),
        dimensionFilterGroups: [{
          filters: [{
            dimension: 'page',
            operator: 'contains',
            expression: slug
          }]
        }],
        dimensions: ['query'],
        rowLimit: 5,
      },
    });

    const topQueries = (queriesResponse.data.rows || []).map(row => ({
      query: row.keys[0],
      clicks: Math.round(row.clicks || 0),
      impressions: Math.round(row.impressions || 0),
      ctr: Math.round((row.ctr || 0) * 1000) / 10,
      position: Math.round((row.position || 0) * 10) / 10,
    }));

    res.json({
      seo: {
        clicks: Math.round(pageData.clicks || 0),
        impressions: Math.round(pageData.impressions || 0),
        ctr: Math.round((pageData.ctr || 0) * 1000) / 10,
        position: Math.round((pageData.position || 0) * 10) / 10,
        topQueries
      }
    });
  } catch (error) {
    console.error("Error fetching article Search Console data:", error);
    res.status(500).json({
      message: "Error fetching article SEO data",
      error: error.message,
      seo: {
        clicks: 0,
        impressions: 0,
        ctr: 0,
        position: 0,
        topQueries: []
      }
    });
  }
});

// Helper function to format date as YYYY-MM-DD
function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export default router;
