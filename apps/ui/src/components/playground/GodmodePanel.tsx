/**
 * GodmodePanel — settings panel for G0DM0D3 features in Playground.
 */

import * as React from 'react';
import { Settings, Zap, Brain, Shield, Sparkles, ChevronDown, ChevronUp } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/primitives/Card';
import { Switch } from '@/components/primitives/Switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/primitives/Select';
import { Button } from '@/components/primitives/Button';
import { cn } from '@/lib/utils';

export interface GodmodeConfig {
  autotune: boolean;
  parseltongue: boolean;
  parseltongueTechnique: string;
  parseltongueIntensity: 'light' | 'medium' | 'heavy';
  stmModules: string[];
  customSystemPrompt?: string;
}

interface GodmodePanelProps {
  config: GodmodeConfig;
  onChange: (config: Partial<GodmodeConfig>) => void;
  disabled?: boolean;
  collapsed?: boolean;
}

const STM_MODULES = [
  { id: 'hedge_reducer', label: 'Hedge Reducer', description: 'Removes "I think", "maybe", "perhaps"' },
  { id: 'direct_mode', label: 'Direct Mode', description: 'Removes preambles and filler phrases' },
  { id: 'curiosity_bias', label: 'Curiosity Bias', description: 'Adds exploration prompts' },
  { id: 'casual_mode', label: 'Casual Mode', description: 'Makes tone more casual' },
];

const PARSELTONGUE_TECHNIQUES = [
  { value: 'leetspeak', label: 'Leetspeak' },
  { value: 'unicode', label: 'Unicode' },
  { value: 'zwj', label: 'ZWJ' },
  { value: 'mixedcase', label: 'Mixed Case' },
  { value: 'phonetic', label: 'Phonetic' },
  { value: 'random', label: 'Random' },
];

export function GodmodePanel({ config, onChange, disabled, collapsed = false }: GodmodePanelProps) {
  const [isCollapsed, setIsCollapsed] = React.useState(collapsed);

  const activeCount = [
    config.autotune,
    config.parseltongue,
    config.stmModules.length > 0,
  ].filter(Boolean).length;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Settings className="size-4 text-primary" />
            <CardTitle className="text-sm">G0DM0D3 Pipeline</CardTitle>
            {activeCount > 0 && (
              <span className="text-xs text-muted-foreground">({activeCount} active)</span>
            )}
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setIsCollapsed(!isCollapsed)}
          >
            {isCollapsed ? <ChevronDown className="size-4" /> : <ChevronUp className="size-4" />}
          </Button>
        </div>
      </CardHeader>
      
      {!isCollapsed && (
        <CardContent className="space-y-3 pt-2">
          {/* AutoTune */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Zap className="size-3.5 text-warning" />
              <div className="text-xs">
                <div className="font-medium">AutoTune</div>
                <div className="text-muted-foreground">Adaptive parameters</div>
              </div>
            </div>
            <Switch
              checked={config.autotune}
              onCheckedChange={(checked) => onChange({ autotune: checked })}
              disabled={disabled}
            />
          </div>

          {/* Parseltongue */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Shield className="size-3.5 text-success" />
                <div className="text-xs">
                  <div className="font-medium">Parseltongue</div>
                  <div className="text-muted-foreground">Obfuscation</div>
                </div>
              </div>
              <Switch
                checked={config.parseltongue}
                onCheckedChange={(checked) => onChange({ parseltongue: checked })}
                disabled={disabled}
              />
            </div>
            
            {config.parseltongue && (
              <div className="ml-5 grid grid-cols-2 gap-2">
                <Select
                  value={config.parseltongueTechnique}
                  onValueChange={(value) => onChange({ parseltongueTechnique: value })}
                  disabled={disabled}
                >
                  <SelectTrigger className="h-7 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PARSELTONGUE_TECHNIQUES.map(tech => (
                      <SelectItem key={tech.value} value={tech.value}>
                        {tech.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                
                <Select
                  value={config.parseltongueIntensity}
                  onValueChange={(value) => onChange({ parseltongueIntensity: value as any })}
                  disabled={disabled}
                >
                  <SelectTrigger className="h-7 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="light">Light</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="heavy">Heavy</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          {/* STM Modules */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Sparkles className="size-3.5 text-purple-500" />
              <div className="text-xs font-medium">STM Modules</div>
            </div>
            <div className="ml-5 flex flex-wrap gap-1.5">
              {STM_MODULES.map(module => (
                <button
                  key={module.id}
                  onClick={() => {
                    const newModules = config.stmModules.includes(module.id)
                      ? config.stmModules.filter(m => m !== module.id)
                      : [...config.stmModules, module.id];
                    onChange({ stmModules: newModules });
                  }}
                  disabled={disabled}
                  className={cn(
                    "px-2 py-1 text-xs rounded-md border transition-colors",
                    config.stmModules.includes(module.id)
                      ? "bg-primary/10 border-primary/30 text-primary"
                      : "bg-surface-2/50 border-border text-muted-foreground hover:bg-surface-3/50"
                  )}
                >
                  {module.label}
                </button>
              ))}
            </div>
          </div>

          {/* Custom System Prompt */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Brain className="size-3.5 text-blue-500" />
              <div className="text-xs font-medium">Custom System Prompt</div>
            </div>
            <textarea
              value={config.customSystemPrompt || ''}
              onChange={(e) => onChange({ customSystemPrompt: e.target.value || undefined })}
              placeholder="Override GODMODE prompt (optional)"
              disabled={disabled}
              className="ml-5 w-full h-20 px-2 py-1.5 text-xs rounded-md border bg-surface-2/50 border-border resize-none focus:outline-none focus:ring-1 focus:ring-primary/30 disabled:opacity-50"
            />
          </div>
        </CardContent>
      )}
    </Card>
  );
}
