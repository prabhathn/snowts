import { useEffect, useState, useRef } from 'react'
import { useAppStore } from '../store'
import { api } from '../api/client'
import type { PipelineRun, ActivityEvent, ActivityBatch } from '../types'
import { STATUS_CONFIG, StatusIcon, FileStatusRow, BatchCard, EventTypeIcon } from '../components/ActivityComponents'
import { useActivity } from '../contexts/ActivityContext'

type Connection = { name: string; account: string; user: string; database: string }
type SetupStep = { id: string; label: string; exists: boolean }
type SetupResult = { id: string; label: string; success: boolean; error: string | null }
type MigrateTableResult = { table: string; rows_inserted: number; rows_updated: number; success: boolean; error: string | null }
type PreflightResult = { source_counts: Record<string, number>; target_ready: boolean; target_missing: string[] }

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      className={`w-4 h-4 text-[var(--color-text-secondary)] transition-transform duration-200 ${open ? 'rotate-90' : ''}`}
      fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
    </svg>
  )
}

function CollapsibleSection({ title, defaultOpen = false, children }: { title: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <section className="bg-[var(--color-bg-elevated)] rounded-lg border border-[var(--color-border)] overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 p-5 text-left hover:bg-[var(--color-bg-secondary)] transition-colors"
      >
        <ChevronIcon open={open} />
        <h2 className="text-lg font-semibold">{title}</h2>
      </button>
      {open && <div className="px-5 pt-1 pb-5 space-y-6">{children}</div>}
    </section>
  )
}

