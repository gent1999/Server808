import express from "express";
import { BetaAnalyticsDataClient } from "@google-analytics/data";
import auth from "../middleware/auth.js";

const router = express.Router();

// Initialize the GA4 client
let analyticsDataClient;

try {
  // Service account credentials will be loaded from environment variable
  // or from the default path (GOOGLE_APPLICATION_CREDENTIALS)
  analyticsDataClient = new BetaAnalyticsDataClient();
} catch (error) {
  console.warn("Google Analytics client not initialized:", error.message);
}

// @route   GET /api/analytics/visitors
// @desc    Get monthly visitor stats from Google Analytics
// @access  Private (Admin only)
router.get("/visitors", auth, async (req, res) => {
  try {
    if (!analyticsDataClient) {
      return res.status(503).json({
        message: "Google Analytics not configured",
        visitors: {
          current: 0,
          previous: 0,
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

    // Get realtime active users
    const [realtimeResponse] = await analyticsDataClient.runRealtimeReport({
      property: `properties/${propertyId}`,
      metrics: [
        { name: "activeUsers" },
      ],
    });

    const currentMonthVisitors = parseInt(currentMonthResponse.rows?.[0]?.metricValues?.[0]?.value || 0);
    const previousMonthVisitors = parseInt(previousMonthResponse.rows?.[0]?.metricValues?.[0]?.value || 0);
    const realtimeVisitors = parseInt(realtimeResponse.rows?.[0]?.metricValues?.[0]?.value || 0);

    // Calculate percentage change
    let change = 0;
    if (previousMonthVisitors > 0) {
      change = ((currentMonthVisitors - previousMonthVisitors) / previousMonthVisitors) * 100;
    }

    res.json({
      visitors: {
        current: currentMonthVisitors,
        previous: previousMonthVisitors,
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
        change: 0,
        realtime: 0
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
