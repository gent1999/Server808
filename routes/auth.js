import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { body, validationResult } from "express-validator";
import pool from "../config/db.js";

const router = express.Router();

// @route   POST /api/auth/register
// @desc    Register a new admin
// @access  Public (you can protect this later)
router.post(
  "/register",
  [
    body("username").trim().isLength({ min: 3 }).withMessage("Username must be at least 3 characters"),
    body("email").isEmail().withMessage("Please enter a valid email"),
    body("password").isLength({ min: 6 }).withMessage("Password must be at least 6 characters"),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { username, email, password } = req.body;

    try {
      // Check if any admins exist (only allow one admin)
      const countResult = await pool.query('SELECT COUNT(*) FROM admins');
      const adminCount = parseInt(countResult.rows[0].count);

      if (adminCount > 0) {
        return res.status(403).json({
          message: "Admin registration is closed. Only one admin account is allowed.",
          registrationClosed: true
        });
      }

      // Check if admin already exists by email or username
      const existingAdmin = await pool.query(
        'SELECT * FROM admins WHERE email = $1 OR username = $2',
        [email, username]
      );

      if (existingAdmin.rows.length > 0) {
        return res.status(400).json({ message: "Admin already exists" });
      }

      // Hash password
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(password, salt);

      // Insert admin into database
      const result = await pool.query(
        'INSERT INTO admins (username, email, password) VALUES ($1, $2, $3) RETURNING id, username, email, created_at',
        [username, email, hashedPassword]
      );

      const newAdmin = result.rows[0];

      // Create JWT token
      const payload = {
        admin: {
          id: newAdmin.id,
          username: newAdmin.username,
          email: newAdmin.email,
        },
      };

      jwt.sign(
        payload,
        process.env.JWT_SECRET || "your_jwt_secret_key_change_this",
        { expiresIn: "7d" },
        (err, token) => {
          if (err) throw err;
          res.status(201).json({
            message: "Admin registered successfully",
            token,
            admin: {
              id: newAdmin.id,
              username: newAdmin.username,
              email: newAdmin.email,
            },
          });
        }
      );
    } catch (error) {
      console.error(error.message);
      res.status(500).json({ message: "Server error" });
    }
  }
);

// @route   POST /api/auth/login
// @desc    Login admin
// @access  Public
router.post(
  "/login",
  [
    body("email").isEmail().withMessage("Please enter a valid email"),
    body("password").exists().withMessage("Password is required"),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email, password } = req.body;

    try {
      // Find admin by email in database
      const result = await pool.query(
        'SELECT * FROM admins WHERE email = $1',
        [email]
      );

      if (result.rows.length === 0) {
        return res.status(400).json({ message: "Invalid credentials" });
      }

      const admin = result.rows[0];

      // Check password
      const isMatch = await bcrypt.compare(password, admin.password);

      if (!isMatch) {
        return res.status(400).json({ message: "Invalid credentials" });
      }

      // Create JWT token
      const payload = {
        admin: {
          id: admin.id,
          username: admin.username,
          email: admin.email,
        },
      };

      jwt.sign(
        payload,
        process.env.JWT_SECRET || "your_jwt_secret_key_change_this",
        { expiresIn: "7d" },
        (err, token) => {
          if (err) throw err;
          res.json({
            message: "Login successful",
            token,
            admin: {
              id: admin.id,
              username: admin.username,
              email: admin.email,
            },
          });
        }
      );
    } catch (error) {
      console.error(error.message);
      res.status(500).json({ message: "Server error" });
    }
  }
);

// @route   GET /api/auth/me
// @desc    Get current admin
// @access  Private
router.get("/me", async (req, res) => {
  try {
    res.json(req.admin);
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ message: "Server error" });
  }
});

// @route   GET /api/auth/registration-status
// @desc    Check if registration is available
// @access  Public
router.get("/registration-status", async (req, res) => {
  try {
    const result = await pool.query('SELECT COUNT(*) FROM admins');
    const adminCount = parseInt(result.rows[0].count);

    res.json({
      registrationOpen: adminCount === 0,
      message: adminCount === 0
        ? "Registration is open for the first admin"
        : "Registration is closed"
    });
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ message: "Server error" });
  }
});

// @route   DELETE /api/auth/delete-account
// @desc    Delete admin account (WARNING: This will allow new registration)
// @access  Private
router.delete("/delete-account", async (req, res) => {
  try {
    const adminId = req.admin.id;

    // Delete admin from database
    const result = await pool.query(
      'DELETE FROM admins WHERE id = $1 RETURNING *',
      [adminId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Admin not found" });
    }

    res.json({
      message: "Account deleted successfully. Registration is now open for a new admin.",
      registrationOpen: true
    });
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ message: "Server error" });
  }
});

export default router;
