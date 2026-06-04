import * as React from 'react';
import { Send, Sparkles, RotateCcw, Save, Settings2, Mic, ArrowUpDown, ShieldAlert, ChevronDown, Volume2, } from 'lucide-react';
import { PageHeader, PageContainer } from '@/components/layout';
import { Card } from '@/components/primitives/Card';
import { Button } from '@/components/primitives/Button';
import { Input } from '@/components/primitives/Input';
import { Textarea } from '@/components/primitives/Textarea';
import { Badge } from '@/components/primitives/Badge';
import { Slider } from '@/components/primitives/Slider';
import { Switch } from '@/components/primitives/Switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/primitives/Select';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/primitives/Tabs';
import { Skeleton } from '@/components/primitives/Skeleton';
import { useApiData } from '@/hooks/useApiData';
import { Admin } from '@/lib/admin';
import { formatDuration, formatTokens } from '@/lib/formatters';
/* -------------------------------------------------------------------------- */
/*  Samples                                                                   */
/* -------------------------------------------------------------------------- */
const SAMPLES = {
    chat: [
        { label: 'Explain', prompt: 'Explain quantum entanglement in one paragraph.' },
        { label: 'Code', prompt: 'Write a TypeScript debounce function.' },
        { label: 'Haiku', prompt: 'Write a haiku about distributed systems.' },
    ],
    image: [
        { label: 'Landscape', prompt: 'A serene mountain landscape at sunset, oil painting style' },
        { label: 'Abstract', prompt: 'Abstract neural network visualization, neon colors on dark background' },
    ],
    embed: [
        { label: 'Gateway', prompt: 'DMR-X is a universal AI routing gateway.' },
    ],
    code: [
        { label: 'Debounce', prompt: 'Write a TypeScript debounce function.' },
        { label: 'Merge sort', prompt: 'Implement merge sort in Rust.' },
    ],
    tts: [
        { label: 'Greeting', prompt: 'Hello and welcome to DMR-X, the universal AI routing platform.' },
        { label: 'News', prompt: 'Breaking: Local developer builds AI router that supports 80 providers.' },
    ],
    stt: [
        { label: 'Upload audio', prompt: '' },
    ],
    rerank: [
        { label: 'Docs', prompt: 'How does the routing algorithm work?' },
    ],
    moderate: [
        { label: 'Test', prompt: 'This is a test message to check content moderation.' },
    ],
};
const DEFAULT_ADVANCED = {
    temperature: 0.7,
    maxTokens: '',
    topP: 1,
    frequencyPenalty: 0,
    presencePenalty: 0,
    stop: '',
    responseFormat: 'text',
    seed: '',
    n: 1,
    stream: true,
};
/* -------------------------------------------------------------------------- */
/*  Component                                                                 */
/* -------------------------------------------------------------------------- */
export function PlaygroundPage() {
    // --- Core state ---
    const [tab, setTab] = React.useState('chat');
    const [model, setModel] = React.useState('free');
    const [prompt, setPrompt] = React.useState(SAMPLES.chat[0].prompt);
    const [response, setResponse] = React.useState(null);
    const [loading, setLoading] = React.useState(false);
    // --- Advanced params ---
    const [advOpen, setAdvOpen] = React.useState(false);
    const [adv, setAdv] = React.useState(DEFAULT_ADVANCED);
    const updateAdv = (key, value) => setAdv((a) => ({ ...a, [key]: value }));
    // --- TTS state ---
    const [ttsVoice, setTtsVoice] = React.useState('alloy');
    const [ttsSpeed, setTtsSpeed] = React.useState(1);
    const [ttsFormat, setTtsFormat] = React.useState('mp3');
    const [audioUrl, setAudioUrl] = React.useState(null);
    // --- STT state ---
    const [sttFile, setSttFile] = React.useState(null);
    const [sttLanguage, setSttLanguage] = React.useState('');
    const [sttPrompt, setSttPrompt] = React.useState('');
    // --- Rerank state ---
    const [rerankDocs, setRerankDocs] = React.useState('');
    const [rerankTopN, setRerankTopN] = React.useState(5);
    // --- Moderate state ---
    // (uses prompt directly)
    // --- Data ---
    const models = useApiData(() => Admin.listModels(), [], { refetchInterval: 60_000 });
    // Filter models by modality for non-chat tabs
    const modelsForTab = React.useMemo(() => {
        const all = models.data ?? [];
        switch (tab) {
            case 'tts': return all.filter((m) => m.modality === 'audio_tts');
            case 'stt': return all.filter((m) => m.modality === 'audio_stt');
            case 'rerank': return all.filter((m) => m.modality === 'reranking');
            case 'moderate': return all.filter((m) => m.modality === 'llm');
            case 'image': return all.filter((m) => m.modality === 'diffusion');
            case 'embed': return all.filter((m) => m.modality === 'embedding');
            default: return all.filter((m) => m.modality === 'llm');
        }
    }, [models.data, tab]);
    // --- Reset on tab change ---
    React.useEffect(() => {
        setResponse(null);
        setAudioUrl(null);
        const samples = SAMPLES[tab] ?? SAMPLES.chat;
        if (samples.length > 0) {
            setPrompt(samples[0].prompt);
        }
        // Reset model to first matching for tab
        if (modelsForTab.length > 0) {
            setModel(modelsForTab[0].id);
        }
    }, [tab]);
    // --- Send handlers ---
    const onSendChat = async () => {
        const body = {
            model,
            messages: [{ role: 'user', content: prompt }],
        };
        // Wire advanced params
        if (adv.temperature !== 0.7)
            body.temperature = adv.temperature;
        if (adv.maxTokens)
            body.max_tokens = Number(adv.maxTokens);
        if (adv.topP !== 1)
            body.top_p = adv.topP;
        if (adv.frequencyPenalty !== 0)
            body.frequency_penalty = adv.frequencyPenalty;
        if (adv.presencePenalty !== 0)
            body.presence_penalty = adv.presencePenalty;
        if (adv.stop)
            body.stop = adv.stop.split(',').map((s) => s.trim()).filter(Boolean);
        if (adv.responseFormat !== 'text')
            body.response_format = { type: adv.responseFormat };
        if (adv.seed)
            body.seed = Number(adv.seed);
        if (adv.n !== 1)
            body.n = adv.n;
        body.stream = adv.stream;
        const res = await fetch('/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        const data = await res.json();
        const text = data.choices?.[0]?.message?.content ?? data.text ?? JSON.stringify(data, null, 2);
        return {
            text,
            meta: {
                latency: 0, // filled by caller
                tokens: data.usage?.total_tokens ?? 0,
                provider: data.provider ?? 'auto',
                cost: data.cost ?? 0,
            },
        };
    };
    const onSendImage = async () => {
        const res = await fetch('/v1/images/generations', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model, prompt, n: 1, size: '1024x1024' }),
        });
        const data = await res.json();
        const urls = (data.data ?? []).map((d) => d.url ?? (d.b64_json ? `data:image/png;base64,${d.b64_json}` : ''));
        return {
            text: urls.length > 0
                ? urls.map((u, i) => `![Generated ${i + 1}](${u})`).join('\n\n')
                : JSON.stringify(data, null, 2),
            meta: { latency: 0, tokens: 0, provider: data.provider ?? 'auto', cost: data.cost ?? 0 },
        };
    };
    const onSendEmbed = async () => {
        const res = await fetch('/v1/embeddings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model, input: prompt }),
        });
        const data = await res.json();
        const dims = data.data?.[0]?.embedding?.length ?? 0;
        const preview = data.data?.[0]?.embedding?.slice(0, 10)?.map((v) => v.toFixed(4))?.join(', ');
        return {
            text: `Embedding (${dims} dimensions)\n[${preview}...]`,
            meta: { latency: 0, tokens: data.usage?.total_tokens ?? 0, provider: data.model ?? model, cost: 0 },
        };
    };
    const onSendTTS = async () => {
        const res = await fetch('/v1/audio/speech', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model, input: prompt, voice: ttsVoice, speed: ttsSpeed, response_format: ttsFormat }),
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({ error: res.statusText }));
            return { text: `Error: ${err.error ?? res.statusText}`, meta: undefined };
        }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        setAudioUrl(url);
        const ext = ttsFormat === 'mp3' ? 'mpeg' : ttsFormat;
        return {
            text: `Audio generated (${ttsFormat}, ${ttsVoice}, ${ttsSpeed}x)\n\nListen above ↓`,
            meta: { latency: 0, tokens: 0, provider: model, cost: 0 },
        };
    };
    const onSendSTT = async () => {
        if (!sttFile)
            return { text: 'Please select an audio file.', meta: undefined };
        const formData = new FormData();
        formData.append('file', sttFile);
        formData.append('model', model);
        if (sttLanguage)
            formData.append('language', sttLanguage);
        if (sttPrompt)
            formData.append('prompt', sttPrompt);
        const res = await fetch('/v1/audio/transcriptions', {
            method: 'POST',
            body: formData,
        });
        const data = await res.json();
        return {
            text: data.text ?? JSON.stringify(data, null, 2),
            meta: { latency: 0, tokens: 0, provider: model, cost: 0 },
        };
    };
    const onSendRerank = async () => {
        const docs = rerankDocs.split('\n').map((d) => d.trim()).filter(Boolean);
        if (docs.length === 0)
            return { text: 'Please enter at least one document.', meta: undefined };
        const res = await fetch('/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model,
                messages: [{
                        role: 'user',
                        content: `Rank the following documents by relevance to the query: "${prompt}"\n\nDocuments:\n${docs.map((d, i) => `${i + 1}. ${d}`).join('\n')}\n\nReturn a JSON array of objects with "index", "relevance_score", and "summary" fields, sorted by relevance descending. Return at most ${rerankTopN} results.`,
                    }],
                response_format: { type: 'json_object' },
            }),
        });
        const data = await res.json();
        const text = data.choices?.[0]?.message?.content ?? JSON.stringify(data, null, 2);
        return {
            text,
            meta: { latency: 0, tokens: data.usage?.total_tokens ?? 0, provider: data.provider ?? model, cost: data.cost ?? 0 },
        };
    };
    const onSendModerate = async () => {
        const res = await fetch('/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: model || 'free',
                messages: [{
                        role: 'user',
                        content: `Moderate the following content. Return a JSON object with "flagged" (boolean), "categories" (object with category names and true/false), and "category_scores" (object with scores 0-1). Content: "${prompt}"`,
                    }],
                response_format: { type: 'json_object' },
            }),
        });
        const data = await res.json();
        const text = data.choices?.[0]?.message?.content ?? JSON.stringify(data, null, 2);
        return {
            text,
            meta: { latency: 0, tokens: data.usage?.total_tokens ?? 0, provider: data.provider ?? model, cost: data.cost ?? 0 },
        };
    };
    // --- Main send dispatcher ---
    const onSend = async () => {
        setLoading(true);
        setResponse(null);
        setAudioUrl(null);
        const start = performance.now();
        try {
            let result;
            switch (tab) {
                case 'image':
                    result = await onSendImage();
                    break;
                case 'embed':
                    result = await onSendEmbed();
                    break;
                case 'tts':
                    result = await onSendTTS();
                    break;
                case 'stt':
                    result = await onSendSTT();
                    break;
                case 'rerank':
                    result = await onSendRerank();
                    break;
                case 'moderate':
                    result = await onSendModerate();
                    break;
                default:
                    result = await onSendChat();
                    break;
            }
            if (result.meta)
                result.meta.latency = performance.now() - start;
            setResponse(result);
        }
        catch (e) {
            setResponse({ text: `Error: ${e.message}` });
        }
        finally {
            setLoading(false);
        }
    };
    const onReset = () => {
        setPrompt('');
        setResponse(null);
        setAudioUrl(null);
        setAdv({ ...DEFAULT_ADVANCED });
        setSttFile(null);
        setRerankDocs('');
    };
    const samples = SAMPLES[tab] ?? SAMPLES.chat;
    const canSend = tab === 'stt' ? !!sttFile : !!prompt;
    return (<PageContainer>
      <PageHeader title="Playground" description="Test any model through the router — see real-time routing decisions" icon={<Sparkles className="size-5"/>} actions={<Button variant="ghost" size="sm" onClick={onReset}>
            <RotateCcw className="size-3"/>
            Reset
          </Button>}/>

      <div className="mt-5 grid grid-cols-1 lg:grid-cols-3 gap-3">
        <Card padding="md" className="lg:col-span-2">
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList>
              <TabsTrigger value="chat">Chat</TabsTrigger>
              <TabsTrigger value="image">Image</TabsTrigger>
              <TabsTrigger value="embed">Embed</TabsTrigger>
              <TabsTrigger value="code">Code</TabsTrigger>
              <TabsTrigger value="tts"><Volume2 className="size-3 mr-1"/>TTS</TabsTrigger>
              <TabsTrigger value="stt"><Mic className="size-3 mr-1"/>STT</TabsTrigger>
              <TabsTrigger value="rerank"><ArrowUpDown className="size-3 mr-1"/>Rerank</TabsTrigger>
              <TabsTrigger value="moderate"><ShieldAlert className="size-3 mr-1"/>Moderate</TabsTrigger>
            </TabsList>

            <TabsContent value={tab} className="mt-3 flex flex-col gap-3">
              {/* ------- Model selector (all tabs) ------- */}
              {tab !== 'stt' && (<div className="grid grid-cols-3 gap-2">
                  <div className="col-span-2">
                    <label className="text-[10px] text-fg-muted mb-1 block uppercase tracking-wider">Model</label>
                    <Select value={model} onValueChange={setModel}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(tab === 'chat' || tab === 'code') && (<>
                            <SelectItem value="free">free (auto-route)</SelectItem>
                            <SelectItem value="free-fast">free-fast</SelectItem>
                            <SelectItem value="free-smart">free-smart</SelectItem>
                            <SelectItem value="free-agentic">free-agentic</SelectItem>
                            <SelectItem value="free-coding">free-coding</SelectItem>
                          </>)}
                        {modelsForTab.map((m) => (<SelectItem key={m.id} value={m.id}>
                            {m.name} <span className="text-fg-subtle ml-1">· {m.provider}</span>
                          </SelectItem>))}
                      </SelectContent>
                    </Select>
                  </div>
                  {(tab === 'chat' || tab === 'code') && (<div>
                      <label className="text-[10px] text-fg-muted mb-1 block uppercase tracking-wider">Layer</label>
                      <Select defaultValue="auto">
                        <SelectTrigger>
                          <SelectValue placeholder="auto"/>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="auto">Auto</SelectItem>
                          <SelectItem value="brain">Brain</SelectItem>
                          <SelectItem value="thinker">Thinker</SelectItem>
                          <SelectItem value="executor">Executor</SelectItem>
                          <SelectItem value="worker">Worker</SelectItem>
                          <SelectItem value="temp_worker">Temp Worker</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>)}
                </div>)}

              {/* ------- Prompt (all tabs except stt) ------- */}
              {tab !== 'stt' && (<div>
                  <label className="text-[10px] text-fg-muted mb-1 block uppercase tracking-wider">
                    {tab === 'tts' ? 'Text to speak' : tab === 'rerank' ? 'Query' : tab === 'moderate' ? 'Content to moderate' : 'Prompt'}
                  </label>
                  <Textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={tab === 'rerank' || tab === 'moderate' ? 4 : 6} placeholder={tab === 'tts' ? 'Enter text to synthesize…' :
                tab === 'rerank' ? 'Enter your search query…' :
                    tab === 'moderate' ? 'Enter content to check…' :
                        'Type your prompt…'}/>
                </div>)}

              {/* ------- STT: File upload ------- */}
              {tab === 'stt' && (<div className="flex flex-col gap-3">
                  <div>
                    <label className="text-[10px] text-fg-muted mb-1 block uppercase tracking-wider">Audio file</label>
                    <input type="file" accept="audio/*" onChange={(e) => setSttFile(e.target.files?.[0] ?? null)} className="block w-full text-sm text-fg file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-primary file:text-white hover:file:bg-primary/90 cursor-pointer"/>
                    {sttFile && (<p className="text-[10px] text-fg-muted mt-1">{sttFile.name} ({(sttFile.size / 1024).toFixed(1)} KB)</p>)}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] text-fg-muted mb-1 block uppercase tracking-wider">Language (optional)</label>
                      <Input value={sttLanguage} onChange={(e) => setSttLanguage(e.target.value)} placeholder="en"/>
                    </div>
                    <div>
                      <label className="text-[10px] text-fg-muted mb-1 block uppercase tracking-wider">Context prompt (optional)</label>
                      <Input value={sttPrompt} onChange={(e) => setSttPrompt(e.target.value)} placeholder="Technical terms…"/>
                    </div>
                  </div>
                </div>)}

              {/* ------- Rerank: Documents ------- */}
              {tab === 'rerank' && (<div className="grid grid-cols-3 gap-3">
                  <div className="col-span-2">
                    <label className="text-[10px] text-fg-muted mb-1 block uppercase tracking-wider">Documents (one per line)</label>
                    <Textarea value={rerankDocs} onChange={(e) => setRerankDocs(e.target.value)} rows={5} placeholder={"The router selects providers based on quality, cost, and latency.\nFallback chains ensure high availability.\nPolicies control access per tenant."}/>
                  </div>
                  <div>
                    <label className="text-[10px] text-fg-muted mb-1 block uppercase tracking-wider">Top N</label>
                    <Input type="number" min={1} max={20} value={rerankTopN} onChange={(e) => setRerankTopN(Number(e.target.value) || 5)}/>
                  </div>
                </div>)}

              {/* ------- TTS: Voice / Speed / Format ------- */}
              {tab === 'tts' && (<div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="text-[10px] text-fg-muted mb-1 block uppercase tracking-wider">Voice</label>
                    <Select value={ttsVoice} onValueChange={setTtsVoice}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="alloy">Alloy</SelectItem>
                        <SelectItem value="echo">Echo</SelectItem>
                        <SelectItem value="fable">Fable</SelectItem>
                        <SelectItem value="onyx">Onyx</SelectItem>
                        <SelectItem value="nova">Nova</SelectItem>
                        <SelectItem value="shimmer">Shimmer</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="text-[10px] text-fg-muted mb-1 block uppercase tracking-wider">Speed</label>
                    <div className="space-y-1">
                      <Slider value={[ttsSpeed]} min={0.25} max={4} step={0.25} onValueChange={(v) => setTtsSpeed(v[0] ?? 1)}/>
                      <p className="text-[10px] text-fg-muted text-right">{ttsSpeed}x</p>
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] text-fg-muted mb-1 block uppercase tracking-wider">Format</label>
                    <Select value={ttsFormat} onValueChange={setTtsFormat}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="mp3">MP3</SelectItem>
                        <SelectItem value="opus">Opus</SelectItem>
                        <SelectItem value="aac">AAC</SelectItem>
                        <SelectItem value="flac">FLAC</SelectItem>
                        <SelectItem value="wav">WAV</SelectItem>
                        <SelectItem value="pcm">PCM</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>)}

              {/* ------- Advanced params (chat/code only) ------- */}
              {(tab === 'chat' || tab === 'code') && (<div className="rounded-lg border border-border overflow-hidden">
                  <button type="button" onClick={() => setAdvOpen(!advOpen)} className="flex items-center justify-between w-full px-3 py-2 text-xs font-medium text-fg-muted hover:text-fg hover:bg-surface-2 transition-colors">
                    <span className="flex items-center gap-1.5">
                      <Settings2 className="size-3"/>
                      Advanced parameters
                    </span>
                    <ChevronDown className={`size-3.5 transition-transform ${advOpen ? 'rotate-180' : ''}`}/>
                  </button>
                  {advOpen && (<div className="px-3 pb-3 pt-1 grid grid-cols-2 gap-x-4 gap-y-2.5 border-t border-border bg-surface-1/50">
                      {/* Temperature */}
                      <div className="col-span-2 sm:col-span-1">
                        <div className="flex items-center justify-between mb-1">
                          <label className="text-[10px] text-fg-muted uppercase tracking-wider">Temperature</label>
                          <span className="text-[10px] text-fg font-mono">{adv.temperature}</span>
                        </div>
                        <Slider value={[adv.temperature]} min={0} max={2} step={0.1} onValueChange={(v) => updateAdv('temperature', v[0] ?? 0.7)}/>
                      </div>
                      {/* Top P */}
                      <div className="col-span-2 sm:col-span-1">
                        <div className="flex items-center justify-between mb-1">
                          <label className="text-[10px] text-fg-muted uppercase tracking-wider">Top P</label>
                          <span className="text-[10px] text-fg font-mono">{adv.topP}</span>
                        </div>
                        <Slider value={[adv.topP]} min={0} max={1} step={0.05} onValueChange={(v) => updateAdv('topP', v[0] ?? 1)}/>
                      </div>
                      {/* Max tokens */}
                      <div>
                        <label className="text-[10px] text-fg-muted mb-1 block uppercase tracking-wider">Max tokens</label>
                        <Input type="number" value={adv.maxTokens} onChange={(e) => updateAdv('maxTokens', e.target.value)} placeholder="auto"/>
                      </div>
                      {/* N */}
                      <div>
                        <label className="text-[10px] text-fg-muted mb-1 block uppercase tracking-wider">N (completions)</label>
                        <Input type="number" min={1} max={5} value={adv.n} onChange={(e) => updateAdv('n', Number(e.target.value) || 1)}/>
                      </div>
                      {/* Frequency penalty */}
                      <div>
                        <label className="text-[10px] text-fg-muted mb-1 block uppercase tracking-wider">Frequency penalty</label>
                        <Input type="number" step="0.1" min={-2} max={2} value={adv.frequencyPenalty} onChange={(e) => updateAdv('frequencyPenalty', Number(e.target.value) || 0)}/>
                      </div>
                      {/* Presence penalty */}
                      <div>
                        <label className="text-[10px] text-fg-muted mb-1 block uppercase tracking-wider">Presence penalty</label>
                        <Input type="number" step="0.1" min={-2} max={2} value={adv.presencePenalty} onChange={(e) => updateAdv('presencePenalty', Number(e.target.value) || 0)}/>
                      </div>
                      {/* Stop sequences */}
                      <div>
                        <label className="text-[10px] text-fg-muted mb-1 block uppercase tracking-wider">Stop sequences</label>
                        <Input value={adv.stop} onChange={(e) => updateAdv('stop', e.target.value)} placeholder="comma-separated"/>
                      </div>
                      {/* Seed */}
                      <div>
                        <label className="text-[10px] text-fg-muted mb-1 block uppercase tracking-wider">Seed</label>
                        <Input type="number" value={adv.seed} onChange={(e) => updateAdv('seed', e.target.value)} placeholder="random"/>
                      </div>
                      {/* Response format */}
                      <div>
                        <label className="text-[10px] text-fg-muted mb-1 block uppercase tracking-wider">Response format</label>
                        <Select value={adv.responseFormat} onValueChange={(v) => updateAdv('responseFormat', v)}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="text">Text</SelectItem>
                            <SelectItem value="json_object">JSON</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      {/* Stream */}
                      <div className="flex items-center gap-2">
                        <Switch checked={adv.stream} onCheckedChange={(v) => updateAdv('stream', v)}/>
                        <label className="text-[10px] text-fg-muted uppercase tracking-wider">Stream</label>
                      </div>
                    </div>)}
                </div>)}

              {/* ------- Footer: char count + send ------- */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-[10px] text-fg-muted">
                  {tab !== 'stt' && (<>
                      <span>{prompt.length} chars</span>
                      <span>·</span>
                      <span>~{Math.ceil(prompt.length / 4)} tokens</span>
                    </>)}
                  {tab === 'stt' && sttFile && (<span>{sttFile.name}</span>)}
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="sm">
                    <Save className="size-3"/>
                    Save preset
                  </Button>
                  <Button onClick={onSend} loading={loading} disabled={!canSend}>
                    <Send className="size-3"/>
                    Send
                  </Button>
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </Card>

        {/* ------- Samples sidebar ------- */}
        <Card padding="md">
          <h3 className="text-sm font-semibold text-fg mb-2">Samples</h3>
          <p className="text-[10px] text-fg-muted mb-3">Click to load</p>
          <div className="flex flex-col gap-1.5">
            {samples.map((s) => (<button key={s.label} onClick={() => { setPrompt(s.prompt); }} className="text-left rounded-lg border border-border bg-surface-2 px-2.5 py-2 hover:border-border-strong hover:bg-surface-3 transition-colors">
                <div className="text-xs font-medium text-fg">{s.label}</div>
                <div className="text-[10px] text-fg-muted truncate mt-0.5">
                  {s.prompt || '(upload audio)'}
                </div>
              </button>))}
          </div>
        </Card>
      </div>

      {/* ------- Response card ------- */}
      <div className="mt-3">
        <Card padding="md">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-fg">Response</h3>
            {response?.meta && (<div className="flex items-center gap-3 text-[10px]">
                <span className="text-fg-muted">
                  <span className="text-fg-subtle">latency</span>{' '}
                  <span className="text-fg font-mono">{formatDuration(response.meta.latency)}</span>
                </span>
                <span className="text-fg-muted">
                  <span className="text-fg-subtle">tokens</span>{' '}
                  <span className="text-fg font-mono">{formatTokens(response.meta.tokens)}</span>
                </span>
                <span className="text-fg-muted">
                  <span className="text-fg-subtle">cost</span>{' '}
                  <span className="text-fg font-mono">${response.meta.cost.toFixed(4)}</span>
                </span>
                <Badge tone="primary" size="sm">{response.meta.provider}</Badge>
              </div>)}
          </div>

          {/* Audio player for TTS */}
          {audioUrl && (<div className="mb-3">
              <audio controls src={audioUrl} className="w-full"/>
            </div>)}

          {loading ? (<div className="flex flex-col gap-2">
              <Skeleton className="h-3 w-3/4"/>
              <Skeleton className="h-3 w-full"/>
              <Skeleton className="h-3 w-5/6"/>
              <Skeleton className="h-3 w-2/3"/>
            </div>) : response ? (<pre className="text-sm text-fg leading-relaxed whitespace-pre-wrap font-sans">
              {response.text}
            </pre>) : (<div className="py-12 text-center text-fg-subtle text-sm">
              Send a prompt to see the response
            </div>)}
        </Card>
      </div>
    </PageContainer>);
}
//# sourceMappingURL=Playground.js.map