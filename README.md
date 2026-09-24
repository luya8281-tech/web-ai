# Antigravity AI — Production Multi-Provider AI Chat Platform

A complete, production-ready AI chat platform engineered for VPS environments, inspired by modern conversational AI systems (ChatGPT, Claude, Gemini) with a clean, unbloated visual language, native mobile support, and a robust pluggable provider adapter layer.

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                      Client Browser                         │
│   (Next.js App Router, Tailwind CSS, Zustand, PrismJS)      │
└──────────────────────────────┬──────────────────────────────┘
                               │ HTTPS / SSE (EventStream)
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                    Next.js API Gateway                      │
│             (/api/chat, /api/models, etc.)                  │
│  - Never exposes secret API keys to client                  │
│  - Resolves System Prompt Hierarchy (Conv > Proj > Global)  │
│  - Server-Sent Events (SSE) streaming with partial save     │
└──────────────┬──────────────────────────────┬───────────────┘
               │                              │
               ▼                              ▼
┌──────────────────────────────┐ ┌────────────────────────────┐
│      SQLite Database         │ │         AI Router          │
│ (WAL Mode, Better-SQLite3)   │ │   (Provider Abstraction)   │
│  - Users & Sessions          │ └──────────────┬─────────────┘
│  - Providers & Credentials   │                │
│  - Models (w/ Capabilities)  │       ┌────────┴────────┬───────────────┐
│  - Conversations & Messages  │       ▼                 ▼               ▼
│  - Folders / Projects        │ ┌───────────┐     ┌───────────┐   ┌───────────┐
│  - User Preferences          │ │  xKiro    │     │   Apmix   │   │ Local/VPS │
└──────────────────────────────┘ │ (OpenAI)  │     │ (OpenAI)  │   │ Gateway   │
                                 └───────────┘     └───────────┘   └───────────┘
