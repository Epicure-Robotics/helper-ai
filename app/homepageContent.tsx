"use client";

import { ArrowLeft, ChevronRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ConversationDetails } from "@helperai/client";
import { MessageContent, useChat, useHelperClient } from "@helperai/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { getInstantGreetingReply } from "@/lib/ai/instantGreeting";
import { cn } from "@/lib/utils";
import { api } from "@/trpc/react";

const emptyConversation = (slug: string): ConversationDetails => ({
  slug,
  subject: null,
  isEscalated: false,
  messages: [],
  experimental_guideSessions: [],
});

const ChatHeader = ({ mailboxName, onBack }: { mailboxName: string; onBack: () => void }) => (
  <div className="border-b p-4">
    <div className="max-w-4xl mx-auto flex items-center gap-4">
      <Button variant="ghost" onClick={onBack}>
        <ArrowLeft className="h-4 w-4" />
      </Button>
      <h1 className="text-xl font-bold">{mailboxName} Answers</h1>
    </div>
  </div>
);

const TypingIndicator = () => (
  <div className="flex items-center gap-1">
    <div className="size-2 bg-foreground rounded-full animate-default-pulse [animation-delay:-0.3s]" />
    <div className="size-2 bg-foreground rounded-full animate-default-pulse [animation-delay:-0.15s]" />
    <div className="size-2 bg-foreground rounded-full animate-default-pulse" />
  </div>
);

const ActiveChat = ({
  mailboxName,
  conversationSlug,
  initialMessage,
  initialInstantReply,
  onBack,
}: {
  mailboxName: string;
  conversationSlug: string;
  initialMessage: string;
  initialInstantReply?: { text: string; assistantMessageId: string };
  onBack: () => void;
}) => {
  const conversation = emptyConversation(conversationSlug);
  const { messages, input, handleInputChange, handleSubmit, agentTyping, status, append, setMessages } = useChat({
    conversation,
    enableRealtime: false,
    ai: {
      onError: () => {
        setMessages((prev) => [
          ...prev,
          {
            id: `error_${Date.now()}`,
            role: "assistant" as const,
            content: "Sorry, something went wrong while generating a reply. Please try again in a moment.",
          },
        ]);
      },
    },
  });

  const openedWithMessageRef = useRef(false);
  useEffect(() => {
    const text = initialMessage.trim();
    if (!text || openedWithMessageRef.current) return;
    openedWithMessageRef.current = true;

    if (initialInstantReply) {
      const now = Date.now();
      setMessages([
        {
          id: `user_${now}`,
          role: "user",
          content: text,
          createdAt: new Date(now),
        },
        {
          id: initialInstantReply.assistantMessageId,
          role: "assistant",
          content: initialInstantReply.text,
          createdAt: new Date(now + 1),
        },
      ]);
      return;
    }

    void append({ role: "user", content: text });
  }, [append, initialInstantReply, initialMessage, setMessages]);

  return (
    <div className="min-h-screen flex flex-col">
      <ChatHeader mailboxName={mailboxName} onBack={onBack} />

      <div className="flex-1 overflow-y-auto p-4">
        <div className="max-w-4xl mx-auto">
          <div className="flex flex-col gap-4">
            {messages.map((message) => (
              <div
                className={cn(
                  "rounded-lg p-3 max-w-[80%]",
                  message.role === "user" ? "ml-auto bg-primary" : "border border-primary",
                )}
                key={message.id}
              >
                <MessageContent
                  className={cn("prose prose-sm max-w-none", {
                    "text-primary-foreground": message.role === "user",
                  })}
                  message={message}
                />
              </div>
            ))}
            {agentTyping && <div className="animate-default-pulse text-muted">An agent is typing...</div>}
            {(status === "submitted" || status === "streaming") && <TypingIndicator />}
          </div>
        </div>
      </div>

      <div className="border-t p-4">
        <div className="max-w-4xl mx-auto">
          <form onSubmit={handleSubmit} className="flex gap-2">
            <Input
              placeholder="Type your message..."
              value={input}
              onChange={handleInputChange}
              className="flex-1"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  handleSubmit(e);
                }
              }}
            />
            <Button type="submit" className="bg-orange-500 hover:bg-orange-600">
              Send
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
};

