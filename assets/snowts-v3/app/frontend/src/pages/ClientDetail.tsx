import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { api } from '../api/client'
import { TodoCard } from '../components/TodoCard'
import { EditTodoModal } from '../components/EditTodoModal'
import { formatDate } from '../utils/time'
import type { Client, ClientContact, Article, Todo } from '../types'

type AllClient = { id: string; name: string }

export function ClientDetail() {
  const { id } = useParams<{ id: string }>()
  const [client, setClient] = useState<Client | null>(null)
  const [contacts, setContacts] = useState<ClientContact[]>([])
  const [articles, setArticles] = useState<Article[]>([])
  const [todos, setTodos] = useState<Todo[]>([])
  const [allClients, setAllClients] = useState<AllClient[]>([])
  const [editing, setEditing] = useState<Todo | null>(null)

  useEffect(() => {
    if (!id) return
    api.getClient(id).then((r) => {
      setClient(r.client)
      setContacts(r.contacts)
      setArticles(r.articles)
      setTodos(r.todos.filter((t: Todo) => t.status !== 'done'))
    }).catch(() => {})
    api.listClients().then((r) => setAllClients(r.clients.map((c) => ({ id: c.id, name: c.name })))).catch(() => {})
  }, [id])

  const handleMarkDone = async (todoId: string) => {
    setTodos((prev) => prev.filter((t) => t.id !== todoId))
    try { await api.updateTodo(todoId, { status: 'done' }) } catch {}
  }

  const handleReject = async (todoId: string) => {
    setTodos((prev) => prev.filter((t) => t.id !== todoId))
    try { await api.updateTodo(todoId, { rejected: true } as any) } catch {}
  }

  const handleSaveEdit = async (todoId: string, updates: Partial<Todo> & { client_id?: string | null }) => {
    try {
      const result = await api.updateTodo(todoId, updates)
      setTodos((prev) => prev.map((t) => t.id === todoId ? { ...t, ...result } : t))
    } catch {}
    setEditing(null)
  }

  if (!client) {
    return <div className="text-[var(--color-text-secondary)]">Loading...</div>
  }

  return (
    <div className="space-y-6 pb-24">
      <div>
        <Link to="/clients" className="text-sm text-[var(--color-accent)] hover:underline">&larr; All Clients</Link>
        <div className="flex items-center gap-3 mt-2">
          <h1 className="text-2xl font-bold">{client.name}</h1>
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
            client.engagement_status === 'active'
              ? 'bg-[color-mix(in_srgb,var(--color-success)_15%,transparent)] text-[var(--color-success)]'
              : 'bg-[var(--color-bg-secondary)] text-[var(--color-text-secondary)]'
          }`}>
            {client.engagement_status}
          </span>
        </div>
        {client.industry && <p className="text-sm text-[var(--color-text-secondary)] mt-1">{client.industry}</p>}
        {client.last_contact && (
          <p className="text-xs text-[var(--color-text-secondary)] mt-1">Last contact: {formatDate(client.last_contact)}</p>
        )}
      </div>

      {client.summary && (
        <div className="bg-[var(--color-bg-elevated)] rounded-lg border border-[var(--color-border)] p-4">
          <p className="text-sm">{client.summary}</p>
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-6">
        <section>
          <h2 className="font-semibold mb-3">Contacts</h2>
          {contacts.length > 0 ? (
            <ul className="space-y-2">
              {contacts.map((c) => (
                <li key={c.id} className="bg-[var(--color-bg-elevated)] rounded-lg border border-[var(--color-border)] p-3">
                  <div className="font-medium text-sm">{c.name}</div>
                  {c.role && <div className="text-xs text-[var(--color-text-secondary)]">{c.role}</div>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-[var(--color-text-secondary)]">No contacts extracted yet</p>
          )}
        </section>

        <section>
          <h2 className="font-semibold mb-3">TODOs</h2>
          {todos.length > 0 ? (
            <div className="space-y-2">
              {todos.map((t) => (
                <TodoCard
                  key={t.id}
                  todo={t}
                  onEdit={setEditing}
                  onMarkDone={handleMarkDone}
                  onReject={handleReject}
                />
              ))}
            </div>
          ) : (
            <p className="text-sm text-[var(--color-text-secondary)]">No TODOs for this client</p>
          )}
        </section>
      </div>

      <section>
        <h2 className="font-semibold mb-3">Timeline</h2>
        {articles.length > 0 ? (
          <ul className="space-y-2">
            {articles.map((a) => (
              <li key={a.id} className="bg-[var(--color-bg-elevated)] rounded-lg border border-[var(--color-border)] p-3 flex items-start gap-3">
                <span className={`text-xs px-1.5 py-0.5 rounded shrink-0 ${
                  a.source_type === 'note' ? 'bg-blue-50 text-blue-700' :
                  a.source_type === 'raw' ? 'bg-purple-50 text-purple-700' : 'bg-[var(--color-bg-secondary)]'
                }`}>
                  {a.source_type}
                </span>
                <div>
                  <div className="font-medium text-sm">{a.title}</div>
                  <div className="text-xs text-[var(--color-text-secondary)]">{a.summary}</div>
                  <div className="text-xs text-[var(--color-text-secondary)] mt-1">{formatDate(a.created_at)}</div>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-[var(--color-text-secondary)]">No articles linked to this client</p>
        )}
      </section>

      {editing && (
        <EditTodoModal
          todo={editing}
          allClients={allClients}
          existingGroups={[...new Set(todos.map((t) => t.group_name).filter((g): g is string => !!g))]}
          onClose={() => setEditing(null)}
          onSave={handleSaveEdit}
        />
      )}
    </div>
  )
}
