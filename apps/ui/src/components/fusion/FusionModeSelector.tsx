/**
 * FusionModeSelector — allows selecting between Parallel, ULTRAPLINIAN, and CONSORTIUM modes.
 */

import * as React from 'react';
import { Zap, Brain, Layers } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/primitives/Select';
import { Badge } from '@/components/primitives/Badge';

export type FusionMode = 'parallel' | 'ultraplinian' | 'consortium';

interface FusionModeSelectorProps {
  value: FusionMode;
  onChange: (mode: FusionMode) => void;
  disabled?: boolean;
}

const MODES = [
  {
    value: 'parallel' as const,
    label: 'Parallel',
    icon: Layers,
    description: 'Distribute requests across slots',
  },
  {
    value: 'ultraplinian' as const,
    label: 'ULTRAPLINIAN',
    icon: Zap,
    description: 'Race models, pick the best',
  },
  {
    value: 'consortium' as const,
    label: 'CONSORTIUM',
    icon: Brain,
    description: 'Collect all, synthesize ground truth',
  },
];

export function FusionModeSelector({ value, onChange, disabled }: FusionModeSelectorProps) {
  const selectedMode = MODES.find(m => m.value === value) || MODES[0];
  const Icon = selectedMode.icon;

  return (
    <div className="flex items-center gap-3">
      <Select value={value} onValueChange={(v) => onChange(v as FusionMode)} disabled={disabled}>
        <SelectTrigger className="w-48 h-9">
          <SelectValue>
            <div className="flex items-center gap-2">
              <Icon className="size-3.5" />
              <span>{selectedMode.label}</span>
            </div>
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {MODES.map(mode => {
            const ModeIcon = mode.icon;
            return (
              <SelectItem key={mode.value} value={mode.value}>
                <div className="flex items-center gap-2">
                  <ModeIcon className="size-3.5" />
                  <div>
                    <div className="font-medium">{mode.label}</div>
                    <div className="text-xs text-muted-foreground">{mode.description}</div>
                  </div>
                </div>
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>
      
      {value === 'ultraplinian' && (
        <Badge tone="primary" size="sm">
          <Zap className="size-3 mr-1" />
          Racing
        </Badge>
      )}
      {value === 'consortium' && (
        <Badge tone="accent" size="sm">
          <Brain className="size-3 mr-1" />
          Synthesis
        </Badge>
      )}
    </div>
  );
}
