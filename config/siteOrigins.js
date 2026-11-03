// Known frontend origins allowed to call this API, and the path(es) each
// one should land back on after a Stripe Checkout redirect. Single source
// of truth for both the CORS allowlist (server.js) and the Checkout
// success/cancel URLs (routes/submissions.js) -- keeping them in one place
// means a new frontend only has to be added here once.
//
// The first path in each array is the default (used when the caller
// doesn't specify one); a caller with more than one paid flow on the same
// origin -- e.g. PluggPress's separate /submit-cry808 and /submit-genius
// pages -- can request a specific one via `return_path` in the request
// body, validated against this same list.
export const SITE_RETURN_PATHS = {
  'https://cry808.com': ['/submit-music'],
  'https://www.cry808.com': ['/submit-music'],
  'https://pluggpress.com': ['/submit-cry808', '/submit-genius'],
  'https://www.pluggpress.com': ['/submit-cry808', '/submit-genius'],
  'https://lowkeygrid.com': ['/submit-music'],
  'https://www.lowkeygrid.com': ['/submit-music'],
  'https://2koveralls.com': ['/submit-music'],
  'https://www.2koveralls.com': ['/submit-music'],
  // Local dev
  'http://localhost:5173': ['/submit-music'],
  'http://localhost:3000': ['/submit-music'],
  'http://localhost:4173': ['/submit-music'],
  'http://localhost:5174': ['/submit-cry808', '/submit-genius'],
};

export const ALLOWED_ORIGINS = Object.keys(SITE_RETURN_PATHS);
