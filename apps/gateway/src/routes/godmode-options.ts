import type { GodmodeChatRequest } from '@dmr-x/godmode';
import { z } from 'zod';

/** Optional controls accepted by the managed GODMODE companion. */
export const GodmodeControlsSchema = z.object({
  godmode: z.boolean().optional().default(true),
  custom_system_prompt: z.string().optional(),
  autotune: z.boolean().optional().default(true),
  autotune_strategy: z.enum(['adaptive', 'precise', 'balanced', 'creative', 'chaotic']).optional(),
  parseltongue: z.boolean().optional().default(true),
  parseltongue_technique: z.enum(['leetspeak', 'unicode', 'zwj', 'mixedcase', 'phonetic', 'random']).optional(),
  parseltongue_intensity: z.enum(['light', 'medium', 'heavy']).optional(),
  stm_modules: z.array(z.enum(['hedge_reducer', 'direct_mode', 'curiosity_bias', 'casual_mode'])).optional(),
  contribute_to_dataset: z.boolean().optional().default(false),
});

export interface GodmodeRouteOptions {
  /** Registration-only: callers cannot downgrade this mode with a header/body flag. */
  godmodeOnly?: boolean;
  paths?: string[];
}

/** Build an allowlisted companion payload, never forwarding caller credentials. */
export function godmodeRequestOptions(body: Record<string, any>): Partial<GodmodeChatRequest> {
  const controls = GodmodeControlsSchema.parse(body);
  const { autotune_strategy, ...rest } = controls;
  return {
    ...rest,
    ...(autotune_strategy ? { strategy: autotune_strategy } : {}),
    ...(body.frequency_penalty !== undefined ? { frequency_penalty: body.frequency_penalty } : {}),
    ...(body.presence_penalty !== undefined ? { presence_penalty: body.presence_penalty } : {}),
  };
}
