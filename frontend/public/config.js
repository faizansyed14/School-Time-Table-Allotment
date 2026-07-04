// Runtime fallback if VITE_API_URL was not set at build time.
// LOCAL DEV: leave empty so the Vite proxy handles /api routing automatically.
// PRODUCTION: set to your backend URL, e.g. 'https://api.yourschool.com'
//             (when frontend + API share a domain via nginx, you can leave this empty).
window.__ERP_API_URL__ = window.__ERP_API_URL__ || '';
