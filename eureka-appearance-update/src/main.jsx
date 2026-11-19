import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/fraunces';
import '@fontsource-variable/fraunces/wght-italic.css';
import '@fontsource-variable/manrope';
import './index.css'
import App from './App.jsx'
import './layout-topbar.css' // optional top-bar layout — on via data-layout in index.html
import './theme-paper.css' // light "Paper" design — on when data-theme="paper" (see src/lib/appearance.js)

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
