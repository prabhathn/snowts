# DESIGN.md -- UI Design Specification

This document describes the visual and interaction design of SnowTS. It is **advisory** -- the agent should use these as guidelines and adapt to the user's preferred framework and style. The goal is to capture the *intent* of the design, not prescribe CSS.

## Design Philosophy

1. **Light-mode default, dark-code**: Clean light surfaces for reading/writing, dark backgrounds only for code blocks
2. **Information-dense**: Maximize content per viewport; use compact spacing, small text for metadata
3. **Keyboard-centric**: Every primary action has a keyboard shortcut; command palette for navigation
4. **Progressive disclosure**: Start with summaries, expand to detail on interaction
5. **AI as companion**: The AI agent is always accessible but never intrusive -- a sliding panel, not a modal

## Color System

Semantic color roles with reference values. The agent should adapt these to the user's preference while maintaining the role distinctions.

| Role | Reference Value | Usage |
|---|---|---|
| `bg` | `#fafafa` | Page background |
| `bg-secondary` | `#f0f0f0` | Sidebar, hover states, subtle backgrounds |
| `bg-elevated` | `#ffffff` | Cards, panels, modals, header |
| `text` | `#1a1a2e` | Primary body text |
| `text-secondary` | `#6b7280` | Labels, metadata, timestamps |
| `border` | `#e5e7eb` | Dividers, card outlines, input borders |
| `accent` | `#2563eb` | Buttons, links, active states, agent bubble |
| `accent-hover` | `#1d4ed8` | Hover state for accent elements |
| `success` | `#10b981` | Completed, connected, positive states |
| `warning` | `#f59e0b` | In-progress, running, caution states |
| `danger` | `#ef4444` | Errors, delete actions, failures |
| `code-bg` | `#1e1e2e` | Code block background (always dark) |
| `code-text` | `#cdd6f4` | Code block text |

## Typography

