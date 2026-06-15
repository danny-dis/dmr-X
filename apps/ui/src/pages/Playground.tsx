// Re-exports the modular PlaygroundPage implementation. The page was
// extracted from this file into `components/playground/PlaygroundPage.tsx`
// (and its sibling components) so the surface — sidebar, main, input,
// message bubble, streaming bubble, conversation item — can evolve
// independently. The lazy-loaded route in `App.tsx` still imports from
// `@/pages/Playground`, so this file remains the public entry point.
export { PlaygroundPage } from '@/components/playground/PlaygroundPage';
