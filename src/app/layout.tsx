import type { Metadata, Viewport } from 'next';
import { Inter, Lora } from 'next/font/google';
import './globals.css';
import { ToastContainer } from '@/components/ui/toast-container';
import { ModelSelectorDialog } from '@/components/model-selector/model-selector-dialog';
import { SettingsDialog } from '@/components/settings/settings-dialog';
import { CommandPalette } from '@/components/command-palette/command-palette';

const inter = Inter({ subsets: ['latin'], variable: '--font-sans' });
const lora = Lora({ subsets: ['latin'], variable: '--font-serif' });

export const metadata: Metadata = {
  title: 'Antigravity AI · Production Assistant',
  description: 'Multi-provider, multi-model production AI chat platform for VPS environments.',
  manifest: '/manifest.json',
  icons: {
    icon: '/favicon.ico',
  },
};

export const viewport: Viewport = {
  themeColor: '#111110',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  interactiveWidget: 'resizes-content',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
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
      <body className={`${inter.variable} ${lora.variable} font-sans antialiased h-[100dvh] min-h-[100dvh] overflow-hidden bg-background text-foreground flex`}>
        {children}
        <ModelSelectorDialog />
        <SettingsDialog />
        <CommandPalette />
        <ToastContainer />
      </body>
    </html>
  );
}