| Element | Size | Weight | Notes |
|---|---|---|---|
| Font family | Inter, system-ui, sans-serif | -- | Clean, readable sans-serif |
| Body text | 1rem | 400 | Line-height 1.6 |
| H1 | 1.75rem | 700 | Page titles |
| H2 | 1.375rem | 600 | Section headers |
| H3 | 1.125rem | 600 | Subsection headers |
| Section labels | 0.875rem | 600 | Uppercase, tracking-wider, text-secondary |
| Code inline | 0.875rem | 400 | bg-secondary, border-radius 0.25rem |
| Code block | 0.875rem | 400 | Dark bg (#1e1e2e), light text (#cdd6f4) |
| Metadata/tags | 0.75rem | 400 | text-secondary |

## Layout Architecture

The application shell follows a **sticky header + scrollable main** pattern:

```
+--------------------------------------------------------------+
| HEADER (sticky, z-40, bg-elevated, border-bottom)            |
|  [Logo] [Nav: Dashboard Notes Wiki Clients Search] [Actions] |
|  [Sub-toolbar: Quick Note / Ask Agent toggles + Panel]       |
+--------------------------------------------------------------+
| MAIN (flex-1, scrollable, max-w-7xl centered, px-4 py-6)    |
|                                                               |
|  [Page Content - rendered by router]                         |
|                                                               |
+--------------------------------------------------------------+
```

| Element | Dimension |
|---|---|
| Header height | 56px (h-14) |
| Max content width | 1280px (max-w-7xl) |
| Horizontal padding | 16px (px-4) |
| Vertical padding (main) | 24px (py-6) |

## Component Catalog

### Navigation Bar

Top-level horizontal nav in the header. Each item is a text link with active state highlighting.

- Active: accent background, white text
- Inactive: text-secondary, hover to text-primary + bg-secondary
- Padding: 12px horizontal, 6px vertical
- Border-radius: 6px (rounded-md)

### Command Palette (Cmd+K)

Full-screen overlay with centered search input and result list.

- Overlay: fixed fullscreen, black/40% backdrop, z-50
- Container: max-width 576px, centered, rounded-xl, shadow-2xl, bg-elevated
- Input: full-width, padded (16px horizontal, 12px vertical), border-bottom
- Results: scrollable list (max-height 320px), items as buttons with hover highlight
- Supports mode switching: prefix `/note` for quick note, `>` for command mode

### Agent Panel

Sliding chat panel that opens below the header toolbar.

- Chat container: fixed height (320px default), resizable (min 120px, max 70vh)
- User messages: right-aligned, accent background, white text, rounded-lg
- Assistant messages: left-aligned, bg-elevated, border, rounded-lg
- Message max-width: 85%
- Message padding: 12px horizontal, 8px vertical
- Step indicators: text-xs, text-secondary, inline icons for tool usage
- Web search toggle: pill badge, accent when on, strikethrough when off
- Scroll-to-bottom button: floating, appears on scroll-up
- "Save as Note" action on each assistant message

### Quick Input

Unified input bar for text notes, URLs, and file uploads.

- Input area: textarea with auto-grow (min 36px, max 100px)
- Send button: accent background, flush-right rounded
- File chips: small tags (text-xs) with filename, bg-secondary, border, max-width 120px truncated
- Smart detection: URLs get fetched, files get uploaded, text becomes notes
- Flash feedback: border color changes to success/danger for 3 seconds after submit

### Activity Toolbar

Status indicator in the header showing pipeline activity.

- Icon button with status dot (10px): success=connected, warning=running, secondary=disconnected
- Dropdown: 384px wide, rounded-lg, shadow-lg, padded, max-height 70vh
- Animated pulse dot when live-connected

### Cards

Standard container for content items throughout the app.

- Background: bg-elevated
- Border: 1px solid border color
- Border-radius: 8px (rounded-lg)
- Padding: 16px (p-4)

### Section Headers

Consistent label style for grouping content.

- Font: 0.875rem (text-sm), font-semibold, uppercase, letter-spacing wider
- Color: text-secondary

## Page Patterns

### Dashboard

Overview page with KPIs and recent items.

- Layout: 3-column grid (responsive to single column on mobile)
- Sections: Overview stats, Recent clients, Recent wiki articles
- Todo kanban: 4-column grid (Backlog, Todo, In Progress, Done)
  - Column accent dots: secondary, accent, warning, success
  - Drag-and-drop support with highlight on drag-over
  - AI grouping action (sparkle icon)

### List Page (Clients, Wiki Index)

Filterable list of entities.

- Optional sidebar for filters/categories
- Content area: list or grid of cards
- Each card: title + metadata + status indicators

### Detail Page (Client Detail, Wiki Article)

Entity view with related data.

- Header: entity name + metadata + actions
- Tabs or sections for related items (contacts, articles, todos)
- Inline editing support

### Editor Page (Notes, Wiki Editor)

Markdown editing with live preview.

- Split or tabbed layout: edit + preview
- Toolbar for formatting actions
- Auto-save or explicit save button

## Interaction Patterns

### Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| Cmd/Ctrl + K | Open command palette |
| Escape | Close modal/palette/panel |
| Enter | Submit input (in Quick Input, Agent Panel, Command Palette) |

### Streaming Responses

Agent responses stream token-by-token via SSE. The UI should:
- Show a typing indicator while streaming
- Render markdown incrementally
- Display tool use steps as compact indicators
- Auto-scroll to latest content

### State Management

Global state (Zustand in reference implementation) tracks:
- Active panel (note/agent/null)
- Active connection
- Dashboard data
- Agent chat history

### Offline Behavior

When Snowflake is unreachable:
- Queue write operations locally (SQLite or equivalent)
- Show connection status indicator
- Replay queued operations on reconnect

## Personalization Guidance

The agent should adapt the design based on interview answers:

| User preference | Design adaptation |
|---|---|
| Keyboard-heavy workflow | Prioritize command palette, add vim-like bindings |
| Visual/spatial thinker | Add graph view for wiki links, card-based layouts |
| Minimalist | Reduce chrome, single-column, hide secondary actions |
| Dense information | Multi-column, compact cards, more data per viewport |
| Mobile-first | Responsive breakpoints, touch-friendly targets, bottom nav |
| Dark mode preferred | Invert the color system (dark bg, light text) |