function ActivityLog({ pendingFiles, onProcess }: {
  pendingFiles: string[]
  onProcess: () => void
}) {
  const { batches, events, fileEvents, connected } = useActivity()
  const runningPipeline = batches.some((b) => b.status === 'running')

  const nonBatchEvents = events.filter((e) => !e.batch_id && e.type !== 'batch_start' && e.type !== 'batch_end')

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium text-[var(--color-text-secondary)] uppercase tracking-wider">Activity</label>
          {connected && (
            <span className="flex items-center gap-1 text-xs text-[var(--color-success)]">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-success)] animate-pulse" />
              Live
            </span>
          )}
        </div>
        <button
          onClick={onProcess}
          disabled={runningPipeline || pendingFiles.length === 0}
          className="px-3 py-1.5 text-xs font-medium bg-[var(--color-accent)] text-white rounded-md hover:bg-[var(--color-accent-hover)] disabled:opacity-40 transition-colors"
        >
          {runningPipeline ? 'Processing...' : `Process ${pendingFiles.length} file${pendingFiles.length !== 1 ? 's' : ''}`}
        </button>
      </div>

      {pendingFiles.length > 0 && !batches.some((b) => b.status === 'running') && (
        <div className="rounded-lg border border-dashed border-[var(--color-border)] p-3">
          <div className="text-xs font-medium text-[var(--color-text-secondary)] mb-2">
            Ready to process
          </div>
          <div className="space-y-1">
            {pendingFiles.map((f) => (
              <div key={f} className="flex items-center gap-2 text-sm text-[var(--color-text-secondary)]">
                <div className="w-1.5 h-1.5 rounded-full bg-[var(--color-border)]" />
                <span className="truncate">{f}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {batches.map((batch) => (
        <BatchCard key={batch.id} batch={batch} fileEvents={fileEvents} />
      ))}

      {nonBatchEvents.length > 0 && (
        <div className="space-y-1 pt-2">
          <div className="text-xs font-medium text-[var(--color-text-secondary)] uppercase tracking-wider mb-2">Recent Actions</div>
          {nonBatchEvents.slice(0, 20).map((evt) => (
            <div key={evt.id} className="flex items-center gap-2.5 py-1">
              <EventTypeIcon type={evt.type} />
              <span className="text-sm flex-1 min-w-0 truncate">{evt.label}</span>
              {evt.detail && (
                <span className="text-xs text-[var(--color-text-secondary)] truncate max-w-[200px]">{evt.detail}</span>
              )}
              <span className="text-xs text-[var(--color-text-secondary)] tabular-nums shrink-0">
                {new Date(evt.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
          ))}
        </div>
      )}

      {batches.length === 0 && nonBatchEvents.length === 0 && pendingFiles.length === 0 && (
        <p className="text-sm text-[var(--color-text-secondary)] py-2">
          No activity yet. Drop documents into raw/ or use the ingest URL above.
        </p>
      )}
    </div>
  )
}

export function Settings() {
  const { status } = useAppStore()
  const { batches } = useActivity()
  const [connections, setConnections] = useState<Connection[]>([])
  const [current, setCurrent] = useState('')
  const [switching, setSwitching] = useState(false)

  const [pendingFiles, setPendingFiles] = useState<string[]>([])
  const [processedFiles, setProcessedFiles] = useState<string[]>([])

  const [steps, setSteps] = useState<SetupStep[]>([])
  const [loadingStatus, setLoadingStatus] = useState(false)
  const [setupRunning, setSetupRunning] = useState(false)
  const [setupResults, setSetupResults] = useState<SetupResult[] | null>(null)

  const [migrateSource, setMigrateSource] = useState('')
  const [migrateTarget, setMigrateTarget] = useState('')
  const [preflight, setPreflight] = useState<PreflightResult | null>(null)
  const [preflightLoading, setPreflightLoading] = useState(false)
  const [migrateRunning, setMigrateRunning] = useState(false)
  const [migrateResults, setMigrateResults] = useState<{ results: MigrateTableResult[]; files: { copied: string[]; errors: { dir: string; error: string }[] }; search_rebuilt: boolean } | null>(null)

  const refreshFiles = () => {
    api.listRawFiles().then((r) => { setPendingFiles(r.pending); setProcessedFiles(r.processed) }).catch(() => {})
  }

  useEffect(() => {
    api.getConnections().then((r) => {
      setConnections(r.connections)
      setCurrent(r.current)
      if (!migrateSource && r.current) setMigrateSource(r.current)
    }).catch(() => {})
    refreshFiles()
  }, [])

  const handleRunPipeline = async () => {
    try { await api.runPipeline() }
    catch {}
  }

  const prevRunningRef = useRef(false)
  useEffect(() => {
    const isRunning = batches.some((b) => b.status === 'running')
    if (prevRunningRef.current && !isRunning) {
      refreshFiles()
    }
    prevRunningRef.current = isRunning
  }, [batches])

  const loadStatus = () => {
    setLoadingStatus(true)
    api.getSetupStatus().then((r) => {
      setSteps(r.steps)
      setCurrent(r.current_connection)
    }).catch(() => {}).finally(() => setLoadingStatus(false))
  }

  useEffect(() => { loadStatus() }, [])

  const handleSwitch = async (name: string) => {
    setSwitching(true)
    try {
      await api.switchConnection(name)
      setCurrent(name)
      setSetupResults(null)
      loadStatus()
    } catch {}
    setSwitching(false)
  }

  const handleSetup = async () => {
    setSetupRunning(true)
    setSetupResults(null)
    try {
      const r = await api.runSetup()
      setSetupResults(r.results)
      loadStatus()
    } catch {}
    setSetupRunning(false)
  }

  const handlePreflight = async () => {
    setPreflightLoading(true)
    setPreflight(null)
    setMigrateResults(null)
    try {
      const r = await api.migratePreflight(migrateSource, migrateTarget)
      setPreflight(r)
    } catch {}
    setPreflightLoading(false)
  }

  const handleMigrate = async () => {
    setMigrateRunning(true)
    setMigrateResults(null)
    try {
      const r = await api.runMigration(migrateSource, migrateTarget)
      setMigrateResults(r)
    } catch {}
    setMigrateRunning(false)
  }

  const allExist = steps.length > 0 && steps.every((s) => s.exists)
  const currentConn = connections.find((c) => c.name === current)

  const pendingTodos = status?.pending_todos ?? 0
  const completedTodos = status?.completed_todos ?? 0
  const totalTodos = pendingTodos + completedTodos

  return (
    <div className="space-y-6 pb-24 max-w-3xl">
      <h1 className="text-2xl font-bold">Settings</h1>

      <section className="bg-[var(--color-bg-elevated)] rounded-lg border border-[var(--color-border)] p-5 space-y-4">
        <h2 className="text-lg font-semibold">Overview</h2>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          {[
            { label: 'Processed Docs', value: processedFiles.length || (status?.total_articles ?? '\u2014') },
            { label: 'Clients', value: status?.total_clients ?? '\u2014' },
            { label: 'Wiki Articles', value: status?.total_wiki ?? '\u2014' },
            { label: 'TODOs', value: totalTodos ? `${pendingTodos} / ${totalTodos}` : '\u2014', sub: totalTodos ? `${completedTodos} done` : undefined },
            { label: 'Pending Raw', value: pendingFiles.length },
          ].map((stat) => (
            <div key={stat.label} className="text-center">
              <div className="text-2xl font-bold">{stat.value}</div>
              <div className="text-xs text-[var(--color-text-secondary)] mt-1">{stat.label}</div>
              {'sub' in stat && stat.sub && (
                <div className="text-xs text-[var(--color-text-secondary)] opacity-60">{stat.sub}</div>
              )}
            </div>
          ))}
        </div>
      </section>

      <CollapsibleSection title="Document Processing" defaultOpen>
        <div className="space-y-2">
          <label className="text-xs font-medium text-[var(--color-text-secondary)] uppercase tracking-wider">Document Sources</label>
          <div className="opacity-50 pointer-events-none select-none">
            <div className="flex items-center justify-between p-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-md bg-white flex items-center justify-center shadow-sm border border-[var(--color-border)]">
                  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none">
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                  </svg>
                </div>
                <div>
                  <div className="text-sm font-medium">Google Workspace</div>
                  <div className="text-xs text-[var(--color-text-secondary)]">Drive, Docs, Sheets, Slides</div>
                </div>
              </div>
              <button className="px-3 py-1.5 text-xs font-medium rounded-md border border-[var(--color-border)] text-[var(--color-text-secondary)]">
                Connect
              </button>
            </div>
            <p className="text-xs text-[var(--color-text-secondary)] mt-2 italic">More sources and MCP servers coming soon.</p>
          </div>
        </div>
        <div className="border-t border-[var(--color-border)]" />
        <ActivityLog
          pendingFiles={pendingFiles}
          onProcess={handleRunPipeline}
        />
      </CollapsibleSection>

      <CollapsibleSection title="Infrastructure">
        <div className="space-y-4">
          <label className="text-xs font-medium text-[var(--color-text-secondary)] uppercase tracking-wider">Connection</label>
          {currentConn && (
            <div className="text-sm text-[var(--color-text-secondary)] space-y-0.5">
              <p>Account: <span className="text-[var(--color-text)]">{currentConn.account}</span></p>
              <p>User: <span className="text-[var(--color-text)]">{currentConn.user}</span></p>
              {currentConn.database && <p>Database: <span className="text-[var(--color-text)]">{currentConn.database}</span></p>}
            </div>
          )}
          <div className="flex items-center gap-3">
            <select
              value={current}
              onChange={(e) => handleSwitch(e.target.value)}
              disabled={switching}
              className="text-sm px-3 py-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] outline-none focus:border-[var(--color-accent)]"
            >
              {connections.map((c) => (
                <option key={c.name} value={c.name}>{c.name}</option>
              ))}
            </select>
            {switching && <span className="text-xs text-[var(--color-text-secondary)]">Switching...</span>}
          </div>
        </div>

        <div className="border-t border-[var(--color-border)]" />

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-[var(--color-text-secondary)] uppercase tracking-wider">Setup</label>
            <div className="flex items-center gap-3">
              <button
                onClick={loadStatus}
                disabled={loadingStatus}
                className="text-xs px-3 py-1.5 rounded border border-[var(--color-border)] hover:bg-[var(--color-bg-secondary)] transition-colors disabled:opacity-40"
              >
                {loadingStatus ? 'Checking...' : 'Refresh'}
              </button>
              <button
                onClick={handleSetup}
                disabled={setupRunning || allExist}
                className="text-xs px-4 py-1.5 rounded border border-[var(--color-accent)] text-[var(--color-accent)] hover:bg-[var(--color-accent)] hover:text-white transition-colors disabled:opacity-40 font-medium"
              >
                {setupRunning ? 'Running...' : allExist ? 'All Set' : 'Run Setup'}
              </button>
            </div>
          </div>

          {steps.length > 0 && (
            <div className="space-y-1">
              {steps.map((step) => {
                const result = setupResults?.find((r) => r.id === step.id)
                return (
                  <div key={step.id} className="flex items-center gap-3 text-sm py-1">
                    {step.exists ? (
                      <svg className="w-4 h-4 text-[var(--color-success)] shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    ) : (
                      <svg className="w-4 h-4 text-[var(--color-error)] shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    )}
                    <span className={step.exists ? 'text-[var(--color-text)]' : 'text-[var(--color-text-secondary)]'}>{step.label}</span>
                    {result && !result.success && result.error && (
                      <span className="text-xs text-[var(--color-error)] ml-auto truncate max-w-xs">{result.error}</span>
                    )}
                    {result && result.success && !step.exists && (
                      <span className="text-xs text-[var(--color-success)] ml-auto">Created</span>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <div className="border-t border-[var(--color-border)]" />

        <div className="space-y-4">
          <label className="text-xs font-medium text-[var(--color-text-secondary)] uppercase tracking-wider">Migration</label>
          <p className="text-sm text-[var(--color-text-secondary)]">
            One-way upsert from source to target. Existing data in the target is preserved.
          </p>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-xs font-medium text-[var(--color-text-secondary)]">Source</label>
              <select
                value={migrateSource}
                onChange={(e) => { setMigrateSource(e.target.value); setPreflight(null); setMigrateResults(null) }}
                className="w-full text-sm px-3 py-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] outline-none focus:border-[var(--color-accent)]"
              >
                <option value="">Select...</option>
                {connections.map((c) => (
                  <option key={c.name} value={c.name}>{c.name}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-[var(--color-text-secondary)]">Target</label>
              <select
                value={migrateTarget}
                onChange={(e) => { setMigrateTarget(e.target.value); setPreflight(null); setMigrateResults(null) }}
                className="w-full text-sm px-3 py-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] outline-none focus:border-[var(--color-accent)]"
              >
                <option value="">Select...</option>
                {connections.filter((c) => c.name !== migrateSource).map((c) => (
                  <option key={c.name} value={c.name}>{c.name}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handlePreflight}
              disabled={!migrateSource || !migrateTarget || preflightLoading}
              className="text-xs px-4 py-1.5 rounded border border-[var(--color-border)] hover:bg-[var(--color-bg-secondary)] transition-colors disabled:opacity-40 font-medium"
            >
              {preflightLoading ? 'Checking...' : 'Pre-flight Check'}
            </button>
            <button
              onClick={handleMigrate}
              disabled={!preflight || !preflight.target_ready || migrateRunning}
              className="text-xs px-4 py-1.5 rounded border border-[var(--color-accent)] text-[var(--color-accent)] hover:bg-[var(--color-accent)] hover:text-white transition-colors disabled:opacity-40 font-medium"
            >
              {migrateRunning ? 'Migrating...' : 'Migrate'}
            </button>
          </div>

          {preflight && (
            <div className="space-y-3">
              {!preflight.target_ready && (
                <div className="text-sm text-[var(--color-warning)] bg-[color-mix(in_srgb,var(--color-warning)_10%,transparent)] rounded p-3">
                  Target is missing infrastructure. Run Setup on the target connection first:
                  <ul className="mt-1 ml-4 list-disc text-xs">
                    {preflight.target_missing.map((m) => <li key={m}>{m}</li>)}
                  </ul>
                </div>
              )}
              <div className="space-y-1">
                <h3 className="text-xs font-medium text-[var(--color-text-secondary)] uppercase tracking-wider">Source Row Counts</h3>
                {Object.entries(preflight.source_counts).map(([table, count]) => (
                  <div key={table} className="flex items-center justify-between text-sm py-0.5">
                    <span>{table}</span>
                    <span className="text-[var(--color-text-secondary)]">{count === -1 ? 'Error' : count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {migrateResults && (
            <div className="space-y-3">
              <h3 className="text-xs font-medium text-[var(--color-text-secondary)] uppercase tracking-wider">Migration Results</h3>
              <div className="space-y-1">
                {migrateResults.results.map((r) => (
                  <div key={r.table} className="flex items-center justify-between text-sm py-0.5">
                    <div className="flex items-center gap-2">
                      {r.success ? (
                        <svg className="w-3.5 h-3.5 text-[var(--color-success)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      ) : (
                        <svg className="w-3.5 h-3.5 text-[var(--color-error)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      )}
                      <span>{r.table}</span>
                    </div>
                    {r.success ? (
                      <span className="text-xs text-[var(--color-text-secondary)]">
                        +{r.rows_inserted} inserted, {r.rows_updated} updated
                      </span>
                    ) : (
                      <span className="text-xs text-[var(--color-error)] truncate max-w-xs">{r.error}</span>
                    )}
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-4 text-sm">
                <span className="flex items-center gap-1.5">
                  {migrateResults.files.copied.length > 0 ? (
                    <svg className="w-3.5 h-3.5 text-[var(--color-success)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    <span className="w-3.5 h-3.5 text-[var(--color-text-secondary)]">-</span>
                  )}
                  Files: {migrateResults.files.copied.join(', ') || 'none'}
                </span>
                <span className="flex items-center gap-1.5">
                  {migrateResults.search_rebuilt ? (
                    <svg className="w-3.5 h-3.5 text-[var(--color-success)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    <svg className="w-3.5 h-3.5 text-[var(--color-error)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  )}
                  Search Service: {migrateResults.search_rebuilt ? 'Rebuilt' : 'Failed'}
                </span>
              </div>
            </div>
          )}
        </div>
      </CollapsibleSection>
    </div>
  )
}
