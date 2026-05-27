// Fallback if VITE_API_URL was not set at build time (override in Render env + redeploy).
// For LOCAL DEV: leave empty so Vite proxy handles /api routing automatically.
// For PRODUCTION: set to your backend URL, e.g. 'https://school-erp-api-4aik.onrender.com'
window.__ERP_API_URL__ = window.__ERP_API_URL__ || '';
