# AI Chat Platform — Internal API Documentation

All internal endpoints are accessible under `/api/*` and designed with server-side API proxying to guarantee that secret AI provider credentials never leak to the client browser.

---

## 1. Chat & Streaming Engine

### `POST /api/chat`
Initiates a conversation turn and streams tokens via Server-Sent Events (SSE).

**Request Headers:**
- `Content-Type: application/json`

**Request Body:**
```json
{
  "conversationId": "conv_1790253000_abc123", // optional; auto-creates if omitted
  "message": "Explain how WAL mode improves SQLite write concurrency.",
  "providerId": "xkiro",
  "modelId": "qwen/qwen3.7-plus:free",
  "temporary": false,
  "systemPrompt": "You are a senior systems engineer.",
  "temperature": 0.7,
  "topP": 1.0,
  "maxTokens": 4096,
  "reasoningEffort": "medium",
  "attachments": [
    {
      "id": "file_123",
      "name": "diagram.png",
      "mimeType": "image/png",
      "size": 104857,
      "url": "/api/upload?file=file_123.png",
      "dataUrl": "data:image/png;base64,..."
    }
  ]
}
```

**SSE Stream Events (`Content-Type: text/event-stream`):**
- `event: meta` — `{ "conversationId": "...", "assistantMessageId": "..." }`
- `event: reasoning` — `{ "reasoning": "Analyzing requirements..." }`
- `event: token` — `{ "content": "WAL (Write-Ahead Logging)..." }`
- `event: usage` — `{ "promptTokens": 150, "completionTokens": 380, "totalTokens": 530 }`
- `event: error` — `{ "error": "Provider connection failed" }`
- `event: done` — `{ "conversationId": "...", "finishReason": "stop", "latencyMs": 1420 }`

---

## 2. Models & Providers

### `GET /api/models`
Retrieves enabled models. Optionally triggers dynamic model auto-discovery.

**Query Parameters:**
- `providerId` (optional): Filter models by provider (e.g. `xkiro`, `apmix`)
- `refresh` (optional): If `true`, queries provider's `GET /models` endpoint live and updates the local registry.

**Response:**
```json
{
  "models": [
    {
      "id": "xkiro:qwen/qwen3.7-plus:free",
      "providerId": "xkiro",
      "modelId": "qwen/qwen3.7-plus:free",
      "displayName": "Qwen 3.7 Plus (Free)",
      "contextWindow": 1000000,
      "capabilities": {
        "text": true,
        "vision": true,
        "tools": true,
        "reasoning": true
      }
    }
  ]
}
```

### `GET /api/providers`
Returns list of configured AI providers (secrets scrubbed).

**Response:**
```json
{
  "providers": [
    {
      "id": "xkiro",
      "name": "xKiro AI (VPS)",
      "baseUrl": "https://api.xkiro.com/v1",
      "protocol": "openai-compatible",
      "isDefault": true,
      "isEnabled": true,
      "modelsCount": 110,
      "hasApiKey": true
    }
  ]
}
```

### `POST /api/providers`
Creates a new provider and automatically queries its `/models` endpoint to discover supported models.

**Request Body:**
```json
{
  "id": "local-vllm",
  "name": "Local vLLM Gateway",
  "baseUrl": "http://127.0.0.1:8000/v1",
  "protocol": "openai-compatible",
  "apiKey": "optional-token",
  "isDefault": false
}
```

### `POST /api/providers/test`
Performs a live connectivity test for an existing provider or uncommitted form data.

**Request Body:**
```json
{
  "baseUrl": "https://api.xkiro.com/v1",
  "apiKey": "sk-xt-...",
  "protocol": "openai-compatible"
}
```

**Response:**
```json
{
  "ok": true,
  "message": "Connected successfully! Discovered 110 models.",
  "modelCount": 110
}
```

---

## 3. Conversations

### `GET /api/conversations`
Lists conversations with pagination and search across titles and messages.

**Query Parameters:**
- `search`: Keyword string
- `archived`: `true` / `false`
- `pinned`: `true` / `false`
- `limit`: Number of items (default 50)
- `offset`: Pagination offset

### `POST /api/conversations`
Creates a new conversation session.

### `GET /api/conversations/:id`
Retrieves conversation details along with full message history ordered chronologically.

### `PATCH /api/conversations/:id`
Updates title, pinned status, archive status, or default model/parameters.

### `DELETE /api/conversations/:id`
Cascading delete of conversation, messages, and attachments.

### `POST /api/conversations/:id/export`
Exports a conversation as a downloadable file.

**Request Body:**
```json
{ "format": "markdown" } // or "json", "txt"
```

### `POST /api/conversations/import`
Imports a conversation from structured JSON or raw text.

---

## 4. Messages & Editing

### `POST /api/messages`
Creates a single message record.

### `DELETE /api/messages/:id`
Deletes a specific message.

### `POST /api/messages/:id/truncate`
Used during "Edit User Message" workflows. Removes all subsequent conversation turns from the database and updates the target message text.

---

## 5. File Upload & Processing

### `POST /api/upload`
Accepts `multipart/form-data` with key `file`.
- Validates file size against `MAX_UPLOAD_SIZE` (default 20MB)
- Detects image MIME types for multi-modal vision models
- Extracts text from `.txt`, `.md`, `.json`, `.csv`

### `GET /api/upload?file=<filename>`
Serves uploaded media/documents with safe basename sandboxing.
