import express from "express";
import { BetaAnalyticsDataClient } from "@google-analytics/data";
import auth from "../middleware/auth.js";

const router = express.Router();

// Initialize the GA4 client
let analyticsDataClient;
let initError = null;

try {
  // Check if we have JSON credentials in environment variable (for Vercel/production)
  if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
    console.log("🔍 Attempting to parse GOOGLE_SERVICE_ACCOUNT_KEY...");
    const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
    console.log("✅ Credentials parsed successfully");
    console.log("📧 Service account email:", credentials.client_email);

    analyticsDataClient = new BetaAnalyticsDataClient({
      credentials: credentials,
    });
    console.log("✅ Google Analytics initialized with GOOGLE_SERVICE_ACCOUNT_KEY");
  }
  // Fall back to file path (GOOGLE_APPLICATION_CREDENTIALS for local development)
  else {
    console.log("🔍 Using GOOGLE_APPLICATION_CREDENTIALS file path");
    // This will use the GOOGLE_APPLICATION_CREDENTIALS env var or default file
    analyticsDataClient = new BetaAnalyticsDataClient();
    console.log("✅ Google Analytics initialized with credentials file");
  }
} catch (error) {
  initError = error.message;
  console.error("❌ Google Analytics client initialization failed:");
  console.error("Error:", error.message);
  console.error("Stack:", error.stack);
}

// @route   GET /api/analytics/debug
// @desc    Debug analytics configuration
// @access  Public (temporary for debugging)
router.get("/debug", async (req, res) => {
  res.json({
    hasServiceAccountKey: !!process.env.GOOGLE_SERVICE_ACCOUNT_KEY,
    hasApplicationCredentials: !!process.env.GOOGLE_APPLICATION_CREDENTIALS,
    hasPropertyId: !!process.env.GA_PROPERTY_ID,
    propertyId: process.env.GA_PROPERTY_ID,
    clientInitialized: !!analyticsDataClient,
  });
});

