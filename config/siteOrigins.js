// Known frontend origins allowed to call this API, and the path each one
// should land back on after a Stripe Checkout redirect. Single source of
// truth for both the CORS allowlist (server.js) and the Checkout
// success/cancel URLs (routes/submissions.js) -- keeping them in one place
// means a new frontend only has to be added here once.
export const SITE_RETURN_PATHS = {
  'https://cry808.com': '/submit-music',
  'https://www.cry808.com': '/submit-music',
  'https://pluggpress.com': '/submit-cry808',
  'https://www.pluggpress.com': '/submit-cry808',
  'https://lowkeygrid.com': '/submit-music',
  'https://www.lowkeygrid.com': '/submit-music',
  'https://2koveralls.com': '/submit-music',
  'https://www.2koveralls.com': '/submit-music',
  // Local dev
  'http://localhost:5173': '/submit-music',
  'http://localhost:3000': '/submit-music',
  'http://localhost:4173': '/submit-music',
  'http://localhost:5174': '/submit-cry808',
};

export const ALLOWED_ORIGINS = Object.keys(SITE_RETURN_PATHS);
