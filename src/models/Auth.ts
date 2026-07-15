export type AuthConfig =
  | { type: 'none' }
  | { type: 'bearer'; configured: true }
  | { type: 'basic'; configured: true }
  | { type: 'apiKey'; name: string; in: 'header' | 'query'; configured: true };

export type PersistedAuthConfig =
  | { type: 'none' }
  | { type: 'bearer'; secretRef: string }
  | { type: 'basic'; secretRef: string }
  | { type: 'apiKey'; name: string; in: 'header' | 'query'; secretRef: string };

export type AuthInput =
  | { type: 'none' }
  | { type: 'bearer'; token: string }
  | { type: 'basic'; username: string; password: string }
  | { type: 'apiKey'; name: string; in: 'header' | 'query'; value: string };

export function toPublicAuth(config: PersistedAuthConfig): AuthConfig {
  switch (config.type) {
    case 'none':
      return { type: 'none' };
    case 'bearer':
      return { type: 'bearer', configured: true };
    case 'basic':
      return { type: 'basic', configured: true };
    case 'apiKey':
      return { type: 'apiKey', name: config.name, in: config.in, configured: true };
  }
}
