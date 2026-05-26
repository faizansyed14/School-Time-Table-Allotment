import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './styles.css';

// Static hosts (Render): bare /dashboard → /#/dashboard so refresh keeps the page
const { pathname, search } = window.location;
if (!window.location.hash && pathname !== '/' && !pathname.endsWith('/index.html')) {
  window.location.replace(`/#${pathname}${search}`);
} else {
  mount();
}

function mount() {
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
}
