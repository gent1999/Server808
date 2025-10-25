// server.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import authRoutes from "./routes/auth.js";
import articlesRoutes from "./routes/articles.js";
import newsletterRoutes from "./routes/newsletter.js";
import featuredRoutes from "./routes/featured.js";
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
