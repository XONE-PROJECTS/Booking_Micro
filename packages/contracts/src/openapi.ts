import { z } from 'zod';
import { envelope, errorEnvelope } from './common';

export type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';
export type AuthRequirement = 'none' | 'user' | 'apiKey' | 'userOrApiKey' | 'integrationToken';

export interface RouteDoc {
  method: HttpMethod;
  /** Express-style path relative to the API prefix, for example "/bookings/:id". */
  path: string;
  summary: string;
  tags: string[];
  auth: AuthRequirement;
  permission?: string;
  params?: z.ZodType;
  query?: z.ZodType;
  body?: z.ZodType;
  response?: z.ZodType;
  status?: number;
  idempotent?: boolean;
  description?: string;
}

type JsonSchema = Record<string, unknown>;

function toSchema(schema: z.ZodType, io: 'input' | 'output'): JsonSchema {
  const s = z.toJSONSchema(schema, { io, unrepresentable: 'any', target: 'draft-2020-12' }) as JsonSchema;
  delete s.$schema;
  return s;
}

function parameters(schema: z.ZodType | undefined, location: 'path' | 'query') {
  if (!schema) return [];
  const json = toSchema(schema, 'input') as { properties?: Record<string, JsonSchema>; required?: string[] };
  return Object.entries(json.properties ?? {}).map(([name, s]) => ({
    name,
    in: location,
    required: location === 'path' || (json.required ?? []).includes(name),
    description: typeof s.description === 'string' ? s.description : undefined,
    schema: s,
  }));
}

const toOpenApiPath = (p: string) => p.replace(/:([A-Za-z0-9_]+)/g, '{$1}');

const security: Record<AuthRequirement, unknown[] | undefined> = {
  none: [],
  user: [{ bearerAuth: [] }],
  apiKey: [{ apiKey: [] }],
  userOrApiKey: [{ bearerAuth: [] }, { apiKey: [] }],
  integrationToken: [{ bearerAuth: [] }],
};

export class OpenApiRegistry {
  readonly routes: RouteDoc[] = [];

  add(doc: RouteDoc): void {
    this.routes.push(doc);
  }

  document(info: { title: string; version: string; description?: string; serverUrl: string }): Record<string, unknown> {
    const paths: Record<string, Record<string, unknown>> = {};
    for (const r of this.routes) {
      const p = toOpenApiPath(r.path);
      const status = String(r.status ?? (r.method === 'post' ? 201 : 200));
      const op: Record<string, unknown> = {
        summary: r.summary,
        description: [r.description, r.permission ? `Requires permission \`${r.permission}\`.` : undefined].filter(Boolean).join('\n\n') || undefined,
        tags: r.tags,
        operationId: `${r.method}${p.replace(/[{}]/g, '').replace(/[^A-Za-z0-9]+(.)?/g, (_, c: string | undefined) => (c ? c.toUpperCase() : ''))}`,
        security: security[r.auth],
        parameters: [
          ...parameters(r.params, 'path'),
          ...parameters(r.query, 'query'),
          ...(r.idempotent ? [{ name: 'Idempotency-Key', in: 'header', required: true, schema: { type: 'string', maxLength: 200 } }] : []),
        ],
        responses: {
          [status]: status === '204' ? { description: 'No content' } : { description: 'Success', content: { 'application/json': { schema: toSchema(envelope(r.response ?? z.unknown()), 'output') } } },
          default: { description: 'Error', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      };
      if (r.body) op.requestBody = { required: true, content: { 'application/json': { schema: toSchema(r.body, 'input') } } };
      paths[p] = { ...(paths[p] ?? {}), [r.method]: op };
    }
    return {
      openapi: '3.1.0',
      info: { title: info.title, version: info.version, description: info.description },
      servers: [{ url: info.serverUrl }],
      paths,
      components: {
        securitySchemes: {
          bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
          apiKey: { type: 'apiKey', in: 'header', name: 'X-API-Key' },
        },
        schemas: { Error: toSchema(errorEnvelope, 'output') },
      },
    };
  }
}
