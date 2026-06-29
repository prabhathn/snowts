import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { Layout } from './components/Layout'
import { Dashboard } from './pages/Dashboard'
import { Notes } from './pages/Notes'
import { Clients } from './pages/Clients'
import { ClientDetail } from './pages/ClientDetail'
import { Search } from './pages/Search'
import { Settings } from './pages/Settings'
import { Wiki } from './pages/Wiki'
import { Onboarding } from './pages/Onboarding'
import { api } from './api/client'

function SetupGuard({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState<boolean | null>(null)

  useEffect(() => {
    api.isSetupComplete()
      .then((r) => setReady(r.setup_complete))
      .catch(() => setReady(false))
  }, [])

  if (ready === null) return null
  if (!ready) return <Navigate to="/setup" replace />
  return <>{children}</>
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/setup" element={<Onboarding />} />
        <Route element={<SetupGuard><Layout /></SetupGuard>}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/notes" element={<Notes />} />
          <Route path="/notes/:path" element={<Notes />} />
          <Route path="/wiki" element={<Wiki />} />
          <Route path="/wiki/:slug" element={<Wiki />} />
          <Route path="/clients" element={<Clients />} />
          <Route path="/clients/:id" element={<ClientDetail />} />
          <Route path="/search" element={<Search />} />
          <Route path="/settings" element={<Settings />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
