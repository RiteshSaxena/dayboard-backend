import type { Hono } from 'hono';
import type { AppBindings } from '../../core/http/app-bindings';
import { parseJson, requireActor } from '../../core/http/request';
import { updatePreferencesSchema } from './notification.schemas';
import type { NotificationService } from './notification.service';

export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  mount(app: Hono<AppBindings>): void {
    app.get('/api/me/notifications', async (c) => {
      const actor = requireActor(c);
      const data = await this.notificationService.getPreferences(actor);

      return c.json({ data });
    });

    app.patch('/api/me/notifications', async (c) => {
      const actor = requireActor(c);
      const input = await parseJson(c, updatePreferencesSchema);
      const data = await this.notificationService.updatePreferences(actor, input);

      return c.json({ data });
    });
  }
}
