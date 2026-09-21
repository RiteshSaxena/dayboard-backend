import { AppModule } from './app.module';
import { createDatabase } from './database/database';
import { PurgeService } from './modules/maintenance/purge.service';

export default {
  fetch(request, env, ctx) {
    const app = new AppModule({ env, executionCtx: ctx, request });
    return app.app.fetch(request, env, ctx);
  },
  async scheduled(controller, env) {
    const result = await new PurgeService(createDatabase(env.DB), env.FILES).run(
      controller.scheduledTime,
    );
    console.log(JSON.stringify({ message: 'purge complete', ...result }));
  },
} satisfies ExportedHandler<Env>;
