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

    // On mobile devices, ensure the sidebar drawer starts closed so user directly sees the chat
    if (typeof window !== 'undefined' && window.innerWidth < 768) {
      setSidebarOpen(false);
    }
  }, [loadInitialData, loadSettings, setSidebarOpen]);

  return (
    <main className="flex w-full h-[100dvh] overflow-hidden">
      {/* Sidebar: Navigation, sessions, projects */}
      <Sidebar />

      {/* Main Chat Area */}
      <ChatContainer />
    </main>
  );
}
