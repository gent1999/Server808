import express from "express";
import pool from "../config/db.js";
import auth from "../middleware/auth.js";

const router = express.Router();

// @route   GET /api/admin/settings
// @desc    Get all settings
// @access  Private (Admin only)
router.get("/", auth, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT key, value FROM settings ORDER BY key"
    );

    // Convert rows to object format
    const settings = {};
    result.rows.forEach(row => {
      settings[row.key] = row.value;
    });

    res.json({ settings });
  } catch (error) {
    console.error("Error fetching settings:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// @route   PUT /api/admin/settings
// @desc    Update settings
// @access  Private (Admin only)
router.put("/", auth, async (req, res) => {
  try {
    const { settings } = req.body;

    if (!settings || typeof settings !== 'object') {
      return res.status(400).json({ message: "Invalid settings format" });
    }

    // Update each setting in a transaction
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      for (const [key, value] of Object.entries(settings)) {
        await client.query(
          "UPDATE settings SET value = $1, updated_at = CURRENT_TIMESTAMP WHERE key = $2",
          [value, key]
        );
      }

      await client.query('COMMIT');

      res.json({
        message: "Settings updated successfully",
        settings
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("Error updating settings:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// @route   GET /api/settings
// @desc    Get public settings (for frontend config)
// @access  Public
router.get("/public", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT key, value FROM settings WHERE key IN ('adsterra_enabled', 'hilltop_enabled', 'monetag_enabled')"
    );

    // Convert rows to object format
    const settings = {};
    result.rows.forEach(row => {
      settings[row.key] = row.value;
    });

    res.json({ settings });
  } catch (error) {
    console.error("Error fetching public settings:", error);
    res.status(500).json({ message: "Server error" });
  }
});

export default router;
