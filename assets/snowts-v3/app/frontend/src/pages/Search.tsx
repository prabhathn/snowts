import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import type { SearchResult } from '../types'

export function Search() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [sourceFilter, setSourceFilter] = useState<string>('')

  const handleSearch = async (q: string) => {
    setQuery(q)
    if (q.length < 2) { setResults([]); return }
    setLoading(true)
    try {
      const r = await api.search(q, {
        source_type: sourceFilter || undefined,
      })
      setResults(r.results)
    } catch {
      setResults([])
    }
    setLoading(false)
  }

  return (
    <div className="space-y-6 pb-24">
      <h1 className="text-2xl font-bold">Search</h1>

      <div className="flex gap-3">
        <input
          type="text"
          value={query}
          onChange={(e) => handleSearch(e.target.value)}
          placeholder="Search all content..."
          className="flex-1 px-4 py-2.5 bg-[var(--color-bg-elevated)] border border-[var(--color-border)] rounded-lg text-sm outline-none focus:border-[var(--color-accent)] transition-colors"
        />
        <select
          value={sourceFilter}
          onChange={(e) => setSourceFilter(e.target.value)}
          className="px-3 py-2.5 bg-[var(--color-bg-elevated)] border border-[var(--color-border)] rounded-lg text-sm"
        >
          <option value="">All types</option>
          <option value="note">Notes</option>
          <option value="wiki">Wiki</option>
          <option value="raw">Raw</option>
        </select>
      </div>

      {loading && <p className="text-sm text-[var(--color-text-secondary)]">Searching...</p>}

      {results.length > 0 && (
        <ul className="space-y-3">
          {results.map((r, i) => (
            <li key={i}>
              <Link
                to={r.source_type === 'wiki' ? `/wiki/${r.file_path.replace('wiki/', '').replace('.md', '')}` : `/notes/${encodeURIComponent(r.file_path)}`}
                className="block bg-[var(--color-bg-elevated)] rounded-lg border border-[var(--color-border)] p-4 hover:border-[var(--color-accent)] transition-colors"
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-medium">{r.title}</span>
                  <span className="text-xs px-1.5 py-0.5 rounded bg-[var(--color-bg-secondary)] text-[var(--color-text-secondary)]">
                    {r.source_type}
                  </span>
                  {r.client_name && (
                    <span className="text-xs px-1.5 py-0.5 rounded bg-blue-50 text-blue-700">{r.client_name}</span>
                  )}
                </div>
                <p className="text-sm text-[var(--color-text-secondary)] line-clamp-2">{r.snippet}</p>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {query.length >= 2 && !loading && results.length === 0 && (
        <p className="text-sm text-[var(--color-text-secondary)]">No results found for "{query}"</p>
      )}
    </div>
  )
}
