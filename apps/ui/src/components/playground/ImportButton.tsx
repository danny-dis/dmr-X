import * as React from 'react';
import { Paperclip } from 'lucide-react';

import { Button } from '@/components/primitives';

export interface ImportedFile {
  name: string;
  mime: string;
  /** base64 data URL (data:<mime>;base64,...) ready for inline use. */
  dataUrl: string;
  /** raw base64 (no prefix) — handy when sending to a model. */
  base64: string;
  size: number;
}

interface Props {
  onAttach: (file: ImportedFile) => void;
}

/**
 * Client-only file import: opens the OS file picker, reads the chosen file to
 * base64, and hands it back to the composer which shows it as a removable chip
 * and optionally forwards it to the model. No gateway changes needed.
 */
export function ImportButton({ onAttach }: Props) {
  const inputRef = React.useRef<HTMLInputElement>(null);

  const pick = () => inputRef.current?.click();

  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const comma = dataUrl.indexOf(',');
      const base64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
      onAttach({
        name: file.name,
        mime: file.type || 'application/octet-stream',
        dataUrl,
        base64,
        size: file.size,
      });
    };
    reader.readAsDataURL(file);
    // allow re-selecting the same file
    e.target.value = '';
  };

  return (
    <>
      <input ref={inputRef} type="file" className="hidden" onChange={onChange} />
      <Button
        type="button"
        variant="ghost"
        size="sm"
        title="Import a file from your computer"
        onClick={pick}
      >
        <Paperclip className="h-4 w-4" />
      </Button>
    </>
  );
}
