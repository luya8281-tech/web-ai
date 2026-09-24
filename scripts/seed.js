const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, '..', 'data', 'chat.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

console.log('[Seed] Seeding database with VPS providers and initial configurations...');

const now = new Date().toISOString();

// 1. Seed Default User (Vee)
const userStmt = db.prepare(`
  INSERT INTO users (id, email, name, role, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET name = excluded.name, updated_at = excluded.updated_at
`);
userStmt.run('user_vee', 'vee@vps.local', 'Vee', 'admin', now, now);

// 2. Seed User Settings
const settingsStmt = db.prepare(`
  INSERT INTO user_settings (
    id, user_id, theme, font_size, compact_mode, send_on_enter,
    auto_title, show_timestamps, stream_responses, code_line_numbers, system_prompt, default_provider_id, default_model_id, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(user_id) DO UPDATE SET updated_at = excluded.updated_at
`);
settingsStmt.run(
  'settings_user_vee',
  'user_vee',
  'dark',
  'normal',
  0,
  1,
  1,
  1,
  1,
  1,
  'You are an expert AI assistant. Provide concise, accurate, well-structured answers with clear markdown formatting and practical code examples when requested.',
  'xkiro',
  'qwen/qwen3.7-plus:free',
  now
);

// 3. Seed Projects / Folders
const projStmt = db.prepare(`
  INSERT INTO projects (id, user_id, name, description, system_prompt, default_provider_id, default_model_id, color, icon, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO NOTHING
`);
projStmt.run(
  'proj_coding',
  'user_vee',
  'Coding & Architecture',
  'Software engineering, architecture design, and script reviews',
  'You are a senior principal engineer and systems architect. Prioritize performance, type safety, and clean code.',
  'xkiro',
  'qwen/qwen3.7-plus:free',
  '#3b82f6',
  'code',
  now,
  now
);
projStmt.run(
  'proj_research',
  'user_vee',
  'Deep Research & Notes',
  'Deep investigations, technical synthesis, and documentation',
  'You are a research scientist and technical investigator. Synthesize facts systematically.',
  'xkiro',
  'deepseek/deepseek-v4.1-flash:free',
  '#10b981',
  'book',
  now,
  now
);

// 4. Seed Providers
const provStmt = db.prepare(`
  INSERT INTO providers (id, name, base_url, protocol, is_default, is_enabled, is_system, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    name = excluded.name,
    base_url = excluded.base_url,
    protocol = excluded.protocol,
    is_default = excluded.is_default,
    updated_at = excluded.updated_at
`);

const credStmt = db.prepare(`
  INSERT INTO provider_credentials (id, provider_id, api_key, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(provider_id) DO UPDATE SET api_key = excluded.api_key, updated_at = excluded.updated_at
`);

// Provider 1: xKiro (Active VPS Endpoint)
provStmt.run(
  'xkiro',
  'xKiro AI (VPS)',
  'https://api.xkiro.com/v1',
  'openai-compatible',
  1, // default
  1,
  1,
  now,
  now
);
credStmt.run('xkiro', 'xkiro', 'sk-xt-ac072784f6eb982b9e11506867d210839388bcbf342a1dce', now, now);

// Provider 2: Apmix (Active VPS Endpoint)
provStmt.run(
  'apmix',
  'Apmix AI',
  'https://api.apmix.ai/v1',
  'openai-compatible',
  0,
  1,
  1,
  now,
  now
);
credStmt.run('apmix', 'apmix', 'apx_live_OOjl33BJxzIQk56L9xkbu4809egts4wFC9r4d8cD', now, now);

// Provider 3: Development Provider (Mock)
provStmt.run(
  'mock-dev',
  'Development Provider',
  'http://localhost/mock',
  'mock',
  0,
  1,
  1,
  now,
  now
);

