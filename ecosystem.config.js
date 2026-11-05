// PM2 menjalankan binary Next.js LANGSUNG (bukan lewat `npm start`).
// Sebelumnya: npm -> sh -c -> next-server. PM2 hanya membunuh `npm`, sehingga
// `next-server` bisa yatim dan tetap memegang port 3010 -> EADDRINUSE saat
// restart. Dengan script di bawah, sinyal restart sampai ke proses sebenarnya.
const fs = require('fs');

// Next.js di server ini tidak selalu memuat .env.local ke process.env saat
// `next start`, jadi kunci layanan bridge dioper eksplisit lewat PM2.
function readEnv(name) {
  try {
    const text = fs.readFileSync('/root/ai-chat/.env.local', 'utf8');
    const m = text.match(new RegExp(`^${name}=(.+)$`, 'm'));
    return m ? m[1].trim() : '';
  } catch {
    return '';
  }
}

module.exports = {
  apps: [
    {
      name: 'ai-chat',
      cwd: '/root/ai-chat',
      script: 'node_modules/next/dist/bin/next',
      args: 'start -H 127.0.0.1 -p 3010',
      interpreter: 'node',
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      max_restarts: 20,
      min_uptime: '20s',
      restart_delay: 1500,
      kill_timeout: 8000,
      env: {
        NODE_ENV: 'production',
        PORT: '3010',
        NODE_OPTIONS: '--max-old-space-size=4096',
        BRIDGE_API_KEY: readEnv('BRIDGE_API_KEY'),
        BRIDGE_OWNER_ID: readEnv('BRIDGE_OWNER_ID'),
        CODEX_VERBOSITY: 'high',
      },
    },
  ],
};
