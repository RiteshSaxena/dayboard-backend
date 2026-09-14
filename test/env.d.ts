declare namespace Cloudflare {
  interface GlobalProps {
    mainModule: typeof import("../src/index");
  }

  interface Env {
    TEST_MIGRATIONS: { name: string; queries: string[] }[];
  }
}
