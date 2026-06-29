import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAppStore } from '../store'
import { api } from '../api/client'
import { formatDate } from '../utils/time'
import type { Client } from '../types'

function EditModal({ client, onClose, onSave }: { client: Client; onClose: () => void; onSave: (c: Client) => void }) {
  const [name, setName] = useState(client.name)
  const [industry, setIndustry] = useState(client.industry || '')
  const [status, setStatus] = useState(client.engagement_status)
  const [summary, setSummary] = useState(client.summary || '')
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    setSaving(true)
    try {
      const res = await api.updateClient(client.id, { name, industry, engagement_status: status, summary })
      onSave(res.client)
    } catch {
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-[var(--color-bg-elevated)] rounded-lg border border-[var(--color-border)] w-full max-w-md p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold">Edit Client</h2>
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-[var(--color-text-secondary)] mb-1">Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-1.5 text-sm rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] outline-none focus:border-[var(--color-accent)]"
            />
          </div>
          <div>
            <label className="block text-xs text-[var(--color-text-secondary)] mb-1">Industry</label>
            <input
              value={industry}
              onChange={(e) => setIndustry(e.target.value)}
              className="w-full px-3 py-1.5 text-sm rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] outline-none focus:border-[var(--color-accent)]"
            />
          </div>
          <div>
            <label className="block text-xs text-[var(--color-text-secondary)] mb-1">Status</label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as Client['engagement_status'])}
              className="w-full px-3 py-1.5 text-sm rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] outline-none focus:border-[var(--color-accent)]"
            >
              <option value="active">Active</option>
              <option value="dormant">Dormant</option>
              <option value="prospect">Prospect</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-[var(--color-text-secondary)] mb-1">Summary</label>
            <textarea
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              rows={3}
              className="w-full px-3 py-1.5 text-sm rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] outline-none focus:border-[var(--color-accent)] resize-none"
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="px-3 py-1.5 text-sm rounded-md border border-[var(--color-border)] hover:bg-[var(--color-bg-secondary)] transition-colors">
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!name.trim() || saving}
            className="px-3 py-1.5 text-sm font-medium rounded-md text-white bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] disabled:opacity-40 transition-colors"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

export function Clients() {
  const { clients, setClients } = useAppStore()
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<Client | null>(null)
  const [deleting, setDeleting] = useState<Client | null>(null)
  const [deleteLoading, setDeleteLoading] = useState(false)

  useEffect(() => {
    api.listClients().then((r) => setClients(r.clients)).catch(() => {})
  }, [setClients])

  const handleSave = (updated: Client) => {
    setClients(clients.map((c) => (c.id === updated.id ? updated : c)))
    setEditing(null)
  }

  const handleDelete = async () => {
    if (!deleting) return
    setDeleteLoading(true)
    try {
      await api.deleteClient(deleting.id)
      setClients(clients.filter((c) => c.id !== deleting.id))
      setDeleting(null)
    } catch {
    } finally {
      setDeleteLoading(false)
    }
  }

  const statusColor = (s: string) => {
    if (s === 'active') return 'bg-[color-mix(in_srgb,var(--color-success)_15%,transparent)] text-[var(--color-success)]'
    if (s === 'dormant') return 'bg-[var(--color-bg-secondary)] text-[var(--color-text-secondary)]'
    return 'bg-[color-mix(in_srgb,var(--color-warning)_15%,transparent)] text-[var(--color-warning)]'
  }

  const q = search.toLowerCase()
  const filtered = clients.filter((c) =>
    c.name.toLowerCase().includes(q) ||
    (c.industry || '').toLowerCase().includes(q) ||
    (c.engagement_status || '').toLowerCase().includes(q) ||
    (c.summary || '').toLowerCase().includes(q)
  )

  return (
    <div className="space-y-4 pb-24">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Clients</h1>
        <span className="text-sm text-[var(--color-text-secondary)]">{filtered.length} of {clients.length}</span>
      </div>

      <div className="relative">
        <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-secondary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter by name, industry, status..."
          className="w-full pl-10 pr-4 py-2 text-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elevated)] outline-none focus:border-[var(--color-accent)] transition-colors"
        />
      </div>

      {filtered.length > 0 ? (
        <div className="bg-[var(--color-bg-elevated)] rounded-lg border border-[var(--color-border)] overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-left text-xs text-[var(--color-text-secondary)] uppercase tracking-wider">
                <th className="px-4 py-2.5 font-medium">Name</th>
                <th className="px-4 py-2.5 font-medium">Industry</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 font-medium">Last Contact</th>
                <th className="px-4 py-2.5 font-medium">Summary</th>
                <th className="px-4 py-2.5 font-medium w-20"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.id} className="border-b border-[var(--color-border)] last:border-b-0 hover:bg-[var(--color-bg-secondary)] transition-colors group">
                  <td className="px-4 py-2.5">
                    <Link to={`/clients/${c.id}`} className="font-medium text-[var(--color-accent)] hover:underline">
                      {c.name}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 text-[var(--color-text-secondary)]">
                    {c.industry || '-'}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={`inline-block text-xs px-2 py-0.5 rounded-full font-medium ${statusColor(c.engagement_status)}`}>
                      {c.engagement_status}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-[var(--color-text-secondary)]">
                    {c.last_contact ? formatDate(c.last_contact) : '-'}
                  </td>
                  <td className="px-4 py-2.5 text-[var(--color-text-secondary)] max-w-xs truncate">
                    {c.summary || '-'}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => setEditing(c)}
                        title="Edit"
                        className="p-1 rounded hover:bg-[var(--color-bg)] text-[var(--color-text-secondary)] hover:text-[var(--color-text)] transition-colors"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                      </button>
                      <button
                        onClick={() => setDeleting(c)}
                        title="Delete"
                        className="p-1 rounded hover:bg-[color-mix(in_srgb,var(--color-danger)_10%,transparent)] text-[var(--color-text-secondary)] hover:text-[var(--color-danger)] transition-colors"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : clients.length > 0 ? (
        <p className="text-[var(--color-text-secondary)] text-sm">No clients match your filter.</p>
      ) : (
        <p className="text-[var(--color-text-secondary)]">
          No clients extracted yet. Run the pipeline on your raw documents to auto-extract client entities.
        </p>
      )}

      {editing && <EditModal client={editing} onClose={() => setEditing(null)} onSave={handleSave} />}

      {deleting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setDeleting(null)}>
          <div className="bg-[var(--color-bg-elevated)] rounded-lg border border-[var(--color-border)] w-full max-w-sm p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold">Delete Client</h2>
            <p className="text-sm text-[var(--color-text-secondary)]">
              Are you sure you want to delete <strong className="text-[var(--color-text)]">{deleting.name}</strong>? This will remove the client record and associated contacts. Related notes and articles will not be deleted.
            </p>
            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setDeleting(null)} className="px-3 py-1.5 text-sm rounded-md border border-[var(--color-border)] hover:bg-[var(--color-bg-secondary)] transition-colors">
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={deleteLoading}
                className="px-3 py-1.5 text-sm font-medium rounded-md text-white bg-[var(--color-danger)] hover:opacity-90 disabled:opacity-40 transition-colors"
              >
                {deleteLoading ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
