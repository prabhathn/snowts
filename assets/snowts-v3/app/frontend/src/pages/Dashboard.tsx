import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import { EditTodoModal } from '../components/EditTodoModal'
import { TodoCard } from '../components/TodoCard'
import { relativeTime, formatDate } from '../utils/time'
import type { Todo } from '../types'

type DashboardClient = { id: string; name: string; engagement_status: string; last_contact: string | null }
type DashboardMeeting = { id: string; title: string; client_name: string | null; source_type: string; preview: string; created_at: string; file_path: string }
type DashboardWikiItem = { id: string; slug: string; title: string; summary: string; category: string; updated_at: string }
type AllClient = { id: string; name: string }

const KANBAN_COLUMNS: { key: Todo['status']; label: string; accent: string }[] = [
  { key: 'backlog', label: 'Backlog', accent: 'var(--color-text-secondary)' },
  { key: 'todo', label: 'To Do', accent: 'var(--color-accent)' },
  { key: 'in_progress', label: 'In Progress', accent: 'var(--color-warning)' },
  { key: 'done', label: 'Done', accent: 'var(--color-success)' },
]


export function Dashboard() {
  const [clients, setClients] = useState<DashboardClient[]>([])
  const [meetings, setMeetings] = useState<DashboardMeeting[]>([])
  const [wikiRecent, setWikiRecent] = useState<DashboardWikiItem[]>([])
  const [todos, setTodos] = useState<Todo[]>([])
  const [allClients, setAllClients] = useState<AllClient[]>([])
  const [dragging, setDragging] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState<string | null>(null)
  const [editing, setEditing] = useState<Todo | null>(null)
  const [showArchived, setShowArchived] = useState(false)
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('dashboard-overview-collapsed') === 'true')
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())
  const [grouping, setGrouping] = useState(false)
  const [backlogView, setBacklogView] = useState<'grouped' | 'priority'>('grouped')

  useEffect(() => {
    api.getDashboard().then((r) => {
      setClients(r.clients)
      setMeetings(r.meetings)
      setWikiRecent(r.wiki_recent || [])
    }).catch(() => {})
    api.listTodos().then((r) => setTodos(r.todos)).catch(() => {})
    api.listClients().then((r) => setAllClients(r.clients.map((c) => ({ id: c.id, name: c.name })))).catch(() => {})
  }, [])

  const handleDragStart = (id: string) => setDragging(id)

  const handleDrop = async (status: Todo['status']) => {
    if (!dragging) return
    const todo = todos.find((t) => t.id === dragging)
    if (!todo || todo.status === status) { setDragging(null); setDragOver(null); return }
    setTodos((prev) => prev.map((t) => t.id === dragging ? { ...t, status } : t))
    setDragging(null)
    setDragOver(null)
    try { await api.updateTodo(dragging, { status }) } catch {}
  }

  const handleMarkDone = async (id: string) => {
    setTodos((prev) => prev.map((t) => t.id === id ? { ...t, status: 'done' as const } : t))
    try { await api.updateTodo(id, { status: 'done' }) } catch {}
  }

  const handleReject = async (id: string) => {
    setTodos((prev) => prev.filter((t) => t.id !== id))
    try { await api.updateTodo(id, { rejected: true } as any) } catch {}
  }

  const handleSaveEdit = async (id: string, updates: Partial<Todo> & { client_id?: string | null }) => {
    try {
      const result = await api.updateTodo(id, updates)
      setTodos((prev) => prev.map((t) => t.id === id ? { ...t, ...result } : t))
    } catch {}
    setEditing(null)
  }


  const renderTodoCard = (todo: Todo) => (
    <TodoCard
      key={todo.id}
      todo={todo}
      draggable
      dragging={dragging === todo.id}
      onDragStart={() => handleDragStart(todo.id)}
      onDragEnd={() => { setDragging(null); setDragOver(null) }}
      onEdit={setEditing}
      onMarkDone={handleMarkDone}
      onReject={handleReject}
    />
  )

  const priorityWeight: Record<string, number> = { high: 0, medium: 1, low: 2 }

  const sortTodos = (items: Todo[]) => {
    const now = Date.now()
    return [...items].sort((a, b) => {
      const aDate = a.due_date ? new Date(a.due_date).getTime() : Infinity
      const bDate = b.due_date ? new Date(b.due_date).getTime() : Infinity
      const aUrgent = aDate !== Infinity ? aDate - now : Infinity
      const bUrgent = bDate !== Infinity ? bDate - now : Infinity
      if (aUrgent !== bUrgent) return aUrgent - bUrgent
      const aHasClient = a.client_name ? 0 : 1
      const bHasClient = b.client_name ? 0 : 1
      const aPri = priorityWeight[a.priority] ?? 2
      const bPri = priorityWeight[b.priority] ?? 2
      if (aPri !== bPri || aHasClient !== bHasClient) return (aPri * 2 + aHasClient) - (bPri * 2 + bHasClient)
      return 0
    })
  }

  return (
    <div className="space-y-6 pb-24">
      <button
        onClick={() => { const next = !collapsed; setCollapsed(next); localStorage.setItem('dashboard-overview-collapsed', String(next)) }}
        className="flex items-center gap-2 group cursor-pointer"
      >
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`text-[var(--color-text-secondary)] group-hover:text-[var(--color-text)] transition-all ${collapsed ? '-rotate-90' : ''}`}>
          <path d="M4 6l4 4 4-4" />
        </svg>
        <span className="text-sm font-semibold uppercase tracking-wider text-[var(--color-text-secondary)] group-hover:text-[var(--color-text)] transition-colors">Overview</span>
        {collapsed && <span className="text-xs text-[var(--color-text-secondary)] font-normal normal-case tracking-normal">{clients.length} clients · {meetings.length} meetings · {wikiRecent.length} wiki</span>}
      </button>

      {!collapsed && (
      <div className="grid md:grid-cols-3 gap-6">
        <section className="bg-[var(--color-bg-elevated)] rounded-lg border border-[var(--color-border)] p-4">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--color-text-secondary)] mb-3">Recent Clients</h2>
          {clients.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {clients.map((c) => (
                <Link
                  key={c.id}
                  to={`/clients/${c.id}`}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-full border border-[var(--color-border)] hover:border-[var(--color-accent)] hover:bg-[var(--color-bg-secondary)] transition-colors"
                >
                  <span>{c.name}</span>
                  {c.last_contact && (
                    <span className="text-[10px] text-[var(--color-text-secondary)] opacity-60">{relativeTime(c.last_contact)}</span>
                  )}
                </Link>
              ))}
            </div>
          ) : (
            <p className="text-sm text-[var(--color-text-secondary)]">No clients yet</p>
          )}
        </section>

        <section className="bg-[var(--color-bg-elevated)] rounded-lg border border-[var(--color-border)] p-4">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--color-text-secondary)] mb-3">Recent Meetings</h2>
          {meetings.length > 0 ? (
            <ul className="space-y-3">
              {meetings.map((m) => (
                <li key={m.id}>
                  <Link
                    to={`/notes/${encodeURIComponent(m.file_path)}`}
                    className="block hover:bg-[var(--color-bg-secondary)] rounded -mx-2 px-2 py-1 transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium truncate">{m.title}</span>
                      {m.client_name && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-700 shrink-0">{m.client_name}</span>
                      )}
                    </div>
                    <p className="text-xs text-[var(--color-text-secondary)] mt-0.5 line-clamp-2">{m.preview}</p>
                    <span className="text-[10px] text-[var(--color-text-secondary)]">{formatDate(m.created_at)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-[var(--color-text-secondary)]">No meeting notes yet</p>
          )}
        </section>

        <section className="bg-[var(--color-bg-elevated)] rounded-lg border border-[var(--color-border)] p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--color-text-secondary)]">Wiki Updates</h2>
            <Link to="/wiki" className="text-xs text-[var(--color-accent)] hover:underline">View all</Link>
          </div>
          {wikiRecent.length > 0 ? (
            <ul className="space-y-2">
              {wikiRecent.slice(0, 5).map((w) => (
                <li key={w.id}>
                  <Link
                    to={`/wiki/${w.slug}`}
                    className="block hover:bg-[var(--color-bg-secondary)] rounded -mx-2 px-2 py-1 transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium truncate">{w.title}</span>
                      {w.category && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--color-bg-secondary)] text-[var(--color-text-secondary)] capitalize">{w.category}</span>
                      )}
                    </div>
                    {w.summary && <p className="text-xs text-[var(--color-text-secondary)] mt-0.5 line-clamp-1">{w.summary}</p>}
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-[var(--color-text-secondary)]">No wiki articles yet</p>
          )}
        </section>
      </div>
      )}

      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--color-text-secondary)]">Tasks</h2>

        </div>
        <div className="grid grid-cols-4 gap-3">
          {KANBAN_COLUMNS.map((col) => {
            const isArchivable = col.key === 'done'
            const doneTodos = isArchivable ? todos.filter((t) => t.status === 'done') : []
            const visibleDone = isArchivable
              ? (showArchived ? doneTodos : doneTodos.filter((t) => !t.archived_at))
              : []
            const colTodos = sortTodos(
              isArchivable ? visibleDone : todos.filter((t) => t.status === col.key)
            )
            const doneCount = doneTodos.length
            const archivedCount = isArchivable ? doneTodos.filter((t) => t.archived_at).length : 0
            return (
              <div
                key={col.key}
                className={`rounded-lg border p-3 min-h-[200px] transition-colors ${
                  dragOver === col.key
                    ? 'border-[var(--color-accent)] bg-[color-mix(in_srgb,var(--color-accent)_5%,transparent)]'
                    : 'border-[var(--color-border)] bg-[var(--color-bg-elevated)]'
                }`}
                onDragOver={(e) => { e.preventDefault(); setDragOver(col.key) }}
                onDragLeave={() => setDragOver(null)}
                onDrop={() => handleDrop(col.key)}
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full" style={{ background: col.accent }} />
                    <span className="text-xs font-semibold uppercase tracking-wider">{col.label}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {col.key === 'backlog' && colTodos.length > 0 && (
                      <>
                        {colTodos.some((t) => t.group_name) && (
                          <button
                            onClick={() => setBacklogView(backlogView === 'grouped' ? 'priority' : 'grouped')}
                            title={backlogView === 'grouped' ? 'View by priority' : 'View by group'}
                            className="text-[var(--color-text-secondary)] hover:text-[var(--color-text)] transition-colors"
                          >
                            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                              {backlogView === 'grouped' ? (
                                <path d="M4 4h8M4 8h8M4 12h8" />
                              ) : (
                                <>
                                  <rect x="1" y="1" width="5" height="5" rx="1" />
                                  <rect x="10" y="1" width="5" height="5" rx="1" />
                                  <rect x="1" y="10" width="5" height="5" rx="1" />
                                  <rect x="10" y="10" width="5" height="5" rx="1" />
                                </>
                              )}
                            </svg>
                          </button>
                        )}
                        <button
                          onClick={async () => {
                            setGrouping(true)
                            try {
                              const result = await api.suggestTodoGroups()
                              if (result.groups?.length) {
                                const updates: Record<string, string> = {}
                                for (const g of result.groups) {
                                  for (const id of g.task_ids) updates[id] = g.name
                                }
                                setTodos((prev) => prev.map((t) => updates[t.id] ? { ...t, group_name: updates[t.id] } : t))
                                setBacklogView('grouped')
                              }
                            } catch {}
                            setGrouping(false)
                          }}
                          disabled={grouping}
                          title="AI group tasks"
                          className="text-[var(--color-text-secondary)] hover:text-[var(--color-accent)] transition-colors disabled:opacity-50"
                        >
                          {grouping ? (
                            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="animate-spin">
                              <path d="M8 1a7 7 0 106.3 3.8" strokeLinecap="round" />
                            </svg>
                          ) : (
                            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                              <path d="M8 1l1.5 3.5L13 6l-3.5 1.5L8 11 6.5 7.5 3 6l3.5-1.5L8 1zM3 11l.75 1.75L5.5 13.5l-1.75.75L3 16l-.75-1.75L.5 13.5l1.75-.75L3 11z" />
                            </svg>
                          )}
                        </button>
                      </>
                    )}
                    {isArchivable && doneCount > 0 && (
                      <button
                        onClick={async () => {
                          if (!showArchived && doneTodos.some((t) => !t.archived_at)) {
                            await api.archiveDoneTodos()
                            setTodos((prev) => prev.map((t) => t.status === 'done' && !t.archived_at ? { ...t, archived_at: new Date().toISOString() } : t))
                          } else if (showArchived || archivedCount > 0) {
                            setShowArchived(!showArchived)
                          }
                        }}
                        title={!showArchived && doneTodos.some((t) => !t.archived_at) ? 'Archive done items' : showArchived ? 'Hide archived' : 'Show archived items'}
                        className="text-[var(--color-text-secondary)] hover:text-[var(--color-text)] transition-colors"
                      >
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                          {visibleDone.length === 0 && archivedCount > 0 ? (
                            <>
                              <path d="M2 4h12M3 4v9a1 1 0 001 1h8a1 1 0 001-1V4" />
                              <path d="M6 7h4" />
                            </>
                          ) : (
                            <>
                              <path d="M2 4h12M3 4v9a1 1 0 001 1h8a1 1 0 001-1V4" />
                              <path d="M5 4V3a1 1 0 011-1h4a1 1 0 011 1v1" />
                              <path d="M6 7h4" />
                            </>
                          )}
                        </svg>
                      </button>
                    )}
                    <span className="text-[10px] text-[var(--color-text-secondary)] bg-[var(--color-bg-secondary)] px-1.5 py-0.5 rounded-full">
                      {isArchivable ? doneCount : colTodos.length}
                    </span>
                  </div>
                </div>
                {isArchivable && visibleDone.length === 0 && archivedCount > 0 && !showArchived ? (
                  <p className="text-xs text-[var(--color-text-secondary)] text-center mt-8">
                    {archivedCount} done {archivedCount === 1 ? 'task' : 'tasks'} archived
                    <button onClick={() => setShowArchived(true)} className="block mx-auto mt-1 text-[var(--color-accent)] hover:underline">Show</button>
                  </p>
                ) : col.key === 'backlog' && backlogView === 'grouped' && colTodos.some((t) => t.group_name) ? (
                  <div className="space-y-2">
                    {(() => {
                      const groupNames = [...new Set(colTodos.map((t) => t.group_name || 'Ungrouped'))]
                      return groupNames.map((name) => {
                        const groupTodos = sortTodos(colTodos.filter((t) => (t.group_name || 'Ungrouped') === name))
                        if (groupTodos.length === 0) return null
                        const isGroupCollapsed = collapsedGroups.has(name)
                        return (
                          <div key={name}>
                            <button
                              onClick={() => {
                                const next = new Set(collapsedGroups)
                                isGroupCollapsed ? next.delete(name) : next.add(name)
                                setCollapsedGroups(next)
                              }}
                              className="flex items-center gap-1.5 w-full text-left mb-1.5 group/hdr"
                            >
                              <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`text-[var(--color-text-secondary)] group-hover/hdr:text-[var(--color-text)] transition-all ${isGroupCollapsed ? '-rotate-90' : ''}`}>
                                <path d="M4 6l4 4 4-4" />
                              </svg>
                              <span className="text-[11px] font-semibold text-[var(--color-text-secondary)] group-hover/hdr:text-[var(--color-text)] transition-colors">{name}</span>
                              <span className="text-[10px] text-[var(--color-text-secondary)]">({groupTodos.length})</span>
                            </button>
                            {!isGroupCollapsed && (
                              <div className="space-y-1.5 ml-3">
                                {groupTodos.map(renderTodoCard)}
                              </div>
                            )}
                          </div>
                        )
                      })
                    })()}
                    {grouping && (
                      <p className="text-xs text-[var(--color-text-secondary)] text-center mt-4 animate-pulse">Grouping...</p>
                    )}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {colTodos.map(renderTodoCard)}
                  </div>
                )}
              </div>
            )
          })}
        </div>
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
