/**
 * RaceResults — displays ULTRAPLINIAN race rankings and scores.
 */

import * as React from 'react';
import { Trophy, Clock, CheckCircle, XCircle, Zap } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/primitives/Card';
import { Badge } from '@/components/primitives/Badge';
import { cn } from '@/lib/utils';

export interface RaceRanking {
  model: string;
  score: number;
  duration_ms: number;
  success: boolean;
  content_length: number;
}

interface RaceResultsProps {
  rankings: RaceRanking[];
  winner?: {
    model: string;
    score: number;
    duration_ms: number;
  };
  tier: string;
  modelsQueried: number;
  modelsSucceeded: number;
  totalDurationMs: number;
}

export function RaceResults({
  rankings,
  winner,
  tier,
  modelsQueried,
  modelsSucceeded,
  totalDurationMs,
}: RaceResultsProps) {
  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  const getModelShortName = (model: string) => {
    // Remove provider prefix if present
    const parts = model.split('/');
    return parts[parts.length - 1] || model;
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <Trophy className="size-4 text-warning" />
            ULTRAPLINIAN Race Results
          </CardTitle>
          <Badge tone="primary" size="sm">
            <Zap className="size-3 mr-1" />
            {tier.toUpperCase()}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Stats */}
        <div className="grid grid-cols-3 gap-3 text-center">
          <div className="p-2 rounded-lg bg-surface-2/50">
            <div className="text-lg font-bold text-primary">{modelsSucceeded}/{modelsQueried}</div>
            <div className="text-xs text-muted-foreground">Models</div>
          </div>
          <div className="p-2 rounded-lg bg-surface-2/50">
            <div className="text-lg font-bold text-primary">{formatDuration(totalDurationMs)}</div>
            <div className="text-xs text-muted-foreground">Total Time</div>
          </div>
          <div className="p-2 rounded-lg bg-surface-2/50">
            <div className="text-lg font-bold text-primary">{rankings.length}</div>
            <div className="text-xs text-muted-foreground">Rankings</div>
          </div>
        </div>

        {/* Winner */}
        {winner && (
          <div className="p-3 rounded-lg bg-warning/10 border border-warning/20">
            <div className="flex items-center gap-2 mb-1">
              <Trophy className="size-4 text-warning" />
              <span className="text-sm font-semibold text-warning">Winner</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="font-mono text-sm">{getModelShortName(winner.model)}</span>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span>Score: {winner.score}</span>
                <span>{formatDuration(winner.duration_ms)}</span>
              </div>
            </div>
          </div>
        )}

        {/* Rankings List */}
        <div className="space-y-2">
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Rankings
          </div>
          {rankings.slice(0, 10).map((ranking, idx) => (
            <div
              key={`${ranking.model}-${idx}`}
              className={cn(
                "flex items-center gap-3 p-2 rounded-lg text-sm",
                ranking.success ? "bg-surface-2/30" : "bg-surface-2/10 opacity-60"
              )}
            >
              <div className={cn(
                "flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold",
                idx === 0 ? "bg-warning text-white" : "bg-surface-3 text-muted-foreground"
              )}>
                {idx + 1}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-mono truncate">{getModelShortName(ranking.model)}</div>
              </div>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  {ranking.success ? (
                    <CheckCircle className="size-3 text-success" />
                  ) : (
                    <XCircle className="size-3 text-danger" />
                  )}
                  {ranking.score}
                </span>
                <span className="flex items-center gap-1">
                  <Clock className="size-3" />
                  {formatDuration(ranking.duration_ms)}
                </span>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
