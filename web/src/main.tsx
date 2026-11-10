import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App'
import { initializeAuth } from './lib/supabase'
import './styles.css'
import './theme.css'

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
