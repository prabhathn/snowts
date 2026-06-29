const API_BASE = '/api'

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail || res.statusText)
  }
  return res.json()
}

export const api = {
  getStatus: () => request<import('../types').AppStatus>('/status'),

  submitQuickNote: (text: string) =>
    request<import('../types').NoteEntry>('/notes/quick', {
      method: 'POST',
      body: JSON.stringify({ text }),
    }),

  getInbox: () =>
    request<{ content: string; metadata: { id: string; title: string; file_path: string } }>('/notes/inbox'),

  saveInbox: (content: string) =>
    request<{ ok: boolean }>('/notes/inbox', {
      method: 'PUT',
      body: JSON.stringify({ content }),
    }),

  processInbox: () =>
    request<{ ok: boolean; id: string | null }>('/notes/inbox/process', {
      method: 'POST',
    }),

  getInboxLog: () =>
    request<{
      entries: {
        id: string
        timestamp: string
        preview: string
        status: 'processing' | 'done' | 'error'
        classification: {
          sections: { client: string | null; summary: string; key_points: string[]; contacts: { name: string; role: string | null }[]; tags: string[] }[]
          todos: { title: string; due_date: string | null; priority: string; client: string | null }[]
          tags: string[]
        } | null
        routed: { client: string; file: string; client_id?: string }[] | null
        error: string | null
      }[]
    }>('/notes/inbox/log'),

  listNotes: () => request<{ notes: import('../types').Article[] }>('/notes'),

  getNote: (path: string) =>
    request<{ content: string; metadata: import('../types').Article }>(`/notes/${encodeURIComponent(path)}`),

  saveNote: (path: string, content: string) =>
    request<{ ok: boolean }>(`/notes/${encodeURIComponent(path)}`, {
      method: 'PUT',
      body: JSON.stringify({ content }),
    }),

  annotateNote: (path: string, annotation: string) =>
    request<{ ok: boolean; merged: string; summary: string }>(`/notes/${encodeURIComponent(path)}/annotate`, {
      method: 'POST',
      body: JSON.stringify({ annotation }),
    }),

  search: (q: string, filters?: { source_type?: string; client?: string }) => {
    const params = new URLSearchParams({ q })
    if (filters?.source_type) params.set('source_type', filters.source_type)
    if (filters?.client) params.set('client', filters.client)
    return request<{ results: import('../types').SearchResult[] }>(`/search?${params}`)
  },

  listClients: () => request<{ clients: import('../types').Client[] }>('/clients'),

  getClient: (id: string) =>
    request<{
      client: import('../types').Client
      contacts: import('../types').ClientContact[]
      articles: import('../types').Article[]
      todos: import('../types').Todo[]
    }>(`/clients/${id}`),

  renameClient: (id: string, name: string) =>
    request<{ ok: boolean; client: import('../types').Client; new_file_path: string }>(`/clients/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    }),

  updateClient: (id: string, update: { name?: string; industry?: string; engagement_status?: string; summary?: string }) =>
    request<{ ok: boolean; client: import('../types').Client }>(`/clients/${id}`, {
      method: 'PUT',
      body: JSON.stringify(update),
    }),

  deleteClient: (id: string) =>
    request<{ ok: boolean }>(`/clients/${id}`, { method: 'DELETE' }),

  renameClientByFile: (oldFile: string, newName: string) =>
    request<{ ok: boolean; new_file_path: string; client_id: string | null }>('/clients/rename-by-file', {
      method: 'POST',
      body: JSON.stringify({ old_file: oldFile, new_name: newName }),
    }),

  listTodos: () => request<{ todos: import('../types').Todo[] }>('/todos'),

  updateTodo: (id: string, update: Partial<import('../types').Todo>) =>
    request<import('../types').Todo>(`/todos/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(update),
    }),

  generateTodoContext: (id: string) =>
    request<import('../types').Todo>(`/todos/${id}/context`, {
      method: 'POST',
    }),

  suggestTodoGroups: () =>
    request<{ groups: { name: string; task_ids: string[] }[] }>('/todos/suggest-groups', {
      method: 'POST',
    }),

  archiveDoneTodos: () =>
    request<{ ok: boolean }>('/todos/archive-done', { method: 'POST' }),

  runPipeline: () =>
    request<import('../types').PipelineRun>('/pipeline/run', { method: 'POST' }),

  getPipelineStatus: () =>
    request<{ runs: import('../types').PipelineRun[] }>('/pipeline/status'),

  listRawFiles: () =>
    request<{ pending: string[]; processed: string[] }>('/pipeline/raw-files'),

  getConnections: () =>
    request<{ connections: { name: string; account: string; user: string; database: string }[]; current: string }>('/settings/connections'),

  switchConnection: (name: string) =>
    request<{ ok: boolean; connection: string }>('/settings/connection', {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),

  getSetupStatus: () =>
    request<{ current_connection: string; steps: { id: string; label: string; exists: boolean }[] }>('/settings/status'),

  isSetupComplete: () =>
    request<{ setup_complete: boolean }>('/settings/setup-complete'),

  testConnection: (name: string) =>
    request<{ ok: boolean; account?: string; user?: string; role?: string; error?: string }>('/settings/test-connection', {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),

  setupWithConfig: (connection_name: string, database: string, warehouse: string) =>
    request<{ results: { id: string; label: string; success: boolean; error: string | null }[]; all_success: boolean }>('/settings/setup-with-config', {
      method: 'POST',
      body: JSON.stringify({ connection_name, database, warehouse }),
    }),

  runSetup: () =>
    request<{ results: { id: string; label: string; success: boolean; error: string | null }[] }>('/settings/setup', {
      method: 'POST',
    }),

  migratePreflight: (source: string, target: string) =>
    request<{ source_counts: Record<string, number>; target_ready: boolean; target_missing: string[] }>('/settings/migrate/preflight', {
      method: 'POST',
      body: JSON.stringify({ source, target }),
    }),

  runMigration: (source: string, target: string) =>
    request<{
      results: { table: string; rows_inserted: number; rows_updated: number; success: boolean; error: string | null }[]
      files: { copied: string[]; errors: { dir: string; error: string }[] }
      search_rebuilt: boolean
    }>('/settings/migrate', {
      method: 'POST',
      body: JSON.stringify({ source, target }),
    }),

  listWikiArticles: (params?: { category?: string; tag?: string }) => {
    const p = new URLSearchParams()
    if (params?.category) p.set('category', params.category)
    if (params?.tag) p.set('tag', params.tag)
    const qs = p.toString()
    return request<{ articles: import('../types').WikiArticle[] }>(`/wiki${qs ? `?${qs}` : ''}`)
  },

  getWikiIndex: () =>
    request<{ categories: Record<string, import('../types').WikiArticle[]> }>('/wiki/index'),

  getWikiArticle: (slug: string) =>
    request<import('../types').WikiArticle>(`/wiki/${encodeURIComponent(slug)}`),

  saveWikiArticle: (slug: string, content: string) =>
    request<{ ok: boolean }>(`/wiki/${encodeURIComponent(slug)}`, {
      method: 'PUT',
      body: JSON.stringify({ content }),
    }),

  annotateWikiArticle: (slug: string, annotation: string) =>
    request<{ ok: boolean; merged: string; summary: string }>(`/wiki/${encodeURIComponent(slug)}/annotate`, {
      method: 'POST',
      body: JSON.stringify({ annotation }),
    }),

  getWikiLinks: (slug: string) =>
    request<{ outgoing: { slug: string; title: string; link_type: string }[]; incoming: { slug: string; title: string; link_type: string }[] }>(
      `/wiki/${encodeURIComponent(slug)}/links`
    ),

  getWikiHistory: (slug: string) =>
    request<{ revisions: { id: string; change_reason: string; created_at: string }[]; annotations: { id: string; instruction: string; status: string; created_at: string }[] }>(
      `/wiki/${encodeURIComponent(slug)}/history`
    ),

  getWikiCategories: () =>
    request<{ categories: { category: string; count: number }[] }>('/wiki/categories'),

  getWikiRecent: () =>
    request<{ articles: import('../types').WikiArticle[] }>('/wiki/recent'),

  uploadRawFiles: async (files: FileList | File[]) => {
    const form = new FormData()
    for (const f of files) form.append('files', f)
    const res = await fetch(`${API_BASE}/pipeline/upload-raw`, { method: 'POST', body: form })
    if (!res.ok) throw new Error(res.statusText)
    return res.json() as Promise<{ ok: boolean; saved: { file: string; size: number }[]; errors: { file: string; error: string }[] }>
  },

  ingestUrl: (url: string) =>
    request<{ ok: boolean; filename?: string; title?: string; url?: string; chars?: number; error?: string }>('/pipeline/ingest-url', {
      method: 'POST',
      body: JSON.stringify({ url }),
    }),

  smartInput: async (params: { text?: string; files?: FileList | File[] }) => {
    const form = new FormData()
    if (params.text) form.append('text', params.text)
    if (params.files) {
      for (const f of params.files) form.append('files', f)
    }
    const res = await fetch(`${API_BASE}/notes/smart`, { method: 'POST', body: form })
    if (!res.ok) throw new Error(res.statusText)
    return res.json() as Promise<{
      type: 'note' | 'url' | 'file' | 'empty'
      note: import('../types').NoteEntry | null
      url: { ok: boolean; filename?: string; title?: string; url?: string; error?: string } | null
      files: { file: string; size: number }[]
    }>
  },

  getDashboard: () =>
    request<{
      clients: { id: string; name: string; engagement_status: string; last_contact: string | null }[]
      meetings: { id: string; title: string; client_name: string | null; source_type: string; preview: string; created_at: string; file_path: string }[]
      wiki_recent: { id: string; slug: string; title: string; summary: string; category: string; updated_at: string }[]
    }>('/dashboard'),

  agentChat: (message: string, context?: { page?: string; slug?: string; client_id?: string; note_path?: string }) =>
    request<{ ok: boolean; response: string; error?: string; article_updated?: { slug: string; content: string; title: string } | null }>('/agent/chat', {
      method: 'POST',
      body: JSON.stringify({ message, context }),
    }),

  agentStream: (
    message: string,
    context: { page?: string; slug?: string; client_id?: string; note_path?: string } | undefined,
    onEvent: (event: string, data: Record<string, unknown>) => void,
    webSearch?: boolean,
  ): AbortController => {
    const controller = new AbortController()
    fetch(`${API_BASE}/agent/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, context, web_search: webSearch ?? true }),
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok || !res.body) {
          onEvent('error', { message: res.statusText })
          return
        }
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        let currentEvent = ''

        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })

          const lines = buffer.split('\n')
          buffer = lines.pop() || ''

          for (const line of lines) {
            if (line.startsWith('event: ')) {
              currentEvent = line.slice(7).trim()
            } else if (line.startsWith('data: ') && currentEvent) {
              try {
                const data = JSON.parse(line.slice(6))
                onEvent(currentEvent, data)
              } catch {
                onEvent(currentEvent, { raw: line.slice(6) })
              }
              currentEvent = ''
            }
          }
        }
      })
      .catch((err) => {
        if (err.name !== 'AbortError') {
          onEvent('error', { message: err.message || 'Stream failed' })
        }
      })
    return controller
  },

  activityStream: (
    onEvent: (event: string, data: Record<string, unknown>) => void,
  ): AbortController => {
    const controller = new AbortController()
    fetch(`${API_BASE}/activity/stream`, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok || !res.body) return
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        let currentEvent = ''

        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() || ''
          for (const line of lines) {
            if (line.startsWith('event: ')) {
              currentEvent = line.slice(7).trim()
            } else if (line.startsWith('data: ') && currentEvent) {
              try {
                const data = JSON.parse(line.slice(6))
                onEvent(currentEvent, data)
              } catch { /* skip */ }
              currentEvent = ''
            }
          }
        }
      })
      .catch(() => {})
    return controller
  },

  getActivityHistory: () =>
    request<{ events: import('../types').ActivityEvent[]; batches: import('../types').ActivityBatch[] }>('/activity/history'),
}
