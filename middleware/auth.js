import jwt from "jsonwebtoken";
import pool from "../config/db.js";

const authMiddleware = async (req, res, next) => {
  // Get token from header
  const token = req.header("Authorization")?.replace("Bearer ", "");

  // Check if no token
  if (!token) {
    return res.status(401).json({ message: "No token, authorization denied" });
  }

  try {
    // Verify token
    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET || "your_jwt_secret_key_change_this"
    );

    // Verify admin exists in database
    const result = await pool.query(
      'SELECT id, username, email, created_at FROM admins WHERE id = $1',
      [decoded.admin.id]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ message: "Admin not found" });
    }

    // Add admin from database
    req.admin = result.rows[0];
    next();
  } catch (error) {
    res.status(401).json({ message: "Token is not valid" });
  }
};

export default authMiddleware;
