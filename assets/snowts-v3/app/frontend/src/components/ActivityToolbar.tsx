import { useState, useEffect, useRef } from 'react'
import { useActivity } from '../contexts/ActivityContext'
import { StatusIcon, BatchCard, EventTypeIcon } from './ActivityComponents'

export function ActivityToolbar() {
  const { batches, events, fileEvents, connected } = useActivity()
  const [open, setOpen] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handleClick = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  const runningBatch = batches.find((b) => b.status === 'running')
  const nonBatchEvents = events.filter((e) => !e.batch_id && e.type !== 'batch_start' && e.type !== 'batch_end')

  let summaryLabel = 'Activity'
  let summaryStatus = 'idle'
  if (runningBatch) {
    const total = Object.keys(runningBatch.files).length
    const done = Object.values(runningBatch.files).filter((s) => s === 'done').length
    summaryLabel = `${done}/${total}`
    summaryStatus = 'running'
  } else if (batches.length > 0 && batches[0].status === 'completed') {
    summaryStatus = 'completed'
  }

  return (
    <div className="relative" ref={panelRef}>
      <button
        onClick={() => setOpen(!open)}
        className="relative p-1.5 rounded-md text-[var(--color-text-secondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-bg-secondary)] transition-colors"
        title="Activity"
      >
        {summaryStatus === 'running' ? (
          <StatusIcon status="running" size={16} />
        ) : (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
        )}
        <span className={`absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-[var(--color-bg-elevated)] ${
          summaryStatus === 'running'
            ? 'bg-[var(--color-warning)]'
            : connected
            ? 'bg-[var(--color-success)]'
            : 'bg-[var(--color-text-secondary)]'
        }`} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-96 max-h-[70vh] overflow-y-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elevated)] shadow-lg z-50">
          <div className="p-3 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-[var(--color-text-secondary)] uppercase tracking-wider">Activity</span>
              {connected && (
                <span className="flex items-center gap-1 text-xs text-[var(--color-success)]">
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-success)] animate-pulse" />
                  Live
                </span>
              )}
            </div>

            {batches.slice(0, 5).map((batch) => (
              <BatchCard key={batch.id} batch={batch} fileEvents={fileEvents} />
            ))}

            {nonBatchEvents.length > 0 && (
              <div className="space-y-1 pt-1">
                <div className="text-xs font-medium text-[var(--color-text-secondary)] uppercase tracking-wider mb-1">Recent</div>
                {nonBatchEvents.slice(0, 10).map((evt) => (
                  <div key={evt.id} className="flex items-center gap-2 py-0.5">
                    <EventTypeIcon type={evt.type} />
                    <span className="text-xs flex-1 min-w-0 truncate">{evt.label}</span>
                    <span className="text-xs text-[var(--color-text-secondary)] tabular-nums shrink-0">
                      {new Date(evt.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {batches.length === 0 && nonBatchEvents.length === 0 && (
              <p className="text-xs text-[var(--color-text-secondary)] py-2">No activity yet.</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
