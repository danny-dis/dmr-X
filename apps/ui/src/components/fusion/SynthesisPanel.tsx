/**
 * SynthesisPanel — displays CONSORTIUM synthesis results with all model responses.
 */

import * as React from 'react';
import { Brain, CheckCircle, XCircle, Clock, ChevronDown, ChevronUp } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/primitives/Card';
import { Badge } from '@/components/primitives/Badge';
import { Button } from '@/components/primitives/Button';
import { cn } from '@/lib/utils';

export interface ConsortiumModelResponse {
  model: string;
  score: number;
  duration_ms: number;
  success: boolean;
  content?: string;
}

/** Full CONSORTIUM API result from G0DM0D3 */
export interface ConsortiumResult {
  synthesis: string;
  orchestrator: {
    model: string;
    duration_ms: number;
  };
  collection: {
    tier: string;
    modelsQueried: number;
    modelsSucceeded: number;
    collectionDurationMs: number;
    totalDurationMs: number;
    responses: ConsortiumModelResponse[];
  };
}

interface SynthesisPanelProps {
  synthesis: string;
  orchestrator: {
    model: string;
    duration_ms: number;
  };
  collection: {
    tier: string;
    modelsQueried: number;
    modelsSucceeded: number;
    collectionDurationMs: number;
    totalDurationMs: number;
    responses: ConsortiumResponse[];
  };
}

export function SynthesisPanel({
  synthesis,
  orchestrator,
  collection,
}: SynthesisPanelProps) {
  const [showAllResponses, setShowAllResponses] = React.useState(false);
  const [expandedResponse, setExpandedResponse] = React.useState<string | null>(null);

  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  const getModelShortName = (model: string) => {
    const parts = model.split('/');
    return parts[parts.length - 1] || model;
  };

  const displayedResponses = showAllResponses
    ? collection.responses
    : collection.responses.slice(0, 5);

  return (
    <div className="space-y-4">
      {/* Synthesis Result */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2">
              <Brain className="size-4 text-purple-500" />
              CONSORTIUM Synthesis
            </CardTitle>
            <Badge tone="accent" size="sm">
              <Brain className="size-3 mr-1" />
              Ground Truth
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Orchestrator Info */}
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Orchestrator:</span>
            <span className="font-mono">{getModelShortName(orchestrator.model)}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Total Time:</span>
            <span>{formatDuration(collection.totalDurationMs)}</span>
          </div>

          {/* Synthesized Response */}
          <div className="p-4 rounded-lg bg-purple-500/5 border border-purple-500/20">
            <div className="text-xs font-medium text-purple-600 mb-2">Synthesized Response</div>
            <div className="text-sm whitespace-pre-wrap">{synthesis}</div>
          </div>
        </CardContent>
      </Card>

      {/* Collection Stats */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Collection Summary</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-4 gap-3 text-center">
            <div className="p-2 rounded-lg bg-surface-2/50">
              <div className="text-lg font-bold text-primary">{collection.modelsSucceeded}/{collection.modelsQueried}</div>
              <div className="text-xs text-muted-foreground">Models</div>
            </div>
            <div className="p-2 rounded-lg bg-surface-2/50">
              <div className="text-lg font-bold text-primary">{formatDuration(collection.collectionDurationMs)}</div>
              <div className="text-xs text-muted-foreground">Collection</div>
            </div>
            <div className="p-2 rounded-lg bg-surface-2/50">
              <div className="text-lg font-bold text-primary">{formatDuration(orchestrator.duration_ms)}</div>
              <div className="text-xs text-muted-foreground">Synthesis</div>
            </div>
            <div className="p-2 rounded-lg bg-surface-2/50">
              <div className="text-lg font-bold text-primary">{collection.tier.toUpperCase()}</div>
              <div className="text-xs text-muted-foreground">Tier</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Individual Responses */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Individual Model Responses</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {displayedResponses.map((response, idx) => (
            <div
              key={`${response.model}-${idx}`}
              className={cn(
                "rounded-lg border",
                response.success ? "bg-surface-2/30" : "bg-surface-2/10 opacity-60"
              )}
            >
              <div
                className="flex items-center gap-3 p-3 cursor-pointer"
                onClick={() => setExpandedResponse(
                  expandedResponse === response.model ? null : response.model
                )}
              >
                <div className="flex-1 min-w-0">
                  <div className="font-mono text-sm truncate">{getModelShortName(response.model)}</div>
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    {response.success ? (
                      <CheckCircle className="size-3 text-success" />
                    ) : (
                      <XCircle className="size-3 text-danger" />
                    )}
                    {response.score}
                  </span>
                  <span className="flex items-center gap-1">
                    <Clock className="size-3" />
                    {formatDuration(response.duration_ms)}
                  </span>
                  {response.content && (
                    expandedResponse === response.model ? (
                      <ChevronUp className="size-3" />
                    ) : (
                      <ChevronDown className="size-3" />
                    )
                  )}
                </div>
              </div>
              {expandedResponse === response.model && response.content && (
                <div className="px-3 pb-3 pt-0">
                  <div className="p-3 rounded bg-surface-3/50 text-sm whitespace-pre-wrap max-h-64 overflow-y-auto">
                    {response.content}
                  </div>
                </div>
              )}
            </div>
          ))}

          {collection.responses.length > 5 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowAllResponses(!showAllResponses)}
              className="w-full"
            >
              {showAllResponses ? 'Show Less' : `Show All ${collection.responses.length} Responses`}
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
