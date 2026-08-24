"use client";

import { Calendar, ExternalLink, MessageSquare, Search, User } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import LoadingSpinner from "@/components/loadingSpinner";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { api } from "@/trpc/react";
import SectionWrapper from "../sectionWrapper";

interface ConversationResult {
  id: number;
  slug: string;
  subject: string;
  customerEmail: string;
  customerName: string | null;
  snippet: string;
  createdAt: Date;
  status: string;
  matchedIn: "subject" | "message";
  similarity: number;
}

const EmailFinderSetting = () => {
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [results, setResults] = useState<ConversationResult[]>([]);
  const [aiInterpretation, setAiInterpretation] = useState("");

  const searchMutation = api.mailbox.searchConversationsWithAI.useMutation();

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;

    setIsSearching(true);
    try {
      const response = await searchMutation.mutateAsync({ query: searchQuery });
      setResults(response.results);
      setAiInterpretation(response.interpretation);
    } catch (error) {
      console.error("Search error:", error);
      setResults([]);
      setAiInterpretation("");
    } finally {
      setIsSearching(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "open":
        return "bg-green-500/10 text-green-700 dark:text-green-400";
      case "closed":
        return "bg-muted text-muted-foreground dark:text-muted-foreground";
      case "waiting_on_customer":
        return "bg-yellow-500/10 text-yellow-700 dark:text-yellow-400";
      case "spam":
        return "bg-red-500/10 text-red-700 dark:text-red-400";
      default:
        return "bg-primary/10 text-primary";
    }
  };

  const formatStatus = (status: string) => {
    return status
      .split("_")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  };

  return (
    <div className="space-y-6">
      <SectionWrapper
        title="Find Conversations with AI"
        description="Search your support conversations and messages using natural language queries. AI will understand your intent and find relevant tickets."
      >
        <div className="space-y-4">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="text"
                placeholder="e.g., 'tickets about login issues' or 'conversations from support@example.com'"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    handleSearch();
                  }
                }}
                className="pl-10"
              />
            </div>
            <Button onClick={handleSearch} disabled={isSearching || !searchQuery.trim()}>
              {isSearching ? <LoadingSpinner size="sm" /> : "Search"}
            </Button>
          </div>

          {aiInterpretation && (
            <Alert variant="default" className="text-sm">
              <div className="flex flex-col gap-1">
                <span className="font-medium">AI Understanding:</span>
                <span className="text-muted-foreground">{aiInterpretation}</span>
              </div>
            </Alert>
          )}

          {isSearching ? (
            <div className="flex items-center justify-center py-12">
              <LoadingSpinner size="lg" />
            </div>
          ) : results.length > 0 ? (
            <div className="space-y-3">
              <div className="text-sm text-muted-foreground">
                Found {results.length} {results.length === 1 ? "conversation" : "conversations"}
              </div>
              {results.map((conversation) => (
                <Link
                  key={conversation.id}
                  href={`/conversations?id=${conversation.slug}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Card className="p-4 hover:bg-accent/50 transition-colors cursor-pointer">
                    <div className="space-y-2">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <MessageSquare className="h-4 w-4 text-muted-foreground shrink-0" />
                          <h3 className="font-medium truncate">{conversation.subject || "No Subject"}</h3>
                          <ExternalLink className="h-3 w-3 text-muted-foreground shrink-0" />
                        </div>
                        <Badge className={getStatusColor(conversation.status)}>
                          {formatStatus(conversation.status)}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-3 text-sm text-muted-foreground">
                        <div className="flex items-center gap-1">
                          <User className="h-3 w-3" />
                          <span>{conversation.customerName || conversation.customerEmail}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          <span>{new Date(conversation.createdAt).toLocaleDateString()}</span>
                        </div>
                        {conversation.similarity && (
                          <Badge variant={conversation.similarity > 0.6 ? "success-light" : "gray"} className="text-xs">
                            {Math.round(conversation.similarity * 100)}% match
                          </Badge>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground line-clamp-2">{conversation.snippet}</p>
                    </div>
                  </Card>
                </Link>
              ))}
            </div>
          ) : searchQuery ? (
            <div className="text-center py-12 text-muted-foreground">
              No conversations found. Try a different search query.
            </div>
          ) : null}
        </div>
      </SectionWrapper>

      <SectionWrapper
        title="Example Queries"
        description="AI understands natural language and semantic meaning, not just keywords"
      >
        <div className="space-y-2">
          <div className="text-sm space-y-1">
            <div className="font-mono bg-accent/50 px-3 py-2 rounded">&quot;customer can't log in&quot;</div>
            <div className="font-mono bg-accent/50 px-3 py-2 rounded">&quot;issues with payment processing&quot;</div>
            <div className="font-mono bg-accent/50 px-3 py-2 rounded">&quot;how to cancel subscription&quot;</div>
            <div className="font-mono bg-accent/50 px-3 py-2 rounded">&quot;user wants refund&quot;</div>
            <div className="font-mono bg-accent/50 px-3 py-2 rounded">&quot;reset password not working&quot;</div>
          </div>
          <p className="text-xs text-muted-foreground pt-2">
            The AI uses embeddings to find conversations with similar meaning, even if they use different words.
          </p>
        </div>
      </SectionWrapper>
    </div>
  );
};

export default EmailFinderSetting;
