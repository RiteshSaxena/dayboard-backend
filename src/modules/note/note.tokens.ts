import { createToken } from "../../core/di/container";
import type { NoteRepository } from "./note.repository";
import type { NoteService } from "./note.service";

export const NOTE_REPOSITORY = createToken<NoteRepository>("NoteRepository");
export const NOTE_SERVICE = createToken<NoteService>("NoteService");
