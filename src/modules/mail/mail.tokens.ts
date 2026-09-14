import { createToken } from "../../core/di/container";
import type { MailService } from "./mail.service";

export const MAIL_SERVICE = createToken<MailService>("MailService");
