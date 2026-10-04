'use strict';

// Copyright in the preserved implementation remains with the upstream MIT
// authors (see LICENSE). The facade adds bounded, iterative input validation;
// all parsing, expansion, compiler options and public APIs reuse upstream.js.
const braces = require('./upstream');
const MAX_DEPTH = 256;
const MAX_AST_NODES = 100000;

function assertPatternDepth(input) {
  if (typeof input !== 'string') return;
  let depth = 0;
  let bracket = false;
  let quote = null;
  for (let index = 0; index < input.length; index++) {
    const char = input[index];
    if (char === '\\') { index++; continue; }
    if (quote !== null) { if (char === quote) quote = null; continue; }
    if (bracket) { if (char === ']') bracket = false; continue; }
    if (char === '"' || char === "'" || char === '`') { quote = char; continue; }
    if (char === '[') { bracket = true; continue; }
    if (char === '{' || char === '(') {
      depth++;
      if (depth > MAX_DEPTH) throw new SyntaxError('Brace nesting exceeds the safe maximum (256)');
    } else if (char === '}' || char === ')') {
      depth = Math.max(0, depth - 1);
    }
  }
}

function assertAstDepth(input) {
  if (!input || typeof input !== 'object') return;
  const stack = [{ node: input, depth: 0, leave: false }];
  const ancestors = new Set();
  let examined = 0;
  while (stack.length > 0) {
    const { node, depth, leave } = stack.pop();
    if (!node || typeof node !== 'object') continue;
    if (leave) { ancestors.delete(node); continue; }
    if (ancestors.has(node)) throw new SyntaxError('Cyclic brace AST is not supported');
    if (depth > MAX_DEPTH) throw new SyntaxError('Brace nesting exceeds the safe maximum (256)');
    examined++;
    if (examined > MAX_AST_NODES) throw new SyntaxError('Brace AST exceeds the safe node maximum');
    ancestors.add(node);
    stack.push({ node, depth, leave: true });
    if (Array.isArray(node.nodes)) {
      for (let index = node.nodes.length - 1; index >= 0; index--) {
        stack.push({ node: node.nodes[index], depth: depth + 1, leave: false });
      }
    }
  }
}

// Preserve the same object so the upstream main/create/compile/expand closures
// call the guarded public methods rather than bypassing the facade.
for (const method of ['parse', 'stringify', 'compile', 'expand', 'create']) {
  const original = braces[method];
  braces[method] = function guardedBraceApi(input, ...args) {
    assertPatternDepth(input);
    assertAstDepth(input);
    const result = original.call(braces, input, ...args);
    if (method === 'parse') assertAstDepth(result);
    return result;
  };
}

module.exports = braces;
