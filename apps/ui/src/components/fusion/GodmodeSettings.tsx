/**
 * GodmodeSettings — settings panel for G0DM0D3 features in Fusion Panel.
 */

import * as React from 'react';
import { Settings, Zap, Brain, Shield, Sparkles } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/primitives/Card';
import { Switch } from '@/components/primitives/Switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/primitives/Select';
import { Badge } from '@/components/primitives/Badge';

export interface GodmodeConfig {
  autotune: boolean;
  parseltongue: boolean;
  parseltongueTechnique: string;
  parseltongueIntensity: 'light' | 'medium' | 'heavy';
  stmModules: string[];
  customSystemPrompt?: string;
}

interface GodmodeSettingsProps {
  config: GodmodeConfig;
  onChange: (config: Partial<GodmodeConfig>) => void;
  disabled?: boolean;
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

export function GodmodeSettings({ config, onChange, disabled }: GodmodeSettingsProps) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <Settings className="size-4" />
            G0DM0D3 Pipeline Settings
          </CardTitle>
          <Badge tone="muted" size="sm">Optional</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* AutoTune */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Zap className="size-4 text-amber-500" />
            <div>
              <div className="text-sm font-medium">AutoTune</div>
              <div className="text-xs text-muted-foreground">Context-adaptive parameter tuning</div>
            </div>
          </div>
          <Switch
            checked={config.autotune}
            onCheckedChange={(checked) => onChange({ autotune: checked })}
            disabled={disabled}
          />
        </div>

        {/* Parseltongue */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Shield className="size-4 text-green-500" />
              <div>
                <div className="text-sm font-medium">Parseltongue</div>
                <div className="text-xs text-muted-foreground">Trigger word obfuscation</div>
              </div>
            </div>
            <Switch
              checked={config.parseltongue}
              onCheckedChange={(checked) => onChange({ parseltongue: checked })}
              disabled={disabled}
            />
          </div>
          
          {config.parseltongue && (
            <div className="ml-6 grid grid-cols-2 gap-2">
              <Select
                value={config.parseltongueTechnique}
                onValueChange={(value) => onChange({ parseltongueTechnique: value })}
                disabled={disabled}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Technique" />
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
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Intensity" />
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
            <Sparkles className="size-4 text-purple-500" />
            <div className="text-sm font-medium">STM Modules</div>
          </div>
          <div className="ml-6 space-y-2">
            {STM_MODULES.map(module => (
              <div key={module.id} className="flex items-center justify-between">
                <div className="text-xs">
                  <div className="font-medium">{module.label}</div>
                  <div className="text-muted-foreground">{module.description}</div>
                </div>
                <Switch
                  checked={config.stmModules.includes(module.id)}
                  onCheckedChange={(checked) => {
                    const newModules = checked
                      ? [...config.stmModules, module.id]
                      : config.stmModules.filter(m => m !== module.id);
                    onChange({ stmModules: newModules });
                  }}
                  disabled={disabled}
                />
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
