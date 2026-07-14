/**
 * Minimal stdlib JSON-Schema validator for upstream MCP tool inputSchemas.
 *
 * ponytail: no new deps. Upstream MCP `inputSchema` is JSON Schema (draft-07
 * subset). We only need to validate what real tools actually use, so this
 * covers the common subset — enough to reject malformed args *before* they
 * hit the upstream server (MCP.md limitation #1 follow-up). It is intentionally
 * tiny; it is not a spec-complete validator.
 */

export interface SchemaValidationResult {
  valid: boolean;
  errors: string[];
}

type JSONSchema = {
  type?: string | string[];
  properties?: Record<string, JSONSchema>;
  required?: string[];
  enum?: unknown[];
  const?: unknown;
  items?: JSONSchema;
  additionalProperties?: boolean | JSONSchema;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  default?: unknown;
};

/**
 * Validate `value` against `schema`. Returns all collected errors (not just the
 * first) so the caller can report precisely what was wrong.
 */
export function validateJsonSchema(
  value: unknown,
  schema: JSONSchema | undefined | null,
): SchemaValidationResult {
  const errors: string[] = [];
  if (!schema) return { valid: true, errors }; // No schema — let upstream decide
  validateNode(value, schema, '', errors);
  return { valid: errors.length === 0, errors };
}

function typeMatches(value: unknown, type: string): boolean {
  switch (type) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && !Number.isNaN(value);
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'object':
      return typeof value === 'object' && value !== null && !Array.isArray(value);
    case 'array':
      return Array.isArray(value);
    case 'null':
      return value === null;
    default:
      return true; // unknown type keyword — accept
  }
}

function validateNode(
  value: unknown,
  schema: JSONSchema,
  path: string,
  errors: string[],
): void {
  // type
  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
  if (types.length > 0 && !types.some((t) => typeMatches(value, t))) {
    errors.push(`${path || 'value'} must be type ${types.join('|')} (got ${typeof value})`);
    return; // further checks assume the declared type
  }

  // const
  if (schema.const !== undefined && !deepEqual(value, schema.const)) {
    errors.push(`${path || 'value'} must equal ${JSON.stringify(schema.const)}`);
  }

  // enum
  if (schema.enum !== undefined && !schema.enum.some((e) => deepEqual(value, e))) {
    errors.push(`${path || 'value'} must be one of ${schema.enum.map((e) => JSON.stringify(e)).join(', ')}`);
  }

  // string constraints — checked at function top where `value` is still
  // `unknown`; inside the object branch it's already narrowed to `object`.
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      errors.push(`${path || 'value'} must be at least ${schema.minLength} chars`);
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      errors.push(`${path || 'value'} must be at most ${schema.maxLength} chars`);
    }
  }

  if (typeof value === 'object' && value !== null) {
    if (Array.isArray(value)) {
      if (schema.items) {
        value.forEach((item, i) => validateNode(item, schema.items!, `${path}[${i}]`, errors));
      }
      if (schema.minItems !== undefined && value.length < schema.minItems) {
        errors.push(`${path} must have at least ${schema.minItems} items`);
      }
      if (schema.maxItems !== undefined && value.length > schema.maxItems) {
        errors.push(`${path} must have at most ${schema.maxItems} items`);
      }
    } else {
      const obj = value as Record<string, unknown>;
      // required
      for (const req of schema.required ?? []) {
        if (!(req in obj)) errors.push(`${path ? path + '.' : ''}${req} is required`);
      }
      // properties
      if (schema.properties) {
        for (const [key, propSchema] of Object.entries(schema.properties)) {
          if (key in obj) {
            validateNode(obj[key], propSchema, `${path ? path + '.' : ''}${key}`, errors);
          }
        }
      }
      // additionalProperties
      if (schema.additionalProperties === false) {
        const allowed = new Set(Object.keys(schema.properties ?? {}));
        for (const key of Object.keys(obj)) {
          if (!allowed.has(key)) errors.push(`${path ? path + '.' : ''}${key} is not allowed`);
        }
      }
    } // end: typeof value === 'object' branch

  // numeric constraints
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) {
      errors.push(`${path} must be >= ${schema.minimum}`);
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      errors.push(`${path} must be <= ${schema.maximum}`);
    }
  }
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
} // end validateNode