// @route   GET /api/analytics/visitors
// @desc    Get monthly visitor stats from Google Analytics
// @access  Private (Admin only)
router.get("/visitors", auth, async (req, res) => {
  try {
    if (!analyticsDataClient) {
      return res.status(503).json({
        message: initError ? `Analytics initialization failed: ${initError}` : "Google Analytics not configured",
        error: initError,
        hasEnvVar: !!process.env.GOOGLE_SERVICE_ACCOUNT_KEY,
        hasPropertyId: !!process.env.GA_PROPERTY_ID,
        visitors: {
          current: 0,
          previous: 0,
          allTime: 0,
          average: 0,
          change: 0,
          realtime: 0,
          monthly: []
        }
      });
    }

    // Get site parameter from query (default to cry808)
    const site = req.query.site || 'cry808';

    // Select the appropriate property ID based on site
    let propertyId;
    if (site === '2koveralls' || site === 'lowkeygrid') {
      propertyId = process.env.GA_PROPERTY_ID_2KOVERALLS;
    } else {
      propertyId = process.env.GA_PROPERTY_ID_CRY808 || process.env.GA_PROPERTY_ID;
    }

    if (!propertyId) {
      return res.status(503).json({
        message: `GA_PROPERTY_ID not configured for site: ${site}`,
        visitors: {
          current: 0,
          previous: 0,
          allTime: 0,
          average: 0,
          change: 0,
          realtime: 0,
          monthly: []
        }
      });
    }

    // Get current month visitors (from start of month to today)
    const currentMonthStart = new Date();
    currentMonthStart.setDate(1);
    const today = new Date();

    const [currentMonthResponse] = await analyticsDataClient.runReport({
      property: `properties/${propertyId}`,
      dateRanges: [
        {
          startDate: formatDate(currentMonthStart),
          endDate: "today",
        },
      ],
      metrics: [
        { name: "activeUsers" },
      ],
    });

    // Get previous month visitors (full month)
    const previousMonthStart = new Date(currentMonthStart);
    previousMonthStart.setMonth(previousMonthStart.getMonth() - 1);
    const previousMonthEnd = new Date(currentMonthStart);
    previousMonthEnd.setDate(0); // Last day of previous month

    const [previousMonthResponse] = await analyticsDataClient.runReport({
      property: `properties/${propertyId}`,
      dateRanges: [
        {
          startDate: formatDate(previousMonthStart),
          endDate: formatDate(previousMonthEnd),
        },
      ],
      metrics: [
        { name: "activeUsers" },
      ],
    });

    // Get all-time visitors
    const [allTimeResponse] = await analyticsDataClient.runReport({
      property: `properties/${propertyId}`,
      dateRanges: [
        {
          startDate: "2020-01-01", // Start from a reasonable date in the past
          endDate: "today",
        },
      ],
      metrics: [
        { name: "activeUsers" },
      ],
    });

    // Get monthly breakdown for average calculation
    const [monthlyResponse] = await analyticsDataClient.runReport({
      property: `properties/${propertyId}`,
      dateRanges: [
        {
          startDate: "2020-01-01",
          endDate: "today",
        },
      ],
      dimensions: [
        { name: "yearMonth" }, // Format: YYYYMM
      ],
      metrics: [
        { name: "activeUsers" },
      ],
      orderBys: [
        {
          dimension: {
            dimensionName: "yearMonth",
          },
        },
      ],
      limit: 120,
    });

    // Get realtime active users
    const [realtimeResponse] = await analyticsDataClient.runRealtimeReport({
      property: `properties/${propertyId}`,
      metrics: [
        { name: "activeUsers" },
      ],
    });

    const currentMonthVisitors = parseInt(currentMonthResponse.rows?.[0]?.metricValues?.[0]?.value || 0);
    const previousMonthVisitors = parseInt(previousMonthResponse.rows?.[0]?.metricValues?.[0]?.value || 0);
    const allTimeVisitors = parseInt(allTimeResponse.rows?.[0]?.metricValues?.[0]?.value || 0);
    const realtimeVisitors = parseInt(realtimeResponse.rows?.[0]?.metricValues?.[0]?.value || 0);

    // Calculate average monthly visitors
    let averageMonthly = 0;
    const monthlyRows = (monthlyResponse.rows || [])
      .map(row => {
        const yearMonth = row.dimensionValues?.[0]?.value || "";
        const year = yearMonth.slice(0, 4);
        const month = yearMonth.slice(4, 6);
        const date = year && month ? `${year}-${month}-01` : null;

        return {
          yearMonth,
          date,
          label: date
            ? new Date(`${date}T00:00:00`).toLocaleDateString("en-US", { month: "short", year: "2-digit" })
            : yearMonth,
          visitors: parseInt(row.metricValues?.[0]?.value || 0),
        };
      })
      .filter(point => point.yearMonth)
      .sort((a, b) => a.yearMonth.localeCompare(b.yearMonth));
    const monthlyByKey = new Map(monthlyRows.map(point => [point.yearMonth, point]));
    const firstMonth = monthlyRows[0]?.yearMonth;
    const monthly = [];

    if (firstMonth) {
      const cursor = new Date(`${firstMonth.slice(0, 4)}-${firstMonth.slice(4, 6)}-01T00:00:00`);
      const end = new Date(today.getFullYear(), today.getMonth(), 1);

      while (cursor <= end) {
        const year = cursor.getFullYear();
        const month = String(cursor.getMonth() + 1).padStart(2, "0");
        const yearMonth = `${year}${month}`;
        const date = `${year}-${month}-01`;
        const existing = monthlyByKey.get(yearMonth);

        monthly.push(existing || {
          yearMonth,
          date,
          label: cursor.toLocaleDateString("en-US", { month: "short", year: "2-digit" }),
          visitors: 0,
        });

        cursor.setMonth(cursor.getMonth() + 1);
      }
    }

    if (monthlyResponse.rows && monthlyResponse.rows.length > 0) {
      const totalVisitors = monthlyResponse.rows.reduce((sum, row) => {
        return sum + parseInt(row.metricValues[0].value || 0);
      }, 0);
      averageMonthly = Math.round(totalVisitors / monthlyResponse.rows.length);
    }

    // Calculate percentage change
    let change = 0;
    if (previousMonthVisitors > 0) {
      change = ((currentMonthVisitors - previousMonthVisitors) / previousMonthVisitors) * 100;
    }

    res.json({
      visitors: {
        current: currentMonthVisitors,
        previous: previousMonthVisitors,
        allTime: allTimeVisitors,
        average: averageMonthly,
        change: Math.round(change * 10) / 10, // Round to 1 decimal
        realtime: realtimeVisitors,
        monthly
      }
    });
  } catch (error) {
    console.error("Error fetching analytics data:", error);
    res.status(500).json({
      message: "Error fetching analytics data",
      error: error.message,
      visitors: {
        current: 0,
        previous: 0,
        allTime: 0,
        average: 0,
        change: 0,
        realtime: 0,
        monthly: []
      }
    });
  }
});

