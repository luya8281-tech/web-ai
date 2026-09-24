import type { Metadata, Viewport } from 'next';
import './globals.css';
import { ToastContainer } from '@/components/ui/toast-container';
import { ModelSelectorDialog } from '@/components/model-selector/model-selector-dialog';
import { SettingsDialog } from '@/components/settings/settings-dialog';
import { CommandPalette } from '@/components/command-palette/command-palette';

export const metadata: Metadata = {
  title: 'Antigravity AI · Production Assistant',
  description: 'Multi-provider, multi-model production AI chat platform for VPS environments.',
  manifest: '/manifest.json',
  icons: {
    icon: '/favicon.ico',
  },
};

export const viewport: Viewport = {
  themeColor: '#09090b',
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
      <body className="antialiased h-[100dvh] min-h-[100dvh] overflow-hidden bg-background text-foreground flex">
        {children}
        <ModelSelectorDialog />
        <SettingsDialog />
        <CommandPalette />
        <ToastContainer />
      </body>
    </html>
  );
}
