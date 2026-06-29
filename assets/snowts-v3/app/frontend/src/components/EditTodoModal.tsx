import { useState, useRef } from 'react'
import { api } from '../api/client'
import type { Todo } from '../types'

type AllClient = { id: string; name: string }

export function EditTodoModal({
  todo,
  allClients,
  existingGroups,
  onClose,
  onSave,
}: {
  todo: Todo
  allClients: AllClient[]
  existingGroups: string[]
  onClose: () => void
  onSave: (id: string, updates: Partial<Todo> & { client_id?: string | null }) => void
}) {
  const [title, setTitle] = useState(todo.title)
  const [context, setContext] = useState(todo.description || '')
  const [priority, setPriority] = useState(todo.priority)
  const [status, setStatus] = useState(todo.status)
  const [dueDate, setDueDate] = useState(todo.due_date || '')
  const [clientId, setClientId] = useState(todo.client_id || '')
  const [tags, setTags] = useState<string[]>(todo.tags || [])
  const [tagInput, setTagInput] = useState('')
  const [groupName, setGroupName] = useState(todo.group_name || '')
  const [saving, setSaving] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const backdropRef = useRef<HTMLDivElement>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    await onSave(todo.id, {
      title,
      description: context,
      priority,
      status,
      due_date: dueDate || undefined,
      client_id: clientId || null,
      tags,
      group_name: groupName || null,
    })
    setSaving(false)
  }

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={(e) => { if (e.target === backdropRef.current) onClose() }}
    >
      <form
        onSubmit={handleSubmit}
        className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)] rounded-xl shadow-xl w-full max-w-2xl mx-4 p-6 space-y-4 max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">Edit Task</h3>
          <button type="button" onClick={onClose} className="text-[var(--color-text-secondary)] hover:text-[var(--color-text)] text-xl leading-none">&times;</button>
        </div>

        <div>
          <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">Title</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full px-3 py-2 text-sm rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] focus:outline-none focus:border-[var(--color-accent)]"
            required
          />
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="block text-xs font-medium text-[var(--color-text-secondary)]">Context</label>
            <button
              type="button"
              disabled={generating}
              onClick={async () => {
                setGenerating(true)
                try {
                  const result = await api.generateTodoContext(todo.id)
                  setContext(result.description || '')
                } catch {}
                setGenerating(false)
              }}
              className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium rounded-md border border-[var(--color-accent)]/30 text-[var(--color-accent)] hover:bg-[var(--color-accent)]/10 transition-colors disabled:opacity-50"
            >
              <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                <path d="M8 1l1.5 3.5L13 6l-3.5 1.5L8 11 6.5 7.5 3 6l3.5-1.5L8 1zM3 11l.75 1.75L5.5 13.5l-1.75.75L3 16l-.75-1.75L.5 13.5l1.75-.75L3 11z" />
              </svg>
              {generating ? 'Generating...' : 'Give me Context'}
            </button>
          </div>
          <textarea
            value={context}
            onChange={(e) => setContext(e.target.value)}
            rows={12}
            placeholder="Click 'Give me Context' to auto-generate from related notes"
            className="w-full px-3 py-2 text-sm rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] focus:outline-none focus:border-[var(--color-accent)] resize-y min-h-[80px]"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">Priority</label>
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value as Todo['priority'])}
              className="w-full px-3 py-2 text-sm rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] focus:outline-none focus:border-[var(--color-accent)]"
            >
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">Due Date</label>
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] focus:outline-none focus:border-[var(--color-accent)]"
            />
          </div>
        </div>

        <div>
          <button
            type="button"
            onClick={() => setAdvancedOpen(!advancedOpen)}
            className="flex items-center gap-1.5 group/adv cursor-pointer"
          >
            <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`text-[var(--color-text-secondary)] group-hover/adv:text-[var(--color-text)] transition-all ${advancedOpen ? '' : '-rotate-90'}`}>
              <path d="M4 6l4 4 4-4" />
            </svg>
            <span className="text-xs font-medium text-[var(--color-text-secondary)] group-hover/adv:text-[var(--color-text)] transition-colors">Advanced</span>
          </button>
          {advancedOpen && (
            <div className="mt-3 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">Status</label>
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value as Todo['status'])}
                    className="w-full px-3 py-2 text-sm rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] focus:outline-none focus:border-[var(--color-accent)]"
                  >
                    <option value="backlog">Backlog</option>
                    <option value="todo">To Do</option>
                    <option value="in_progress">In Progress</option>
                    <option value="done">Done</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">Client</label>
                  <select
                    value={clientId}
                    onChange={(e) => setClientId(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] focus:outline-none focus:border-[var(--color-accent)]"
                  >
                    <option value="">None</option>
                    {allClients.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">Group</label>
                <input
                  list="group-options"
                  value={groupName}
                  onChange={(e) => setGroupName(e.target.value)}
                  placeholder="No group"
                  className="w-full px-3 py-2 text-sm rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] focus:outline-none focus:border-[var(--color-accent)]"
                />
                <datalist id="group-options">
                  {existingGroups.map((g) => (
                    <option key={g} value={g} />
                  ))}
                </datalist>
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">Tags</label>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {tags.map((tag) => (
                    <span key={tag} className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full bg-[var(--color-bg-secondary)] border border-[var(--color-border)]">
                      {tag}
                      <button type="button" onClick={() => setTags(tags.filter((t) => t !== tag))} className="text-[var(--color-text-secondary)] hover:text-[var(--color-text)] leading-none">&times;</button>
                    </span>
                  ))}
                </div>
                <input
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => {
                    if ((e.key === 'Enter' || e.key === ',') && tagInput.trim()) {
                      e.preventDefault()
                      const newTag = tagInput.trim().toLowerCase().replace(/,$/g, '')
                      if (newTag && !tags.includes(newTag)) setTags([...tags, newTag])
                      setTagInput('')
                    }
                  }}
                  placeholder="Type a tag and press Enter"
                  className="w-full px-3 py-2 text-sm rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] focus:outline-none focus:border-[var(--color-accent)]"
                />
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm rounded-md border border-[var(--color-border)] hover:bg-[var(--color-bg-secondary)] transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving || !title.trim()}
            className="px-4 py-2 text-sm rounded-md bg-[var(--color-accent)] text-white hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </form>
    </div>
  )
}