```

### Core Architecture Principles:
- **Server-Side API Proxying**: API keys for upstream providers are securely stored in the database or server environment variables and never touch the client DOM or network inspector.
- **Provider Protocol Independence**: Clean `AIProvider` interface with adapter implementations (`OpenAICompatibleAdapter`, `AnthropicAdapter`, `MockDevAdapter`).
- **Dynamic Model Discovery**: Queries the provider's `/v1/models` endpoint live and synchronizes capability flags (`vision`, `tools`, `reasoning`), context window size, and pricing into the local catalog.
- **Resilient Streaming**: Server-Sent Events (SSE) stream tokens and reasoning content progressively. If generation is interrupted by the user (Stop button) or network disconnect, all partial response tokens received up to that point are saved to the database.
- **Single-User / Private VPS Mode**: Zero-friction local deployment for private VPS usage (`AUTH_MODE=single-user`), with pre-configured admin profile.

---

## 2. Project Structure

```
/root/ai-chat/
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── chat/route.ts                # Real-time SSE streaming endpoint
│   │   │   ├── models/route.ts              # Model catalog & dynamic discovery
│   │   │   ├── providers/route.ts           # Provider management CRUD
│   │   │   ├── providers/[id]/route.ts      # Provider update & delete
│   │   │   ├── providers/test/route.ts      # Live connection testing
│   │   │   ├── conversations/route.ts       # Conversation list & creation
│   │   │   ├── conversations/[id]/route.ts  # History retrieval & modification
│   │   │   ├── conversations/[id]/export/route.ts # Markdown / JSON / TXT export
│   │   │   ├── conversations/import/route.ts# Import external conversations
│   │   │   ├── messages/route.ts            # Message persistence
│   │   │   ├── messages/[id]/route.ts       # Message update & deletion
│   │   │   ├── messages/[id]/truncate/route.ts # Edit user message truncation
│   │   │   ├── projects/route.ts            # Folders & project workspaces
│   │   │   ├── settings/route.ts            # User settings & preferences
│   │   │   └── upload/route.ts              # Document & image upload handler
│   │   ├── globals.css                      # Design tokens, themes, scrollbars
│   │   ├── layout.tsx                       # Root layout & modal mount points
│   │   └── page.tsx                         # Main chat workspace view
│   ├── components/
│   │   ├── chat/
│   │   │   ├── chat-container.tsx           # Auto-scroll & live token render
│   │   │   ├── top-nav.tsx                  # Model selector pill & export menu
│   │   │   ├── composer.tsx                 # Auto-expand textarea & attachments
│   │   │   ├── message-item.tsx             # Markdown, reasoning block, edit/copy
│   │   │   └── empty-state.tsx              # Starter prompts & model pill
│   │   ├── sidebar/
│   │   │   ├── sidebar.tsx                  # Date grouping, folders, drawer
│   │   │   └── conversation-item.tsx        # Item menu (pin, rename, delete)
│   │   ├── model-selector/
│   │   │   └── model-selector-dialog.tsx    # Search, capabilities, provider tabs
│   │   ├── settings/
│   │   │   └── settings-dialog.tsx          # Provider setup, connection test
│   │   ├── command-palette/
│   │   │   └── command-palette.tsx          # Ctrl+K global command palette
│   │   ├── markdown/
│   │   │   ├── markdown-renderer.tsx        # GFM tables, links, blockquotes
│   │   │   └── code-block.tsx               # PrismJS syntax highlighting
│   │   └── ui/
│   │       └── toast-container.tsx          # Subtle non-intrusive toasts
│   ├── lib/
│   │   ├── ai/
│   │   │   ├── provider-interface.ts        # AIProvider interface definition
│   │   │   ├── router.ts                    # AIRouter provider dispatcher
│   │   │   ├── registry.ts                  # Model discovery & sync
│   │   │   ├── streaming/sse-parser.ts      # Robust SSE line parser
│   │   │   └── adapters/
│   │   │       ├── openai-adapter.ts        # Generic OpenAI/vLLM/Ollama adapter
│   │   │       ├── anthropic-adapter.ts     # Anthropic protocol adapter
│   │   │       └── mock-adapter.ts          # Offline development provider
│   │   ├── db/
│   │   │   ├── index.ts                     # Database connection singleton
│   │   │   ├── schema.sql                   # SQL table DDL & performance indexes
│   │   │   └── repositories/                # Typed database repositories
│   │   ├── files/file-processor.ts          # MIME checking & text extraction
│   │   └── auth.ts                          # Single-user authentication helper
│   ├── stores/
│   │   ├── chat-store.ts                    # Full chat state & streaming loop
│   │   ├── settings-store.ts                # Appearance & general settings
│   │   └── ui-store.ts                      # Modal toggles & toast queue
│   └── types/chat.ts                        # Shared TypeScript interfaces
├── scripts/
│   ├── migrate.js                           # Database migration executor
│   ├── seed.js                              # Initial database seed script
│   └── run-tests.js                         # Integration & API test runner
├── Dockerfile                               # Multi-stage production container
├── docker-compose.yml                       # Containerized deployment config
├── .env.example                             # Environment variable template
├── API.md                                   # Comprehensive API documentation
└── README.md
```

---

## 3. Database Schema

Managed via SQLite in **WAL (Write-Ahead Logging)** mode with foreign key constraints enabled:

- `users`: ID, email, name, role, timestamps.
- `sessions`: Session tokens and expiration.
- `providers`: ID, name, baseUrl, protocol, default/enabled flags.
- `provider_credentials`: Secure server-side API keys.
- `models`: Provider reference, model ID, display name, context length, JSON capability flags (`text`, `vision`, `tools`, `reasoning`), JSON pricing.
- `conversations`: Title, provider ID, model ID, pinned flag, archived flag, temporary (incognito) flag, custom system prompt, temperature, top_p, max_tokens, reasoning_effort.
- `messages`: Conversation reference, role (`user`/`assistant`/`system`), text content, thinking/reasoning content, model name, token metrics (input, output, total), latency, finish reason, JSON attachments array, JSON metadata.
- `attachments`: File metadata, original filename, MIME type, size, download URL.
- `projects`: Folders for grouping chats with folder-level system prompt instructions and preferred default models.
- `user_settings`: Theme (`dark`/`light`/`system`), compact mode, send-on-enter, code line numbers, global system prompt.

### Performance Indexes:
- `idx_conversations_user_id` on `conversations(user_id)`
- `idx_conversations_updated_at` on `conversations(updated_at DESC)`
- `idx_conversations_pinned` on `conversations(pinned, updated_at DESC)`
- `idx_messages_conversation_id` on `messages(conversation_id)`
- `idx_messages_created_at` on `messages(conversation_id, created_at ASC)`
- `idx_models_provider_id` on `models(provider_id)`

---

## 4. Provider Architecture

Every AI provider implements the unified `AIProvider` contract:

```typescript
export interface AIProvider {
  id: string;
  name: string;
  baseUrl: string;
  apiKey?: string;
  protocol: string;

  listModels(): Promise<Model[]>;
  chat(request: ChatRequest): Promise<ChatResponse>;
  streamChat(request: ChatRequest): AsyncIterable<ChatStreamChunk>;
  testConnection(): Promise<{ ok: boolean; message: string; modelCount?: number }>;