// @route   GET /api/analytics/article/:slug
// @desc    Get analytics for a specific article
// @access  Private (Admin only)
router.get("/article/:slug", auth, async (req, res) => {
  try {
    if (!analyticsDataClient) {
      return res.status(503).json({
        message: "Google Analytics not configured",
        analytics: {
          pageViews: 0,
          uniqueVisitors: 0,
          avgTimeOnPage: 0,
          bounceRate: 0,
        }
      });
    }

    const propertyId = process.env.GA_PROPERTY_ID;
    if (!propertyId) {
      return res.status(503).json({
        message: "GA_PROPERTY_ID not configured",
        analytics: {
          pageViews: 0,
          uniqueVisitors: 0,
          avgTimeOnPage: 0,
          bounceRate: 0,
        }
      });
    }

    const { slug } = req.params;
    const pagePath = `/article/${slug}`;

    // Get analytics for the last 28 days for this specific page
    const [response] = await analyticsDataClient.runReport({
      property: `properties/${propertyId}`,
      dateRanges: [
        {
          startDate: "28daysAgo",
          endDate: "today",
        },
      ],
      dimensions: [
        { name: "pagePath" },
      ],
      dimensionFilter: {
        filter: {
          fieldName: "pagePath",
          stringFilter: {
            matchType: "CONTAINS",
            value: slug,
          },
        },
      },
      metrics: [
        { name: "screenPageViews" },
        { name: "activeUsers" },
        { name: "averageSessionDuration" },
        { name: "bounceRate" },
      ],
    });

    const data = response.rows?.[0]?.metricValues || [];

    res.json({
      analytics: {
        pageViews: parseInt(data[0]?.value || 0),
        uniqueVisitors: parseInt(data[1]?.value || 0),
        avgTimeOnPage: Math.round(parseFloat(data[2]?.value || 0)),
        bounceRate: Math.round(parseFloat(data[3]?.value || 0) * 100),
      }
    });
  } catch (error) {
    console.error("Error fetching article analytics:", error);
    res.status(500).json({
      message: "Error fetching article analytics",
      error: error.message,
      analytics: {
        pageViews: 0,
        uniqueVisitors: 0,
        avgTimeOnPage: 0,
        bounceRate: 0,
      }
    });
  }
});

// @route   GET /api/analytics/article-pages
// @desc    Bulk GA data for all /article/ pages — one request for the entire content library
// @access  Private (Admin only)
router.get("/article-pages", auth, async (req, res) => {
  if (!analyticsDataClient) {
    return res.json({ pages: {}, configured: false });
  }
  const propertyId = process.env.GA_PROPERTY_ID;
  if (!propertyId) return res.json({ pages: {}, configured: false });

  try {
    const [response] = await analyticsDataClient.runReport({
      property: `properties/${propertyId}`,
      dateRanges: [{ startDate: "28daysAgo", endDate: "today" }],
      dimensions: [{ name: "pagePath" }],
      dimensionFilter: {
        filter: {
          fieldName: "pagePath",
          stringFilter: { matchType: "BEGINS_WITH", value: "/article/" },
        },
      },
      metrics: [
        { name: "screenPageViews" },
        { name: "activeUsers" },
      ],
      limit: 1000,
    });

    const pages = {};
    (response.rows || []).forEach(row => {
      const path = row.dimensionValues[0]?.value;
      if (path) {
        pages[path] = {
          pageViews:      parseInt(row.metricValues[0]?.value || 0),
          uniqueVisitors: parseInt(row.metricValues[1]?.value || 0),
        };
      }
    });

    res.json({ pages, configured: true });
  } catch (error) {
    console.error("article-pages GA error:", error.message);
    res.json({ pages: {}, configured: true, error: error.message });
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
