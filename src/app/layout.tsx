import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import './globals.css';
import { ToastContainer } from '@/components/ui/toast-container';
import { ModelSelectorDialog } from '@/components/model-selector/model-selector-dialog';
import { SettingsDialog } from '@/components/settings/settings-dialog';
import { SkillsDialog } from '@/components/skills/skills-dialog';
import { ConnectorsDialog } from '@/components/connectors/connectors-dialog';
import { VaultDialog } from '@/components/vault/vault-dialog';
import { SourcesDialog } from '@/components/chat/sources-dialog';
import { CommandPalette } from '@/components/command-palette/command-palette';

// Font di-vendor lokal (src/app/fonts) supaya build tidak pernah bergantung
// pada koneksi ke fonts.googleapis.com yang kadang timeout di server ini.
// Subset latin + latin-ext; browser otomatis fallback per-glif antar file.
const inter = localFont({
  src: [
    { path: './fonts/Inter-latin.woff2', weight: '100 900', style: 'normal' },
    { path: './fonts/Inter-latin-ext.woff2', weight: '100 900', style: 'normal' },
  ],
  variable: '--font-sans',
  display: 'swap',
  fallback: ['Arial', 'system-ui', 'sans-serif'],
  adjustFontFallback: 'Arial',
});

const lora = localFont({
  src: [
    { path: './fonts/Lora-latin.woff2', weight: '400 700', style: 'normal' },
    { path: './fonts/Lora-latin-ext.woff2', weight: '400 700', style: 'normal' },
  ],
  variable: '--font-serif',
  display: 'swap',
  fallback: ['Georgia', 'serif'],
  adjustFontFallback: 'Times New Roman',
});

export const metadata: Metadata = {
  metadataBase: new URL('https://vee2.my.id'),
  title: 'Vee² AI · Editorial Technical Workspace',
  description: 'Multi-provider AI & server automation workspace on vee2.my.id.',
  manifest: '/manifest.json',
  icons: {
    icon: [
      { url: '/favicon.ico' },
      { url: '/icon.svg', type: 'image/svg+xml' },
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
    ],
    apple: [
      { url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
    ],
  },
  openGraph: {
    title: 'Vee² AI · Editorial Technical Workspace',
    description: 'Multi-provider AI & server automation workspace on vee2.my.id.',
    url: 'https://vee2.my.id',
    siteName: 'Vee² AI',
    images: [
      {
        url: '/og-image.png',
        width: 1200,
        height: 630,
        alt: 'Vee² AI Platform',
      },
    ],
    locale: 'id_ID',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Vee² AI · Editorial Technical Workspace',
    description: 'Multi-provider AI & server automation workspace on vee2.my.id.',
    images: ['/og-image.png'],
  },
};

export const viewport: Viewport = {
  themeColor: '#111110',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  interactiveWidget: 'resizes-content',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="id" className="dark">
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
                navigator.serviceWorker.getRegistrations().then(function(regs) {
                  for (var r of regs) { r.unregister(); }
                });
                if ('caches' in window) {
                  caches.keys().then(function(keys) {
                    for (var k of keys) { caches.delete(k); }
                  });
                }
              }
            `,
          }}
        />
      </head>
      <body className={`${inter.variable} ${lora.variable} font-serif antialiased h-[100dvh] min-h-[100dvh] overflow-hidden bg-background text-foreground flex`}>
        {children}
        <ModelSelectorDialog />
        <SettingsDialog />
        <SkillsDialog />
        <ConnectorsDialog />
        <VaultDialog />
        <SourcesDialog />
        <CommandPalette />
        <ToastContainer />
      </body>
    </html>
  );
}
