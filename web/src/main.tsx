import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App'
import { initializeAuth } from './lib/supabase'
import './styles.css'
import './theme.css'

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  // Caches League art and Data Dragon catalogues; see public/sw.js.
  navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => undefined)
}

initializeAuth()
  .then((authError) => {
    ReactDOM.createRoot(document.getElementById('root')!).render(
      <React.StrictMode>
        <App authError={authError} />
      </React.StrictMode>,
    )
  })
  .catch(() => {
    ReactDOM.createRoot(document.getElementById('root')!).render(
      <App authError="Could not connect to sign-in. Check your connection and try again." />,
    )
  })
