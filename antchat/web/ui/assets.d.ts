// Bun supports `import x from './foo.html' with { type: 'text' }` to embed a
// file's contents as a string at compile time. tsc doesn't know about that
// loader, so we declare the module shapes here for the bundler import path.
declare module '*.html' { const content: string; export default content; }
declare module '*.css'  { const content: string; export default content; }
declare module '*.js?text' { const content: string; export default content; }
