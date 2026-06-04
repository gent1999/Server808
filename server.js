// server.js - Updated for multi-site analytics support
import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import dotenv from "dotenv";
import authRoutes from "./routes/auth.js";
import articlesRoutes from "./routes/articles.js";
import newsletterRoutes from "./routes/newsletter.js";
import featuredRoutes from "./routes/featured.js";
import submissionsRoutes from "./routes/submissions.js";
import spotifyEmbedsRoutes from "./routes/spotifyEmbeds.js";
import settingsRoutes from "./routes/settings.js";
import analyticsRoutes from "./routes/analytics.js";
import searchConsoleRoutes from "./routes/searchConsole.js";
import amazonProductsRoutes from "./routes/amazonProducts.js";
import sitemapRoutes from "./routes/sitemap.js";
import lowkeygridSitemapRoutes from "./routes/lowkeygridSitemap.js";
import overallsRoutes from "./routes/overalls.js";
import lowkeygridArticlesRoutes from "./routes/lowkeygridArticles.js";
import geniusRoutes from "./routes/genius.js";
import indexerRoutes from "./routes/indexer.js";
import financeRoutes from "./routes/finance.js";
import engineItemsRoutes from "./routes/engineItems.js";
import cortexRoutes from "./routes/cortex.js";
import neonRoutes from "./routes/neon.js";
import referralAdsRoutes from "./routes/referralAds.js";
import authMiddleware from "./middleware/auth.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// ── CORS ─────────────────────────────────────────────────────────────────────
// Only our own frontends are allowed to call this API from a browser.
// Direct server-to-server calls (808-engine, curl) are unaffected by CORS.
const ALLOWED_ORIGINS = [
  'https://cry808.com',
  'https://www.cry808.com',
  'https://lowkeygrid.com',
  'https://www.lowkeygrid.com',
  // Allow localhost in dev
  'http://localhost:5173',
  'http://localhost:3000',
  'http://localhost:4173',
];

const corsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (curl, Postman, server-to-server)
    if (!origin) return callback(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
    callback(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-808-API-KEY'],
};

app.use(cors(corsOptions));

// app.use(cors) already auto-handles OPTIONS preflight (responds 204 before
// reaching any route). Express 5 does NOT accept bare '*' as a path, so we
// do NOT add a separate app.options('*', ...) call here.

// ── Rate limiters ─────────────────────────────────────────────────────────────
// General limiter — covers all routes not overridden below
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many requests, please try again later.' },
});

// Strict limiter for auth (brute-force protection)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many login attempts, please try again later.' },
});

// Newsletter: 3 signups per hour per IP (tight — no legit user signs up more than once)
const newsletterLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many signup attempts, please try again later.' },
});

// Music submissions: 5 per hour per IP
const formLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Submission limit reached, please try again later.' },
});

// Genius lyrics — external scraper proxy, tighten to avoid abuse
const geniusLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many requests.' },
});

app.use(generalLimiter);

app.use(express.json());

// Basic route (for testing)
app.get("/", (req, res) => {
  res.send("Server is running 🚀");
});

// Auth routes (public routes like login, register)
app.use("/api/auth", authLimiter, (req, res, next) => {
  // Apply auth middleware only to specific routes
  if (req.path === '/delete-account') {
    return authMiddleware(req, res, next);
  }
  next();
}, authRoutes);

// Articles routes (protected routes for POST, PUT, DELETE)
app.use("/api/articles", (req, res, next) => {
  // Apply auth middleware only to POST, PUT, DELETE requests
  if (req.method === 'POST' || req.method === 'PUT' || req.method === 'DELETE') {
    return authMiddleware(req, res, next);
  }
  next();
}, articlesRoutes);

// Newsletter routes
// - /subscribe is rate-limited (3/hr per IP — anti-abuse)
// - Admin routes (upload-cover, send, sends, subscribers) are NOT rate-limited
app.use("/api/newsletter", (req, res, next) => {
  const adminPaths = ['/upload-cover', '/send', '/sends', '/subscribers', '/unsubscribe'];
  const isAdminPath = adminPaths.some(p => req.path.startsWith(p));
  if (isAdminPath) return next(); // skip rate limiter for admin routes
  return newsletterLimiter(req, res, next);
}, newsletterRoutes);

// Featured article routes (protected)
app.use("/api/featured", authMiddleware, featuredRoutes);

// Submissions routes (public for submitting, protected for admin actions)
app.use("/api/submissions", formLimiter, (req, res, next) => {
  // Apply auth middleware to admin-only routes
  const adminPaths = ['/publish', '/status'];
  const isAdminRoute = adminPaths.some(path => req.path.includes(path));

  if (isAdminRoute || (req.method === 'GET' && req.path === '/')) {
    return authMiddleware(req, res, next);
  }
  next();
}, submissionsRoutes);

// Spotify Embeds routes (public GET, protected POST/PUT/DELETE)
app.use("/api/spotify-embeds", (req, res, next) => {
  // Apply auth middleware to POST, PUT, DELETE, and /all route
  if (req.method === 'POST' || req.method === 'PUT' || req.method === 'DELETE' || req.path === '/all') {
    return authMiddleware(req, res, next);
  }
  next();
}, spotifyEmbedsRoutes);

// Settings routes (public GET /public, protected admin routes)
app.use("/api/admin/settings", authMiddleware, settingsRoutes);
app.use("/api/settings", settingsRoutes);

// Analytics routes (protected - admin only)
app.use("/api/analytics", authMiddleware, analyticsRoutes);

// Search Console routes (protected - admin only)
app.use("/api/search-console", authMiddleware, searchConsoleRoutes);

// Amazon Products routes (public GET, protected admin routes)
app.use("/api/amazon-products", (req, res, next) => {
  // Public route for getting active products
  if (req.method === 'GET' && req.path === '/') {
    return next();
  }
  // All admin routes require auth
  if (req.path.startsWith('/admin')) {
    return authMiddleware(req, res, next);
  }
  next();
}, amazonProductsRoutes);

// Indexer routes (protected - admin only)
app.use("/api/indexer", authMiddleware, indexerRoutes);

// Finance / Revenue Ops routes (protected - admin only)
app.use("/api/finance", authMiddleware, financeRoutes);

// Engine Items — CRUD + ideas + agent-events (accepts admin JWT or X-808-API-KEY)
app.use("/api", engineItemsRoutes);

// Cortex — status, summary, run trigger (mixed auth inside route)
app.use("/api/cortex", cortexRoutes);

// Neon DB usage stats (admin only)
app.use("/api/neon", neonRoutes);

// Referral Ads (public GET, admin POST/PUT/DELETE)
app.use("/api/referral-ads", referralAdsRoutes);

// Sitemap routes (public - for SEO)
app.use("/", sitemapRoutes);
app.use("/", lowkeygridSitemapRoutes);

// Overalls routes (public GET, protected POST/PUT/DELETE)
app.use("/api/overalls", overallsRoutes);

// LowkeyGrid Articles routes (public GET, protected POST/PUT/DELETE)
app.use("/api/lowkeygrid/articles", lowkeygridArticlesRoutes);

// Genius lyrics scraper — admin only, not a public endpoint
app.use("/api/genius-lyrics", authMiddleware, geniusRoutes);

// Protected route example
app.get("/api/admin/dashboard", authMiddleware, (req, res) => {
  res.json({
    message: "Welcome to the admin dashboard",
    admin: req.admin,
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`✅ Server listening on port ${PORT}`);
});
