#!/usr/bin/env node
/**
 * Standalone Web Search Runner for Web AI Chat
 * Decoupled from Next.js webpack bundler.
 * Uses high-performance Playwright multi-engine search from wa-bot/search_helper.
 */
const { searchWeb } = require('/root/wa-bot/search_helper.js');

async function main() {
  const query = process.argv.slice(2).join(' ');

  if (!query) {
    console.log(JSON.stringify({ success: false, text: 'No query provided' }));
    process.exit(1);
  }

  try {
    const text = await searchWeb(query);
    console.log(JSON.stringify({ success: true, text }));
    process.exit(0);
  } catch (err) {
    console.log(JSON.stringify({ success: false, text: `Error: ${err.message}` }));
    process.exit(1);
  }
}

main();