  supportsStreaming(): boolean;
  supportsVision(): boolean;
  supportsTools(): boolean;
  supportsImages(): boolean;
}
```

The `AIRouter` resolves providers dynamically based on request metadata or database configuration. Adding a new provider requires zero frontend modifications.

---

## 5. Environment Variables

Create `.env.local` or provide variables in your deployment environment:

| Variable | Description | Example |
| :--- | :--- | :--- |
| `PORT` | Listening HTTP port | `3010` |
| `DATABASE_PATH` | Path to SQLite database | `./data/chat.db` |
| `AUTH_MODE` | Authentication mode | `single-user` or `multi-user` |
| `AUTH_SECRET` | Secret token for session signing | `your-secret-key` |
| `APP_PASSWORD` | Optional password for single-user mode | `secretpassword` |
| `VPS_AI_BASE_URL` | Base URL of your VPS AI endpoint | `https://api.xkiro.com/v1` |
| `VPS_AI_API_KEY` | API key for VPS AI endpoint | `sk-xt-...` |
| `DEFAULT_PROVIDER` | Initial default provider ID | `xkiro` |
| `DEFAULT_MODEL` | Initial default model ID | `qwen/qwen3.7-plus:free` |
| `MAX_UPLOAD_SIZE` | Maximum file attachment size in bytes | `20971520` (20MB) |

---

## 6. Installation & VPS Deployment

### Direct Node.js / PM2 Deployment (Recommended for VPS)

```bash
cd /root/ai-chat

# 1. Install dependencies
npm install

# 2. Run migrations and initial database seed
npm run db:migrate
npm run db:seed

# 3. Build optimized production bundle
npm run build

# 4. Start as background service under PM2
pm2 start npm --name "ai-chat" --cwd /root/ai-chat -- start -- -p 3010
pm2 save
```

### Docker Deployment

```bash
cd /root/ai-chat
docker compose up -d --build
```

---

## 7. Connecting Your Existing VPS AI API

The platform connects to any OpenAI-compatible API running locally or remotely on your VPS (such as **vLLM**, **Ollama**, **LocalAI**, **9router**, or hosted gateways like **xKiro** and **Apmix**).

### Option A: Via Settings UI
1. Click the **Settings** gear icon in the bottom-left sidebar (or press `Ctrl + ,`).
2. Navigate to **AI Providers** tab and click **[Add Provider]**.
3. Fill in:
   - **Provider Name**: e.g., `Local vLLM`
   - **Protocol**: `OpenAI Compatible`
   - **Base URL**: e.g., `http://127.0.0.1:8000/v1`
   - **API Key**: (leave empty if unauthenticated)
4. Click **[Test Connection]**. The system queries `/models` and reports:
   - `✓ Connected successfully! Discovered X models.`
5. Click **[Save & Connect]**. Models are automatically populated in the Model Selector.

### Option B: Via Environment Variables
Set in `.env.local`:
```env
VPS_AI_BASE_URL=http://127.0.0.1:8000/v1
VPS_AI_API_KEY=your-token
VPS_AI_NAME=My Local LLM
```

---

## 8. How to Add Another Model

Models are either auto-discovered or manually registered:

1. **Auto-Discovery**:
   - Open Model Selector (click model pill at the top of chat).
   - Click the **Refresh** button next to the provider filter tabs.
   - The platform calls `GET <baseUrl>/models` and automatically updates the database.

2. **Database Script**:
   Insert directly into SQLite or update `scripts/seed.js`:
   ```sql
   INSERT INTO models (
     id, provider_id, model_id, name, display_name, description,
     context_window, capabilities, is_enabled
   ) VALUES (
     'my-provider:llama-3.3-70b', 'my-provider', 'llama-3.3-70b', 'llama-3.3-70b',
     'Llama 3.3 70B Instruct', 'Locally hosted high-performance model',
     131072, '{"text":true,"vision":false,"tools":true,"reasoning":false}', 1
   );
   ```

---

## 9. Testing & Quality Verification

Run the automated integration test suite:

```bash
npm test
```

### Verification Checklist:
- [x] Application compiles cleanly with zero TypeScript errors.
- [x] Database migrations initialize SQLite in WAL mode.
- [x] Pre-configured VPS providers (`xkiro`, `apmix`, `mock-dev`) seeded with 110+ models.
- [x] Live provider connectivity test passes (`GET /models`).
- [x] Live chat completion and SSE token streaming tested against real API.
- [x] Message sequence truncation for editing user messages verified.
- [x] Document and image uploads verified with safe file serving.
- [x] Markdown formatting, tables, and PrismJS code block syntax highlighting operational.
- [x] PM2 process supervision active on port `3010`.

---

## 10. Keyboard Shortcuts

| Shortcut | Action |
| :--- | :--- |
| `Ctrl + K` / `Cmd + K` | Open Command Palette / Search |
| `Ctrl + Shift + O` / `Cmd + Shift + O` | New Chat Session |
| `Escape` | Stop generating response |
| `Ctrl + B` | Toggle Sidebar |
| `Enter` | Send message (when Send on Enter is enabled) |
| `Shift + Enter` | New line in composer |

---

## 11. Known Limitations & Future Extensibility

- **Voice Input**: The composer includes an accessible placeholder button ready for Web Speech API integration.
- **LaTeX Math Rendering**: Can be activated by adding `remark-math` and `rehype-katex` if heavy academic math typesetting is needed.
- **Relational Backend**: The repository layer is cleanly abstracted so switching from SQLite to PostgreSQL only requires updating the query repository adapters without touching UI components.
