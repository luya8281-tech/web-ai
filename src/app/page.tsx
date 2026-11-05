'use client';

import React, { useEffect } from 'react';
import { Sidebar } from '@/components/sidebar/sidebar';
import { ChatContainer } from '@/components/chat/chat-container';
import { useChatStore } from '@/stores/chat-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useUIStore } from '@/stores/ui-store';

export default function ChatPage() {
  const { loadInitialData } = useChatStore();
  const { loadSettings } = useSettingsStore();
  const { setSidebarOpen } = useUIStore();

  useEffect(() => {
    loadSettings();
    loadInitialData();

    if (typeof window !== 'undefined' && window.innerWidth < 768) {
      setSidebarOpen(false);
    }
  }, [loadInitialData, loadSettings, setSidebarOpen]);

  return (
    <main className="flex w-full h-[100dvh] overflow-hidden">
      {/* Left Sidebar: Navigation, sessions, projects */}
      <Sidebar />

      {/* Center Chat Area (includes inline Live Web / CLI Panel & Composer) */}
      <ChatContainer />
    </main>
  );
}
