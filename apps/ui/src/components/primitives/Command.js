import * as React from 'react';
import { Command as CommandPrimitive } from 'cmdk';
import { Search } from 'lucide-react';
import { cn } from '@/lib/utils';
export const Command = React.forwardRef(({ className, ...props }, ref) => (<CommandPrimitive ref={ref} className={cn('flex h-full w-full flex-col overflow-hidden rounded-xl bg-surface-1 text-fg', className)} {...props}/>));
Command.displayName = 'Command';
export const CommandInput = React.forwardRef(({ className, ...props }, ref) => (<div className="flex items-center gap-2 border-b border-border px-3" cmdk-input-wrapper="">
    <Search className="size-3.5 text-fg-muted shrink-0"/>
    <CommandPrimitive.Input ref={ref} className={cn('flex h-10 w-full rounded-md bg-transparent py-3 text-xs outline-none', 'placeholder:text-fg-subtle text-fg', className)} {...props}/>
  </div>));
CommandInput.displayName = 'CommandInput';
export const CommandList = React.forwardRef(({ className, ...props }, ref) => (<CommandPrimitive.List ref={ref} className={cn('max-h-[400px] overflow-y-auto overflow-x-hidden p-1', className)} {...props}/>));
CommandList.displayName = 'CommandList';
export const CommandEmpty = React.forwardRef((props, ref) => (<CommandPrimitive.Empty ref={ref} className="py-6 text-center text-xs text-fg-muted" {...props}/>));
CommandEmpty.displayName = 'CommandEmpty';
export const CommandGroup = React.forwardRef(({ className, ...props }, ref) => (<CommandPrimitive.Group ref={ref} className={cn('overflow-hidden p-1 text-fg', '[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5', '[&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider', '[&_[cmdk-group-heading]]:text-fg-subtle', className)} {...props}/>));
CommandGroup.displayName = 'CommandGroup';
export const CommandItem = React.forwardRef(({ className, ...props }, ref) => (<CommandPrimitive.Item ref={ref} className={cn('relative flex cursor-pointer select-none items-center gap-2 rounded-md px-2 py-1.5 text-xs outline-none', 'data-[selected=true]:bg-surface-2 data-[selected=true]:text-fg', 'data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50', className)} {...props}/>));
CommandItem.displayName = 'CommandItem';
export const CommandSeparator = React.forwardRef(({ className, ...props }, ref) => (<CommandPrimitive.Separator ref={ref} className={cn('-mx-1 h-px bg-border', className)} {...props}/>));
CommandSeparator.displayName = 'CommandSeparator';
//# sourceMappingURL=Command.js.map