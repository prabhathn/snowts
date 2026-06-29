import { useState, useEffect, useCallback } from 'react'
import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useAppStore } from '../store'
import { api } from '../api/client'
import { QuickInput } from './QuickInput'
import { AgentPanel, useAgentContext } from './AgentPanel'
import { CommandPalette } from './CommandPalette'
import { ActivityToolbar } from './ActivityToolbar'
import { ActivityProvider } from '../contexts/ActivityContext'

const navItems = [
  { to: '/', label: 'Home' },
  { to: '/notes', label: 'Notes' },
  { to: '/wiki', label: 'Knowledge' },
]

const entityItems = [
  { to: '/clients', label: 'Clients' },
]

type ActivePanel = 'note' | 'agent' | null

function ToolbarButtons({ activePanel, setActivePanel }: { activePanel: ActivePanel; setActivePanel: (p: ActivePanel) => void }) {
  const context = useAgentContext()

  const contextLabel = context.page === 'wiki' && context.slug
    ? `Wiki: ${context.slug}`
    : context.page === 'client' && context.client_id
    ? 'Client profile'
    : context.page === 'note' && context.note_path
    ? 'Note'
    : context.page || ''

  return (
    <div className="flex items-center gap-4 py-1.5">
      <button
        onClick={() => setActivePanel(activePanel === 'note' ? null : 'note')}
        className="flex items-center gap-2 text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text)] transition-colors"
      >
        <svg className={`w-3 h-3 transition-transform ${activePanel === 'note' ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
        Quick Note
      </button>
      <button
        onClick={() => setActivePanel(activePanel === 'agent' ? null : 'agent')}
        className="flex items-center gap-2 text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text)] transition-colors"
      >
        <svg className={`w-3 h-3 transition-transform ${activePanel === 'agent' ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
        Ask Agent
        {contextLabel && (
          <span className="text-[var(--color-accent)] ml-1">{contextLabel}</span>
        )}
      </button>
    </div>
  )
}

function SettingsButton({ status }: { status: ReturnType<typeof useAppStore>['status'] }) {
  return (
    <NavLink
      to="/settings"
      className={({ isActive }) =>
        `relative p-1.5 rounded-md transition-colors ${
          isActive
            ? 'bg-[var(--color-accent)] text-white'
            : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-bg-secondary)]'
        }`
      }
      title="Settings"
    >
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
      <span className={`absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-[var(--color-bg-elevated)] ${status?.online ? 'bg-[var(--color-success)]' : 'bg-[var(--color-danger)]'}`} />
    </NavLink>
  )
}

export function Layout() {
  const { status, setStatus, commandPaletteOpen, setCommandPaletteOpen } = useAppStore()
  const navigate = useNavigate()
  const [activePanel, setActivePanel] = useState<ActivePanel>(null)

  useEffect(() => {
    api.getStatus().then(setStatus).catch(() => setStatus({
      online: false, pending_sync: 0, pending_raw: 0,
      total_articles: 0, total_clients: 0, pending_todos: 0,
    }))
  }, [setStatus])

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault()
      setCommandPaletteOpen(!commandPaletteOpen)
    }
  }, [commandPaletteOpen, setCommandPaletteOpen])

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  return (
    <ActivityProvider>
    <div className="min-h-screen flex flex-col">
      <header className="sticky top-0 z-40 bg-[var(--color-bg-elevated)] border-b border-[var(--color-border)]">
        <div className="max-w-7xl mx-auto px-4 h-14 flex items-center gap-6">
          <NavLink to="/" className="text-lg font-bold tracking-tight">
            Snowts
          </NavLink>

          <nav className="flex items-center gap-1">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `px-3 py-1.5 text-sm rounded-md transition-colors ${
                    isActive
                      ? 'bg-[var(--color-accent)] text-white'
                      : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-bg-secondary)]'
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
            <span className="w-px h-4 bg-[var(--color-border)] mx-1" />
            {entityItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `px-3 py-1.5 text-sm rounded-md transition-colors ${
                    isActive
                      ? 'bg-[var(--color-accent)] text-white'
                      : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-bg-secondary)]'
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="flex-1" />

          <button
            onClick={() => setCommandPaletteOpen(true)}
            className="flex items-center gap-2 px-3 py-1.5 text-sm text-[var(--color-text-secondary)] bg-[var(--color-bg-secondary)] rounded-md border border-[var(--color-border)] hover:border-[var(--color-accent)] transition-colors"
          >
            Search or note...
            <kbd className="text-xs px-1.5 py-0.5 bg-[var(--color-bg)] rounded border border-[var(--color-border)]">
              {navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'}K
            </kbd>
          </button>

          <div className="flex items-center gap-1">
            <ActivityToolbar />
            <SettingsButton status={status} />
          </div>
        </div>
        <div className="border-t border-[var(--color-border)]">
          <div className="max-w-7xl mx-auto px-4">
            <div className="flex items-center justify-between">
              <ToolbarButtons activePanel={activePanel} setActivePanel={setActivePanel} />
            </div>
            <QuickInput open={activePanel === 'note'} />
            <AgentPanel open={activePanel === 'agent'} />
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl mx-auto w-full px-4 py-6">
        <Outlet />
      </main>

      {commandPaletteOpen && (
        <CommandPalette
          onClose={() => setCommandPaletteOpen(false)}
          onNavigate={(path) => {
            setCommandPaletteOpen(false)
            navigate(path)
          }}
        />
      )}
    </div>
    </ActivityProvider>
  )
}
