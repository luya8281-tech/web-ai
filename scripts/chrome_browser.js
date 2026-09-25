#!/usr/bin/env node
/**
 * Standalone Headless Chrome Browser Runner for Web AI Chat
 * Decoupled from Next.js webpack bundler.
 */
const { browseWeb } = require('/root/wa-bot/browser_helper.js');

async function main() {
  const url = process.argv[2];
  const takeScreenshot = process.argv[3] === 'true';

  if (!url) {
    console.log(JSON.stringify({ success: false, error: 'No URL provided' }));
    process.exit(1);
  }

  try {
    const result = await browseWeb(url, takeScreenshot);
    console.log(JSON.stringify(result));
    process.exit(0);
  } catch (err) {
    console.log(JSON.stringify({ success: false, error: err.message }));
    process.exit(1);
  }
}

main();
