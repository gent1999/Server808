import express from 'express';
import fetch from 'node-fetch';
import auth from '../middleware/auth.js';
import { getCached, setCached } from '../utils/cache.js';

const router = express.Router();
const CACHE_KEY = 'neon:usage';
const CACHE_TTL = 300; // 5 minutes — no need to hammer Neon's API

// @route   GET /api/neon/usage
// @desc    Fetch compute usage for the current billing period from Neon's API
// @access  Private (admin only)
router.get('/usage', auth, async (req, res) => {
  const cached = getCached(CACHE_KEY);
  if (cached) return res.json(cached);

  const projectId = process.env.NEON_PROJECT_ID;
  const apiKey    = process.env.NEON_API_KEY;

  if (!projectId || !apiKey) {
    return res.status(503).json({ message: 'NEON_PROJECT_ID or NEON_API_KEY not configured' });
  }

  try {
    const response = await fetch(
      `https://console.neon.tech/api/v2/projects/${projectId}`,
      { headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' } }
    );

    if (!response.ok) {
      const text = await response.text();
      return res.status(502).json({ message: `Neon API error ${response.status}: ${text}` });
    }

    const { project } = await response.json();

    // compute_time_seconds = total CU-seconds in the current billing period
    // CU-hours = compute_time_seconds / 3600
    const cuSeconds = project.compute_time_seconds ?? project.cpu_used_sec ?? 0;
    const cuHoursUsed  = cuSeconds / 3600;
    const cuHoursLimit = 100; // free tier
    const pct          = Math.min(100, Math.round((cuHoursUsed / cuHoursLimit) * 100));

    const periodStart = project.consumption_period_start ?? null;
    const periodEnd   = project.consumption_period_end   ?? null;

    // Days remaining in the billing period
    let daysLeft = null;
    if (periodEnd) {
      const msLeft = new Date(periodEnd) - Date.now();
      daysLeft = Math.max(0, Math.ceil(msLeft / (1000 * 60 * 60 * 24)));
    }

    const payload = {
      cuHoursUsed:  Math.round(cuHoursUsed * 10) / 10,
      cuHoursLimit,
      percentUsed:  pct,
      daysLeft,
      periodStart,
      periodEnd,
      projectName:  project.name ?? '808',
      // extra stats Neon reports
      dataStorageGBHour: project.data_storage_bytes_hour
        ? Math.round((project.data_storage_bytes_hour / 1073741824) * 100) / 100
        : null,
      dataTransferGB: project.data_transfer_bytes
        ? Math.round((project.data_transfer_bytes / 1073741824) * 100) / 100
        : null,
    };

    setCached(CACHE_KEY, payload, CACHE_TTL);
    res.json(payload);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

export default router;
