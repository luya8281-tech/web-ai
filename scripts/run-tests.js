const assert = require('assert');
const path = require('path');

process.env.DATABASE_PATH = path.join(__dirname, '..', 'data', 'chat.db');

async function runTests() {
  console.log('==================================================');
  console.log('RUNNING PRODUCTION INTEGRATION TESTS');
  console.log('==================================================\n');

  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
    process.stdout.write(`• ${name}... `);
    try {
      await fn();
      console.log('✓ PASS');
      passed++;
    } catch (err) {
      console.log(`✕ FAIL: ${err.message}`);
      console.error(err.stack);
      failed++;
    }
  }

  // 1. Database Connection & Schema Test
  await test('Database initialization and WAL mode', async () => {
    const Database = require('better-sqlite3');
    const db = new Database(process.env.DATABASE_PATH);
    const pragma = db.pragma('journal_mode');
    assert.strictEqual(pragma[0].journal_mode, 'wal', 'Database should be in WAL mode');
    db.close();
  });

  // 2. Providers and Model Registry Test
  await test('Provider repository lists seeded VPS providers', async () => {
    const Database = require('better-sqlite3');
    const db = new Database(process.env.DATABASE_PATH);
    const providers = db.prepare('SELECT * FROM providers').all();
    assert.ok(providers.length >= 2, 'Should have at least 2 seeded providers');
    const xkiro = providers.find(p => p.id === 'xkiro');
    assert.ok(xkiro, 'xKiro provider must exist');
    assert.strictEqual(xkiro.base_url, 'https://api.xkiro.com/v1');

    const models = db.prepare('SELECT * FROM models WHERE provider_id = ?').all('xkiro');
    assert.ok(models.length > 5, 'xKiro should have registered models');
    db.close();
  });

  // 3. Conversation CRUD Test
  await test('Conversation CRUD and persistence', async () => {
    const Database = require('better-sqlite3');
    const db = new Database(process.env.DATABASE_PATH);

    const testId = `test_conv_${Date.now()}`;
    const now = new Date().toISOString();

    // Create
    db.prepare(`
      INSERT INTO conversations (id, user_id, title, provider_id, model_id, created_at, updated_at)
      VALUES (?, 'user_vee', 'Test Automated Conv', 'xkiro', 'qwen/qwen3.7-plus:free', ?, ?)
    `).run(testId, now, now);

    const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(testId);
    assert.ok(conv, 'Conversation should be inserted');
    assert.strictEqual(conv.title, 'Test Automated Conv');

    // Update / Pin
    db.prepare('UPDATE conversations SET pinned = 1 WHERE id = ?').run(testId);
    const updated = db.prepare('SELECT * FROM conversations WHERE id = ?').get(testId);
    assert.strictEqual(updated.pinned, 1);

    // Clean up
    db.prepare('DELETE FROM conversations WHERE id = ?').run(testId);
    assert.strictEqual(db.prepare('SELECT * FROM conversations WHERE id = ?').get(testId), undefined);
    db.close();
  });

  // 4. Message Truncation for Message Editing Test (Section 25)
  await test('Message sequence truncation when editing user message', async () => {
    const Database = require('better-sqlite3');
    const db = new Database(process.env.DATABASE_PATH);

    const convId = `test_conv_edit_${Date.now()}`;
    const now = new Date();
    const t1 = new Date(now.getTime() + 100).toISOString();
    const t2 = new Date(now.getTime() + 200).toISOString();
    const t3 = new Date(now.getTime() + 300).toISOString();

    // Insert conversation
    db.prepare(`
      INSERT INTO conversations (id, user_id, title, provider_id, model_id, created_at, updated_at)
      VALUES (?, 'user_vee', 'Edit Test', 'xkiro', 'qwen/qwen3.7-plus:free', ?, ?)
    `).run(convId, t1, t1);

    // Insert 3 messages: User1, Assistant1, User2
    const m1Id = `m1_${Date.now()}`;
    const m2Id = `m2_${Date.now()}`;
    const m3Id = `m3_${Date.now()}`;

    db.prepare(`INSERT INTO messages (id, conversation_id, role, content, created_at, updated_at) VALUES (?, ?, 'user', 'Prompt 1', ?, ?)`).run(m1Id, convId, t1, t1);
    db.prepare(`INSERT INTO messages (id, conversation_id, role, content, created_at, updated_at) VALUES (?, ?, 'assistant', 'Reply 1', ?, ?)`).run(m2Id, convId, t2, t2);
    db.prepare(`INSERT INTO messages (id, conversation_id, role, content, created_at, updated_at) VALUES (?, ?, 'user', 'Prompt 2', ?, ?)`).run(m3Id, convId, t3, t3);

    // User edits m1: truncate all messages with created_at > m1.created_at
    const m1 = db.prepare('SELECT * FROM messages WHERE id = ?').get(m1Id);
    const delResult = db.prepare('DELETE FROM messages WHERE conversation_id = ? AND created_at > ?').run(convId, m1.created_at);

    assert.strictEqual(delResult.changes, 2, 'Should delete 2 following messages');
    const remaining = db.prepare('SELECT * FROM messages WHERE conversation_id = ?').all(convId);
    assert.strictEqual(remaining.length, 1);
    assert.strictEqual(remaining[0].id, m1Id);

    // Clean up
    db.prepare('DELETE FROM conversations WHERE id = ?').run(convId);
    db.close();
  });

  // 5. Real Provider Connection Test
  await test('Real VPS AI provider connectivity (xKiro endpoint)', async () => {
    const res = await fetch('https://api.xkiro.com/v1/models', {
      method: 'GET',
      headers: {
        'Authorization': 'Bearer sk-xt-ac072784f6eb982b9e11506867d210839388bcbf342a1dce',
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(10000),
    });

    assert.strictEqual(res.status, 200, 'xKiro /models should return 200 OK');
    const data = await res.json();
    const list = data.data || data.models || [];
    assert.ok(list.length > 0, 'xKiro should return list of models');
  });

  // 6. Real Chat Completion Test
  await test('Real chat completion via xKiro API', async () => {
    const res = await fetch('https://api.xkiro.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer sk-xt-ac072784f6eb982b9e11506867d210839388bcbf342a1dce',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'qwen/qwen3.7-plus:free',
        messages: [{ role: 'user', content: 'Ping' }],
        max_tokens: 5,
      }),
      signal: AbortSignal.timeout(10000),
    });

    assert.strictEqual(res.status, 200, 'xKiro completion should succeed with status 200');
    const json = await res.json();
    assert.ok(json.choices && json.choices.length > 0, 'Should return choices array');
    assert.ok(json.choices[0].message.content.length > 0, 'Should return text response');
  });

  console.log(`\n==================================================`);
  console.log(`TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('==================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests();
