import {z} from 'zod';

export const kindSchema=z.enum(['account','proxy','group','lead','settings']);
export type WorkspaceKind=z.infer<typeof kindSchema>;

const short=z.string().trim().min(1).max(200);

export const settingsSchema=z.object({
  name:short,
  product:z.string().max(8000),
  keywords:z.string().max(2000),
  model:short,
});

export const accountSchema=z.object({
  name:short,
  phone:z.string().regex(/^\+[1-9]\d{7,14}$/),
  proxyId:z.string().max(100).default(''),
});

export const proxySchema=z.object({
  name:short,
  host:z.string().trim().regex(/^[a-zA-Z0-9.-]+$/).max(253),
  port:z.coerce.number().int().min(1).max(65535),
  protocol:z.enum(['socks5','http']),
  username:z.string().max(200).default(''),
});

export const groupSchema=z.object({
  name:short,
  url:z.string().trim().regex(/^(?:https:\/\/t\.me\/(?:\+|joinchat\/)?[a-zA-Z0-9_-]+|@[a-zA-Z0-9_]{5,32})$/),
  accountId:z.string().max(100).default(''),
});

export const leadSchema=z.object({
  name:short,
  message:z.string().trim().min(3).max(8000),
  source:z.string().max(200).default('Вручную'),
  status:z.enum(['new','working','archived']).default('new'),
  draft:z.string().max(10000).default(''),
});

export const schemas={
  account:accountSchema,
  proxy:proxySchema,
  group:groupSchema,
  lead:leadSchema,
  settings:settingsSchema,
} as const;