const PreparingChat = ({
  mailboxName,
  initialMessage,
  instantReplyText,
  onBack,
}: {
  mailboxName: string;
  initialMessage: string;
  instantReplyText?: string;
  onBack: () => void;
}) => (
  <div className="min-h-screen flex flex-col">
    <ChatHeader mailboxName={mailboxName} onBack={onBack} />
    <div className="flex-1 overflow-y-auto p-4">
      <div className="max-w-4xl mx-auto flex flex-col gap-4">
        {initialMessage.trim() ? (
          <div className="rounded-lg p-3 max-w-[80%] ml-auto bg-primary">
            <p className="text-sm text-primary-foreground">{initialMessage}</p>
          </div>
        ) : null}
        {instantReplyText ? (
          <div className="rounded-lg p-3 max-w-[80%] border border-primary">
            <p className="text-sm">{instantReplyText}</p>
          </div>
        ) : (
          <TypingIndicator />
        )}
      </div>
    </div>
    <div className="border-t p-4">
      <div className="max-w-4xl mx-auto">
        <Input placeholder="Type your message..." className="flex-1" disabled />
      </div>
    </div>
  </div>
);

export const HomepageContent = ({ mailboxName }: { mailboxName: string }) => {
  const [question, setQuestion] = useState("");
  const [starterMessage, setStarterMessage] = useState("");
  const [chatConversationSlug, setChatConversationSlug] = useState<string | null>(null);
  const [instantReply, setInstantReply] = useState<{ text: string; assistantMessageId: string } | null>(null);
  const [isPreparingChat, setIsPreparingChat] = useState(false);
  const {
    data: sampleQuestions,
    isLoading,
    error,
  } = api.sampleQuestions.useQuery(undefined, {
    staleTime: 6 * 60 * 60 * 1000,
    gcTime: 24 * 60 * 60 * 1000,
    retry: 2,
  });
  const { client } = useHelperClient();

  useEffect(() => {
    void client.ensureSession();
  }, [client]);

  const beginChat = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || isPreparingChat || chatConversationSlug) return;

    setStarterMessage(trimmed);
    setIsPreparingChat(true);

    const greetingReply = getInstantGreetingReply(trimmed);
    if (greetingReply) {
      setInstantReply({ text: greetingReply, assistantMessageId: `ai_${Date.now()}` });
    } else {
      setInstantReply(null);
    }

    void client.conversations
      .create({ initialMessage: trimmed })
      .then((result) => {
        setChatConversationSlug(result.conversationSlug);
        if (result.instantReply) {
          setInstantReply(result.instantReply);
        }
      })
      .catch(() => {
        setIsPreparingChat(false);
        setStarterMessage("");
        setInstantReply(null);
      })
      .finally(() => {
        setIsPreparingChat(false);
      });
  };

  const handleBackToMain = () => {
    setChatConversationSlug(null);
    setInstantReply(null);
    setIsPreparingChat(false);
    setQuestion("");
    setStarterMessage("");
  };

  if (chatConversationSlug) {
    return (
      <ActiveChat
        mailboxName={mailboxName}
        conversationSlug={chatConversationSlug}
        initialMessage={starterMessage}
        initialInstantReply={instantReply ?? undefined}
        onBack={handleBackToMain}
      />
    );
  }

  if (isPreparingChat) {
    return (
      <PreparingChat
        mailboxName={mailboxName}
        initialMessage={starterMessage}
        instantReplyText={instantReply?.text}
        onBack={handleBackToMain}
      />
    );
  }

  return (
    <div className="min-h-dvh">
      <div className="max-w-4xl mx-auto px-4 py-24">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold mb-2">{mailboxName} Answers</h1>
        </div>

        <div className="mb-12">
          <div className="relative max-w-2xl mx-auto">
            <Input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Ask a question"
              className="w-full px-6 py-4 text-lg rounded-full pr-16"
              onKeyDown={(e) => {
                if (e.key === "Enter" && question.trim()) {
                  beginChat(question);
                }
              }}
            />
            <button
              type="button"
              onClick={() => question.trim() && beginChat(question)}
              disabled={!question.trim()}
              className="absolute right-2 top-1/2 transform -translate-y-1/2 p-2 text-muted-foreground hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
            >
              <ChevronRight className="h-6 w-6" />
            </button>
          </div>
        </div>

        <div className="mb-8">
          {error ? null : isLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="flex flex-col gap-3 p-4.5 border rounded-lg">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-4 w-1/2" />
                </div>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {sampleQuestions?.map((sample, index) => (
                <button
                  key={index}
                  type="button"
                  onClick={() => beginChat(sample.text)}
                  className="p-4 border rounded-lg hover:bg-secondary text-left transition-colors"
                >
                  <span>{sample.text}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
