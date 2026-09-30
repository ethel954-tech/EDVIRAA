// Minimal ambient declarations for the Deno runtime so TypeScript tooling
// (VS Code's inferred project, `tsc --noEmit`) stops reporting
// "Cannot find name 'Deno'" for edge functions.
// The real, complete types come from the Deno language server /
// `deno types` when running or deploying via the Supabase CLI.

declare namespace Deno {
  function serve(
    handler: (req: Request) => Response | Promise<Response>,
    options?: { port?: number; onListen?: (info: { port: number }) => void },
  ): void;

  interface Env {
    get(key: string): string | undefined;
    set(key: string, value: string): void;
    has(key: string): boolean;
    toObject(): Record<string, string>;
  }

  const env: Env;
}

declare const SupabaseClient: unknown;
