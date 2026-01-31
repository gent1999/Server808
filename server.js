// server.js
import express from "express";
import cors from "cors";
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
import overallsRoutes from "./routes/overalls.js";
import lowkeygridArticlesRoutes from "./routes/lowkeygridArticles.js";
import authMiddleware from "./middleware/auth.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// Basic route (for testing)
app.get("/", (req, res) => {
  res.send("Server is running 🚀");
});

// Auth routes (public routes like login, register)
app.use("/api/auth", (req, res, next) => {
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

// Newsletter routes (public subscribe, protected admin routes)
app.use("/api/newsletter", (req, res, next) => {
  // Apply auth middleware only to GET /subscribers (admin viewing subscribers)
  if (req.path === '/subscribers' && req.method === 'GET') {
    return authMiddleware(req, res, next);
  }
  next();
}, newsletterRoutes);

// Featured article routes (protected)
app.use("/api/featured", authMiddleware, featuredRoutes);

// Submissions routes (public for submitting, protected for admin actions)
app.use("/api/submissions", (req, res, next) => {
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

// Sitemap routes (public - for SEO)
app.use("/", sitemapRoutes);

// Overalls routes (public GET, protected POST/PUT/DELETE)
app.use("/api/overalls", overallsRoutes);

// LowkeyGrid Articles routes (public GET, protected POST/PUT/DELETE)
app.use("/api/lowkeygrid/articles", lowkeygridArticlesRoutes);

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
