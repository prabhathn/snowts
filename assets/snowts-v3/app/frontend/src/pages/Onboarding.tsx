import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api/client'

type Connection = { name: string; account: string; user: string; database: string }
type TestResult = { ok: boolean; account?: string; user?: string; role?: string; error?: string }
type SetupResult = { id: string; label: string; success: boolean; error: string | null }

export function Onboarding() {
  const navigate = useNavigate()
  const [step, setStep] = useState(0)

  const [connections, setConnections] = useState<Connection[]>([])
  const [selectedConn, setSelectedConn] = useState('')
  const [testResult, setTestResult] = useState<TestResult | null>(null)
  const [testing, setTesting] = useState(false)

  const [database, setDatabase] = useState('SNOWTS_DB')
  const [warehouse, setWarehouse] = useState('SNOWTS_WH')

  const [setupResults, setSetupResults] = useState<SetupResult[]>([])
  const [setupRunning, setSetupRunning] = useState(false)
  const [setupDone, setSetupDone] = useState(false)
  const [setupError, setSetupError] = useState('')

  useEffect(() => {
    api.getConnections().then((r) => {
      setConnections(r.connections)
      if (r.connections.length > 0) setSelectedConn(r.connections[0].name)
    }).catch(() => {})
  }, [])

  async function handleTestConnection() {
    if (!selectedConn) return
    setTesting(true)
    setTestResult(null)
    try {
      const r = await api.testConnection(selectedConn)
      setTestResult(r)
    } catch (e) {
      setTestResult({ ok: false, error: String(e) })
    }
    setTesting(false)
  }

  async function handleRunSetup() {
    setSetupRunning(true)
    setSetupError('')
    setSetupResults([])
    try {
      const r = await api.setupWithConfig(selectedConn, database, warehouse)
      setSetupResults(r.results)
      setSetupDone(r.all_success)
      if (!r.all_success) {
        const failed = r.results.filter((s) => !s.success)
        setSetupError(`${failed.length} step(s) failed. Check errors below.`)
      }
    } catch (e) {
      setSetupError(String(e))
    }
    setSetupRunning(false)
  }

  function handleFinish() {
    navigate('/')
    window.location.reload()
  }

  return (
    <div className="min-h-screen bg-[var(--color-bg)] flex flex-col items-center justify-center p-8">
      <div className="w-full max-w-xl">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold mb-1">SnowTS Setup</h1>
          <p className="text-sm text-[var(--color-text-secondary)]">Configure your Snowflake connection and create the required objects.</p>
        </div>

        <div className="flex items-center justify-center gap-2 mb-8">
          {['Connection', 'Configure', 'Create Objects', 'Done'].map((label, i) => (
            <div key={i} className="flex items-center gap-2">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold border-2 transition-colors ${
                i < step ? 'bg-[var(--color-success)] border-[var(--color-success)] text-white'
                : i === step ? 'border-[var(--color-accent)] text-[var(--color-accent)] bg-transparent'
                : 'border-[var(--color-border)] text-[var(--color-text-secondary)] bg-transparent'
              }`}>
                {i < step ? '✓' : i + 1}
              </div>
              <span className={`text-xs hidden sm:inline ${i === step ? 'text-[var(--color-text)] font-medium' : 'text-[var(--color-text-secondary)]'}`}>{label}</span>
              {i < 3 && <div className={`w-8 h-px ${i < step ? 'bg-[var(--color-success)]' : 'bg-[var(--color-border)]'}`} />}
            </div>
          ))}
        </div>

        <div className="bg-[var(--color-bg-elevated)] rounded-lg border border-[var(--color-border)] p-6">

          {step === 0 && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold">Select Snowflake Connection</h2>
              <p className="text-sm text-[var(--color-text-secondary)]">Choose a connection from your <code className="text-xs bg-[var(--color-bg-secondary)] px-1 py-0.5 rounded">~/.snowflake/connections.toml</code>.</p>
              {connections.length === 0 ? (
                <p className="text-sm text-[var(--color-danger)]">No connections found. Add one to connections.toml first.</p>
              ) : (
                <div className="space-y-2">
                  {connections.map((c) => (
                    <button
                      key={c.name}
                      onClick={() => { setSelectedConn(c.name); setTestResult(null) }}
                      className={`w-full text-left px-4 py-3 rounded-md border transition-colors ${
                        selectedConn === c.name
                          ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/10'
                          : 'border-[var(--color-border)] hover:border-[var(--color-text-secondary)]'
                      }`}
                    >
                      <div className="font-medium text-sm">{c.name}</div>
                      <div className="text-xs text-[var(--color-text-secondary)]">{c.account} &middot; {c.user}</div>
                    </button>
                  ))}
                </div>
              )}

              {selectedConn && (
                <button
                  onClick={handleTestConnection}
                  disabled={testing}
                  className="px-4 py-2 text-sm rounded-md bg-[var(--color-bg-secondary)] border border-[var(--color-border)] hover:border-[var(--color-accent)] transition-colors disabled:opacity-50"
                >
                  {testing ? 'Testing...' : 'Test Connection'}
                </button>
              )}

              {testResult && (
                <div className={`p-3 rounded-md text-sm ${testResult.ok ? 'bg-[var(--color-success)]/10 text-[var(--color-success)]' : 'bg-[var(--color-danger)]/10 text-[var(--color-danger)]'}`}>
                  {testResult.ok ? (
                    <span>Connected as <strong>{testResult.user}</strong> ({testResult.role}) on {testResult.account}</span>
                  ) : (
                    <span>Failed: {testResult.error}</span>
                  )}
                </div>
              )}

              <div className="flex justify-end pt-2">
                <button
                  onClick={() => setStep(1)}
                  disabled={!testResult?.ok}
                  className="px-5 py-2 text-sm font-medium rounded-md bg-[var(--color-accent)] text-white hover:opacity-90 transition-opacity disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold">Configure Names</h2>
              <p className="text-sm text-[var(--color-text-secondary)]">Choose the database and warehouse names. These will be created if they don't exist.</p>

              <div className="space-y-3">
                <label className="block">
                  <span className="text-sm font-medium">Database Name</span>
                  <input
                    value={database}
                    onChange={(e) => setDatabase(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ''))}
                    className="mt-1 w-full px-3 py-2 text-sm rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] focus:outline-none focus:border-[var(--color-accent)]"
                  />
                  <span className="text-xs text-[var(--color-text-secondary)] mt-1 block">Schema <code className="bg-[var(--color-bg-secondary)] px-1 rounded">APP</code> will be created inside this database.</span>
                </label>
                <label className="block">
                  <span className="text-sm font-medium">Warehouse Name</span>
                  <input
                    value={warehouse}
                    onChange={(e) => setWarehouse(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ''))}
                    className="mt-1 w-full px-3 py-2 text-sm rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] focus:outline-none focus:border-[var(--color-accent)]"
                  />
                  <span className="text-xs text-[var(--color-text-secondary)] mt-1 block">XSMALL, auto-suspend 120s.</span>
                </label>
              </div>

              <div className="flex justify-between pt-2">
                <button onClick={() => setStep(0)} className="px-4 py-2 text-sm rounded-md border border-[var(--color-border)] hover:bg-[var(--color-bg-secondary)] transition-colors">Back</button>
                <button
                  onClick={() => setStep(2)}
                  disabled={!database || !warehouse}
                  className="px-5 py-2 text-sm font-medium rounded-md bg-[var(--color-accent)] text-white hover:opacity-90 transition-opacity disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold">Create Snowflake Objects</h2>
              <p className="text-sm text-[var(--color-text-secondary)]">
                This will create the database, schema, warehouse, tables, search services, semantic view, and agent in your Snowflake account.
              </p>

              <div className="bg-[var(--color-bg-secondary)] rounded-md p-3 text-sm space-y-1">
                <div><strong>Connection:</strong> {selectedConn}</div>
                <div><strong>Database:</strong> {database}.APP</div>
                <div><strong>Warehouse:</strong> {warehouse}</div>
              </div>

              {!setupRunning && setupResults.length === 0 && (
                <div className="flex justify-between pt-2">
                  <button onClick={() => setStep(1)} className="px-4 py-2 text-sm rounded-md border border-[var(--color-border)] hover:bg-[var(--color-bg-secondary)] transition-colors">Back</button>
                  <button
                    onClick={handleRunSetup}
                    className="px-5 py-2 text-sm font-medium rounded-md bg-[var(--color-accent)] text-white hover:opacity-90 transition-opacity"
                  >
                    Create All Objects
                  </button>
                </div>
              )}

              {(setupRunning || setupResults.length > 0) && (
                <div className="space-y-1 max-h-72 overflow-y-auto">
                  {setupResults.map((r) => (
                    <div key={r.id} className="flex items-center gap-2 text-sm py-1">
                      <span className={r.success ? 'text-[var(--color-success)]' : 'text-[var(--color-danger)]'}>
                        {r.success ? '✓' : '✗'}
                      </span>
                      <span className={r.success ? '' : 'text-[var(--color-danger)]'}>{r.label}</span>
                      {r.error && <span className="text-xs text-[var(--color-danger)] ml-auto truncate max-w-[200px]" title={r.error}>{r.error}</span>}
                    </div>
                  ))}
                  {setupRunning && <div className="text-sm text-[var(--color-text-secondary)] animate-pulse py-1">Creating objects...</div>}
                </div>
              )}

              {setupError && (
                <div className="p-3 rounded-md text-sm bg-[var(--color-danger)]/10 text-[var(--color-danger)]">{setupError}</div>
              )}

              {setupDone && (
                <div className="flex justify-end pt-2">
                  <button
                    onClick={() => setStep(3)}
                    className="px-5 py-2 text-sm font-medium rounded-md bg-[var(--color-success)] text-white hover:opacity-90 transition-opacity"
                  >
                    Continue
                  </button>
                </div>
              )}

              {!setupDone && !setupRunning && setupResults.length > 0 && (
                <div className="flex justify-between pt-2">
                  <button onClick={() => setStep(1)} className="px-4 py-2 text-sm rounded-md border border-[var(--color-border)] hover:bg-[var(--color-bg-secondary)] transition-colors">Back</button>
                  <button onClick={handleRunSetup} className="px-4 py-2 text-sm rounded-md bg-[var(--color-accent)] text-white hover:opacity-90 transition-opacity">
                    Retry
                  </button>
                </div>
              )}
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4 text-center py-4">
              <div className="text-4xl mb-2">&#127881;</div>
              <h2 className="text-xl font-semibold">Setup Complete</h2>
              <p className="text-sm text-[var(--color-text-secondary)]">
                All Snowflake objects have been created. You're ready to start using SnowTS.
              </p>
              <div className="bg-[var(--color-bg-secondary)] rounded-md p-3 text-sm text-left space-y-1 max-w-xs mx-auto">
                <div><strong>Database:</strong> {database}.APP</div>
                <div><strong>Warehouse:</strong> {warehouse}</div>
                <div><strong>Connection:</strong> {selectedConn}</div>
              </div>
              <button
                onClick={handleFinish}
                className="px-6 py-2.5 text-sm font-medium rounded-md bg-[var(--color-accent)] text-white hover:opacity-90 transition-opacity"
              >
                Go to Dashboard
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
