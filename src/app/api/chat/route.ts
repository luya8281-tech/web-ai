import { NextRequest } from 'next/server';
import { z } from 'zod';
import { getCurrentUser } from '@/lib/auth';
import { ConversationRepository } from '@/lib/db/repositories/conversation-repo';
import { MessageRepository } from '@/lib/db/repositories/message-repo';
import { ProviderRepository } from '@/lib/db/repositories/provider-repo';
import { ProjectRepository } from '@/lib/db/repositories/project-repo';
import { SettingsRepository } from '@/lib/db/repositories/settings-repo';
import { AIRouter } from '@/lib/ai/router';
import { ChatMessage, ChatRequest } from '@/lib/ai/provider-interface';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const ChatRequestSchema = z.object({
  conversationId: z.string().optional(),
  message: z.string(),
  providerId: z.string(),
  modelId: z.string(),
  temporary: z.boolean().optional(),
  systemPrompt: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  topP: z.number().min(0).max(1).optional(),
  maxTokens: z.number().positive().optional(),
  reasoningEffort: z.string().optional(),
  attachments: z.array(z.any()).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const user = getCurrentUser(req);
    const body = await req.json();
    const parsed = ChatRequestSchema.safeParse(body);

    if (!parsed.success) {
      return new Response(JSON.stringify({ error: 'Invalid request', details: parsed.error.format() }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const {
      conversationId: incomingConvId,
      message: userContent,
      providerId,
      modelId,
      temporary = false,
      temperature,
      topP,
      maxTokens,
      reasoningEffort,
      attachments = [],
    } = parsed.data;

    let convId = incomingConvId;
    let conversation = convId ? ConversationRepository.getConversation(convId) : null;

    // Auto-create conversation if new
    if (!conversation) {
      convId = `conv_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
      // Generate clean initial title from first 40 chars of message
      const initialTitle = userContent.trim().split('\n')[0].substring(0, 45) || 'New Chat';
      conversation = ConversationRepository.createConversation({
        id: convId,
        userId: user.id,
        title: initialTitle,
        providerId,
        modelId,
        temporary,
        temperature,
        topP,
        maxTokens,
        reasoningEffort,
      });
    }

    // Determine System Prompt Hierarchy:
    // Priority: conversation.systemPrompt > project.systemPrompt > userSettings.systemPrompt
    let effectiveSystemPrompt = parsed.data.systemPrompt || conversation.systemPrompt || '';
    if (!effectiveSystemPrompt && conversation.projectId) {
      const project = ProjectRepository.getProject(conversation.projectId);
      if (project?.systemPrompt) {
        effectiveSystemPrompt = project.systemPrompt;
      }
    }
    if (!effectiveSystemPrompt) {
      const settings = SettingsRepository.getUserSettings(user.id);
      if (settings?.systemPrompt) {
        effectiveSystemPrompt = settings.systemPrompt;
      }
    }

    // Save user message to database if not temporary
    const userMsgId = `msg_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    if (!temporary) {
      MessageRepository.createMessage({
        id: userMsgId,
        conversationId: convId!,
        role: 'user',
        content: userContent,
        attachments,
      });
    }

    // Load recent message history for context
    const history = temporary ? [] : MessageRepository.listMessages(convId!);
    const chatMessages: ChatMessage[] = history.map(m => {
      const images: string[] = [];
      if (m.attachments) {
        for (const att of m.attachments) {
          if (att.dataUrl) images.push(att.dataUrl);
          else if (att.url && (att.mimeType?.startsWith('image/') || att.url.match(/\.(png|jpg|jpeg|webp)$/i))) {
            images.push(att.url);
          }
        }
      }
      return {
        role: m.role as any,
        content: m.content,
        images: images.length > 0 ? images : undefined,
      };
    });

    // If temporary and history was empty, add the user message
    if (temporary && chatMessages.length === 0) {
      chatMessages.push({
        role: 'user',
        content: userContent,
      });
    }

    // Create assistant placeholder message record
    const assistantMsgId = `msg_${Date.now() + 1}_${Math.random().toString(36).substring(2, 8)}`;
    const startTime = Date.now();

    const chatRequest: ChatRequest = {
      model: modelId,
      messages: chatMessages,
      systemPrompt: effectiveSystemPrompt || undefined,
      temperature: temperature ?? conversation.temperature ?? 0.7,
      topP: topP ?? conversation.topP ?? 1.0,
      maxTokens: maxTokens ?? conversation.maxTokens ?? undefined,
      reasoningEffort: reasoningEffort ?? conversation.reasoningEffort ?? undefined,
      stream: true,
      abortSignal: req.signal,
    };

    // Prepare SSE Response Stream
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        let fullAssistantContent = '';
        let fullReasoningContent = '';
        let finishReason = 'stop';
        let tokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

        // Helper to push SSE event
        const sendEvent = (event: string, data: any) => {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        };

        // Notify client of metadata
        sendEvent('meta', {
          conversationId: convId,
          userMessageId: userMsgId,
          assistantMessageId: assistantMsgId,
          model: modelId,
          provider: providerId,
        });

        try {
          const aiStream = AIRouter.streamChat(providerId, chatRequest);

          for await (const chunk of aiStream) {
            if (req.signal.aborted) {
              finishReason = 'aborted';
              break;
            }

            if (chunk.type === 'token' && chunk.content) {
              fullAssistantContent += chunk.content;
              sendEvent('token', { content: chunk.content });
            } else if (chunk.type === 'reasoning' && chunk.reasoning) {
              fullReasoningContent += chunk.reasoning;
              sendEvent('reasoning', { reasoning: chunk.reasoning });
            } else if (chunk.type === 'usage' && chunk.usage) {
              tokenUsage = chunk.usage;
              sendEvent('usage', chunk.usage);
            } else if (chunk.type === 'error') {
              sendEvent('error', { error: chunk.error });
            } else if (chunk.type === 'done') {
              // Done
            }
          }
        } catch (streamErr: any) {
          console.error('[SSE Stream Error]', streamErr);
          sendEvent('error', { error: streamErr.message || 'Stream connection error' });
          finishReason = 'error';
        } finally {
          const latencyMs = Date.now() - startTime;

          // Save partial or complete assistant response into database if not temporary
          if (!temporary && (fullAssistantContent.trim().length > 0 || fullReasoningContent.trim().length > 0)) {
            try {
              MessageRepository.createMessage({
                id: assistantMsgId,
                conversationId: convId!,
                role: 'assistant',
                content: fullAssistantContent,
                reasoningContent: fullReasoningContent || null,
                model: modelId,
                provider: providerId,
                tokenInput: tokenUsage.promptTokens,
                tokenOutput: tokenUsage.completionTokens,
                latencyMs,
                finishReason,
                metadata: {
                  totalTokens: tokenUsage.totalTokens,
                  interrupted: req.signal.aborted,
                },
              });
            } catch (dbErr) {
              console.error('[Failed saving assistant message]', dbErr);
            }
          }

          sendEvent('done', {
            conversationId: convId,
            messageId: assistantMsgId,
            finishReason,
            latencyMs,
          });

          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no', // Disable Nginx reverse proxy buffering (Section 61)
      },
    });
  } catch (err: any) {
    console.error('[Chat API Error]', err);
    return new Response(JSON.stringify({ error: err.message || 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
