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
          realtime: 0
        }
      });
    }

    const propertyId = process.env.GA_PROPERTY_ID;

    if (!propertyId) {
      return res.status(503).json({
        message: "GA_PROPERTY_ID not configured",
        visitors: {
          current: 0,
          previous: 0,
          allTime: 0,
          average: 0,
          change: 0,
          realtime: 0
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
        realtime: realtimeVisitors
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
        realtime: 0
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

// Helper function to format date as YYYY-MM-DD
function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export default router;
