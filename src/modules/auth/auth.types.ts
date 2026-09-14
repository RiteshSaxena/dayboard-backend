import type { Session, User } from "../../database/schema";

export interface AuthActor {
  user: User;
  session: Session;
}

export function userDto(user: User) {
  return {
    id: user.id,
    email: user.email,
    emailVerifiedAt: user.emailVerifiedAt,
    name: user.name,
    avatarUrl: user.avatarUrl,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}
