// Validates X-808-API-KEY header for machine-to-machine calls (808-engine ↔ Server808).
import pool from '../config/db.js';

// Engine API key auth — used by local agents
export function engineAuth(req, res, next) {
  const key = req.header('X-808-API-KEY');
  if (!key || key !== process.env.ENGINE_API_KEY) {
    return res.status(401).json({ message: 'Invalid engine API key' });
  }
  next();
}

// Accepts either admin JWT or engine API key
export function bothAuth(adminAuthMiddleware) {
  return (req, res, next) => {
    const key = req.header('X-808-API-KEY');
    if (key) {
      if (key === process.env.ENGINE_API_KEY) return next();
      return res.status(401).json({ message: 'Invalid engine API key' });
    }
    return adminAuthMiddleware(req, res, next);
  };
}
