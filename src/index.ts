import { AppModule } from "./app.module";
import { PURGE_SERVICE } from "./modules/maintenance/maintenance.tokens";

const application = new AppModule();

export default {
  fetch(request, env, ctx) {
    return application.app.fetch(request, env, ctx);
  },
  async scheduled(controller, env, ctx) {
    const request = new Request(`https://api.dayboard.space/__scheduled?cron=${encodeURIComponent(controller.cron)}`);
    const result = await application.createScope(env, ctx, request).resolve(PURGE_SERVICE).run(controller.scheduledTime);
    console.log(JSON.stringify({ message: "purge complete", ...result }));
  },
} satisfies ExportedHandler<Env>;