// 5. Seed Models from xkiro_models.json or curated default list
const modelStmt = db.prepare(`
  INSERT INTO models (
    id, provider_id, model_id, name, display_name, description, 
    context_window, max_output_tokens, capabilities, pricing, is_default, is_enabled, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
  ON CONFLICT(provider_id, model_id) DO UPDATE SET
    display_name = excluded.display_name,
    context_window = excluded.context_window,
    max_output_tokens = excluded.max_output_tokens,
    capabilities = excluded.capabilities,
    pricing = excluded.pricing,
    updated_at = excluded.updated_at
`);

let xkiroModels = [];
const xkiroJsonPath = '/root/xkiro_models.json';
if (fs.existsSync(xkiroJsonPath)) {
  try {
    const raw = JSON.parse(fs.readFileSync(xkiroJsonPath, 'utf8'));
    xkiroModels = raw.models || raw.data || [];
  } catch (e) {
    console.warn('[Seed] Could not read /root/xkiro_models.json:', e.message);
  }
}

if (xkiroModels.length === 0) {
  // Fallback curated set
  xkiroModels = [
    { id: 'qwen/qwen3.7-plus:free', display_name: 'Qwen 3.7 Plus (Free)', context_length: 1000000, capabilities: { vision: true, tools: true, reasoning: true } },
    { id: 'deepseek/deepseek-v4.1-flash:free', display_name: 'DeepSeek V4.1 Flash (Free)', context_length: 1048576, capabilities: { vision: true, tools: true, reasoning: true } },
    { id: 'anthropic/claude-opus-4.7', display_name: 'Opus 4.7', context_length: 1000000, capabilities: { vision: true, tools: true, reasoning: true } },
    { id: 'nvidia/nemotron-3-super', display_name: 'Nemotron 3 Super', context_length: 1000000, capabilities: { vision: false, tools: true, reasoning: true } },
  ];
}

console.log(`[Seed] Upserting ${xkiroModels.length} models for xKiro...`);
for (const m of xkiroModels) {
  const modelId = m.id || m.modelId;
  if (!modelId) continue;
  const isDefault = modelId === 'qwen/qwen3.7-plus:free' ? 1 : 0;
  const caps = JSON.stringify(m.capabilities || { text: true, vision: false, tools: false, reasoning: false, images: false });
  const pricing = m.pricing ? JSON.stringify(m.pricing) : null;

  modelStmt.run(
    `xkiro:${modelId}`,
    'xkiro',
    modelId,
    modelId,
    m.display_name || modelId,
    `Hosted on xKiro VPS AI with ${((m.context_length || 128000) / 1000).toFixed(0)}K context window.`,
    m.context_length || 128000,
    m.max_output_tokens || 4096,
    caps,
    pricing,
    isDefault,
    now,
    now
  );
}

// Seed Apmix models
const apmixModels = [
  { id: 'deepseek-v4-flash-free', display_name: 'DeepSeek V4 Flash Free', context_length: 1048576, capabilities: { text: true, vision: false, tools: true, reasoning: true } },
  { id: 'gpt-6-luna-free', display_name: 'GPT 6 Luna Free', context_length: 1050000, capabilities: { text: true, vision: true, tools: true, reasoning: true } },
  { id: 'deepseek-v4.1-flash-free', display_name: 'DeepSeek V4.1 Flash Free', context_length: 1048576, capabilities: { text: true, vision: false, tools: true, reasoning: true } },
];
for (const m of apmixModels) {
  modelStmt.run(
    `apmix:${m.id}`,
    'apmix',
    m.id,
    m.id,
    m.display_name,
    'Fast multi-model provider hosted on Apmix gateway.',
    m.context_length,
    4096,
    JSON.stringify(m.capabilities),
    null,
    0,
    now,
    now
  );
}

// Seed Mock Dev models
modelStmt.run(
  'mock-dev:dev-fast-echo',
  'mock-dev',
  'dev-fast-echo',
  'dev-fast-echo',
  'Dev Fast Echo [Offline Mode]',
  'Instant mock generator for local UI development and testing.',
  128000,
  4096,
  JSON.stringify({ text: true, vision: true, tools: false, images: false, reasoning: true }),
  null,
  0,
  now,
  now
);

console.log('[Seed] ✓ Seeding complete!');
