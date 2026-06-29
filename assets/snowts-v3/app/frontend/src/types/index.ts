export interface Article {
  id: string
  title: string
  slug: string
  file_path: string
  summary: string
  source_type: 'wiki' | 'note' | 'raw'
  raw_source_path?: string
  created_at: string
  updated_at: string
}

export interface Client {
  id: string
  name: string
  industry: string
  engagement_status: 'active' | 'dormant' | 'prospect'
  summary: string
  last_contact: string
  created_at: string
}

export interface ClientContact {
  id: string
  client_id: string
  name: string
  role: string
  email?: string
}

export interface Tag {
  id: string
  name: string
  tag_type: 'topic' | 'client' | 'person' | 'technology'
}

export interface Todo {
  id: string
  title: string
  description: string
  source_article_id?: string
  client_id?: string
  client_name?: string
  status: 'backlog' | 'todo' | 'in_progress' | 'done'
  due_date?: string
  priority: 'low' | 'medium' | 'high'
  tags: string[]
  group_name?: string | null
  archived_at?: string | null
  confidence?: 'high' | 'low' | null
  source?: string | null
  rejected_at?: string | null
  created_at: string
}

export interface Annotation {
  id: string
  article_id: string
  highlighted_text: string
  instruction: string
  ai_response?: string
  status: 'pending' | 'processed' | 'rejected'
  created_at: string
  processed_at?: string
}

export interface PipelineRun {
  id: string
  pipeline_type: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  files_processed: number
  error_log?: string
  started_at: string
  completed_at?: string
}

export interface NoteEntry {
  text: string
  timestamp: string
  file_path: string
  client?: string
  tags?: string[]
}

export interface SearchResult {
  title: string
  snippet: string
  source_type: string
  client_name?: string
  file_path: string
  score: number
}

export interface AppStatus {
  online: boolean
  setup_complete: boolean
  pending_sync: number
  pending_raw: number
  total_articles: number
  total_clients: number
  pending_todos: number
  completed_todos: number
  total_wiki: number
}

export interface WikiArticle {
  id: string
  slug: string
  title: string
  summary: string
  content?: string
  category: string
  parent_topic?: string
  tags: string[]
  source_article_ids?: string
  created_at: string
  updated_at: string
}

export interface ActivityEvent {
  id: string
  type: string
  batch_id: string | null
  label: string
  detail: string
  status: string
  file_name: string | null
  timestamp: string
}

export interface ActivityBatch {
  id: string
  type: string
  files: Record<string, string>
  started_at: string
  completed_at: string | null
  status: string
}
