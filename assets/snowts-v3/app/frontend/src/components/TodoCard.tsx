import { useState, useEffect } from 'react'
import type { Todo } from '../types'

const priorityDot = (p: string) => {
  if (p === 'high') return 'bg-red-400'
  if (p === 'medium') return 'bg-yellow-400'
  return 'bg-gray-300'
}

export function TodoCard({
  todo,
  draggable: isDraggable,
  dragging,
  onDragStart,
  onDragEnd,
  onEdit,
  onMarkDone,
  onReject,
}: {
  todo: Todo
  draggable?: boolean
  dragging?: boolean
  onDragStart?: () => void
  onDragEnd?: () => void
  onEdit: (todo: Todo) => void
  onMarkDone: (id: string) => void
  onReject: (id: string) => void
}) {
  const [confirmReject, setConfirmReject] = useState(false)

  useEffect(() => {
    if (!confirmReject) return
    const t = setTimeout(() => setConfirmReject(false), 3000)
    return () => clearTimeout(t)
  }, [confirmReject])

  return (
    <div
      key={todo.id}
      draggable={isDraggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={`group p-2.5 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] ${
        isDraggable ? 'cursor-grab active:cursor-grabbing' : ''
      } hover:border-[var(--color-accent)] transition-colors ${
        dragging ? 'opacity-40' : ''
      }`}
    >
      <p className="text-sm leading-snug line-clamp-2">{todo.title}</p>
      <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${priorityDot(todo.priority)}`} />
        {todo.confidence === 'low' && (
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-600 border border-amber-200" title={`Source: ${todo.source || 'ai'}`}>AI</span>
        )}
        {todo.client_name && (
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-700">{todo.client_name}</span>
        )}

        {todo.due_date && (
          <span className="text-[10px] text-[var(--color-text-secondary)]">{todo.due_date}</span>
        )}
        <div className="flex items-center gap-1.5 ml-auto opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
          {confirmReject ? (
            <button
              onClick={(e) => { e.stopPropagation(); setConfirmReject(false); onReject(todo.id) }}
              title="Confirm reject"
              className="flex items-center gap-1 px-1.5 py-0.5 rounded border border-red-300 text-red-500 hover:bg-red-50 transition-colors text-[10px]"
            >
              sure?
            </button>
          ) : (
            <button
              onClick={(e) => { e.stopPropagation(); setConfirmReject(true) }}
              title="Not a todo — reject and archive"
              className="w-5 h-5 flex items-center justify-center rounded border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:text-red-500 hover:border-red-400 transition-colors"
            >
              <svg width="12" height="12" viewBox="0 0 20 20" fill="currentColor">
                <path d="M18 9.5a1.5 1.5 0 0 1-1.5 1.5H13l.89 3.56a.75.75 0 0 1-.18.7l-.71.71-4.56-4.56a1 1 0 0 1-.29-.71V5.5A1.5 1.5 0 0 1 9.65 4h5.6a1.5 1.5 0 0 1 1.47 1.2l.93 4.65c.05.22.05.43 0 .65zM4 10.5V5a1 1 0 0 0-2 0v5.5a1 1 0 0 0 2 0z" />
              </svg>
            </button>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); onEdit(todo) }}
            title="Details"
            className="w-5 h-5 flex items-center justify-center rounded-full border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:text-[var(--color-accent)] hover:border-[var(--color-accent)] transition-colors text-[10px] font-semibold italic"
          >
            i
          </button>
          {todo.status !== 'done' && (
            <button
              onClick={(e) => { e.stopPropagation(); onMarkDone(todo.id) }}
              title="Mark as done"
              className="w-5 h-5 flex items-center justify-center rounded border border-[var(--color-border)] text-transparent hover:text-emerald-500 hover:border-emerald-500 transition-colors"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2.5 6l2.5 2.5 4.5-5" />
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
