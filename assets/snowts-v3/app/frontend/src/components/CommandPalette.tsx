import { useState, useRef, useEffect } from 'react'
import { api } from '../api/client'
import type { SearchResult } from '../types'

interface Props {
  onClose: () => void
  onNavigate: (path: string) => void
}

export function CommandPalette({ onClose, onNavigate }: Props) {
  const [input, setInput] = useState('')
  const [mode, setMode] = useState<'search' | 'note'>('search')
  const [results, setResults] = useState<SearchResult[]>([])
  const [submitting, setSubmitting] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    if (input.startsWith('/note ') || input.startsWith('> ')) {
      setMode('note')
    } else {
      setMode('search')
    }
  }, [input])

  useEffect(() => {
    if (mode !== 'search' || input.length < 2) {
      setResults([])
      return
    }
    const timer = setTimeout(() => {
      api.search(input).then((r) => setResults(r.results)).catch(() => {})
    }, 300)
    return () => clearTimeout(timer)
  }, [input, mode])

  const handleSubmit = async () => {
    if (!input.trim()) return
    if (mode === 'note') {
      setSubmitting(true)
      const noteText = input.replace(/^(\/note |> )/, '')
      try {
        await api.submitQuickNote(noteText)
        onClose()
      } catch {
        // silent
      }
      setSubmitting(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onClose()
    if (e.key === 'Enter' && mode === 'note') {
      e.preventDefault()
      handleSubmit()
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh]" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div
        className="relative w-full max-w-xl bg-[var(--color-bg-elevated)] rounded-xl shadow-2xl border border-[var(--color-border)] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--color-border)]">
          <span className="text-[var(--color-text-secondary)] text-sm">
            {mode === 'note' ? '📝' : '🔍'}
          </span>
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder='Search... or type "/note " to capture a note'
            className="flex-1 bg-transparent outline-none text-sm"
          />
          {mode === 'note' && (
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="px-3 py-1 text-xs font-medium bg-[var(--color-accent)] text-white rounded-md"
            >
              Save
            </button>
          )}
        </div>

        {results.length > 0 && (
          <div className="max-h-80 overflow-y-auto">
            {results.map((r, i) => (
              <button
                key={i}
                onClick={() => onNavigate(r.file_path.startsWith('wiki/') ? `/wiki/${r.file_path}` : `/notes/${r.file_path}`)}
                className="w-full text-left px-4 py-3 hover:bg-[var(--color-bg-secondary)] transition-colors border-b border-[var(--color-border)] last:border-0"
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{r.title}</span>
                  <span className="text-xs px-1.5 py-0.5 rounded bg-[var(--color-bg-secondary)] text-[var(--color-text-secondary)]">
                    {r.source_type}
                  </span>
                  {r.client_name && (
                    <span className="text-xs px-1.5 py-0.5 rounded bg-blue-50 text-blue-700">
                      {r.client_name}
                    </span>
                  )}
                </div>
                <p className="text-xs text-[var(--color-text-secondary)] mt-1 line-clamp-2">{r.snippet}</p>
              </button>
            ))}
          </div>
        )}

        {input.length > 0 && results.length === 0 && mode === 'search' && (
          <div className="px-4 py-6 text-center text-sm text-[var(--color-text-secondary)]">
            No results. Type "/note " to save as a note.
          </div>
        )}
      </div>
    </div>
  )
}
