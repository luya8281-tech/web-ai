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
  metadataBase: new URL('https://vee2.my.id'),
  title: 'Vee² AI · Production Assistant',
  description: 'Autonomous multi-provider production AI chat platform on vee2.my.id.',
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
    title: 'Vee² AI · Production Assistant',
    description: 'Autonomous multi-provider production AI chat platform on vee2.my.id.',
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
    title: 'Vee² AI · Production Assistant',
    description: 'Autonomous multi-provider production AI chat platform on vee2.my.id.',
    images: ['/og-image.png'],
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
