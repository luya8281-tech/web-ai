'use client';

import React, { useEffect } from 'react';
import { Sidebar } from '@/components/sidebar/sidebar';
import { ChatContainer } from '@/components/chat/chat-container';
import { useChatStore } from '@/stores/chat-store';
import { useSettingsStore } from '@/stores/settings-store';

export default function ChatPage() {
  const { loadInitialData } = useChatStore();
  const { loadSettings } = useSettingsStore();

  useEffect(() => {
    loadSettings();
    loadInitialData();
  }, [loadInitialData, loadSettings]);

  return (
    <main className="flex w-full h-full overflow-hidden">
      {/* Sidebar: Navigation, sessions, projects */}
      <Sidebar />

      {/* Main Chat Area */}
      <ChatContainer />
    </main>
  );
}
