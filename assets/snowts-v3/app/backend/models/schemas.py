from pydantic import BaseModel
from typing import Optional


class QuickNoteRequest(BaseModel):
    text: str

class SaveNoteRequest(BaseModel):
    content: str

class AnnotateRequest(BaseModel):
    annotation: str

class NoteEntry(BaseModel):
    text: str
    timestamp: str
    file_path: str
    client: Optional[str] = None
    tags: Optional[list[str]] = None

class ArticleOut(BaseModel):
    id: str
    title: str
    slug: str
    file_path: str
    summary: str
    source_type: str
    raw_source_path: Optional[str] = None
    created_at: str
    updated_at: str

class ClientOut(BaseModel):
    id: str
    name: str
    industry: str
    engagement_status: str
    summary: str
    last_contact: Optional[str] = None
    created_at: str

class ClientContactOut(BaseModel):
    id: str
    client_id: str
    name: str
    role: str
    email: Optional[str] = None

class TodoOut(BaseModel):
    id: str
    title: str
    description: str
    source_article_id: Optional[str] = None
    client_id: Optional[str] = None
    client_name: Optional[str] = None
    status: str
    due_date: Optional[str] = None
    priority: str
    created_at: str
    tags: list[str] = []
    group_name: str | None = None

class ClientRenameRequest(BaseModel):
    name: str


class ClientUpdateRequest(BaseModel):
    name: Optional[str] = None
    industry: Optional[str] = None
    engagement_status: Optional[str] = None
    summary: Optional[str] = None

class TodoUpdate(BaseModel):
    status: Optional[str] = None
    title: Optional[str] = None
    description: Optional[str] = None
    due_date: Optional[str] = None
    priority: Optional[str] = None
    client_id: Optional[str] = None
    tags: Optional[list[str]] = None
    group_name: Optional[str] = None
    archived: Optional[bool] = None
    rejected: Optional[bool] = None

class SearchResult(BaseModel):
    title: str
    snippet: str
    source_type: str
    client_name: Optional[str] = None
    file_path: str
    score: float

class PipelineRunOut(BaseModel):
    id: str
    pipeline_type: str
    status: str
    files_processed: int
    error_log: Optional[str] = None
    started_at: str
    completed_at: Optional[str] = None

class AppStatus(BaseModel):
    online: bool
    pending_sync: int
    pending_raw: int
    total_articles: int
    total_clients: int
    pending_todos: int
    completed_todos: int
