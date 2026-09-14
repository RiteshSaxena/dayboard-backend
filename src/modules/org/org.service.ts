import { ApiError, conflict, forbidden, notFound } from "../../core/http/api-error";
import { createId, createToken, sha256 } from "../../core/security/crypto";
import { normalizeEmail, now, slugify } from "../../core/utils/text";
import type { AuthActor } from "../auth/auth.types";
import type { ActivityService } from "../activity/activity.service";
import type { AuthorizationService, Role } from "../authorization/authorization.service";
import type { MailService } from "../mail/mail.service";
import type { RateLimitService } from "../security/rate-limit.service";
import type { OrgRepository } from "./org.repository";

const DAY = 86_400_000;

export class OrgService {
  constructor(
    private readonly repository: OrgRepository,
    private readonly authorization: AuthorizationService,
    private readonly rateLimit: RateLimitService,
    private readonly mail: MailService,
    private readonly activity: ActivityService,
  ) {}

  async create(actor: AuthActor, name: string) {
    this.authorization.requireVerified(actor);
    const timestamp = now();
    const id = createId();
    const org = {
      id, name, slug: `${slugify(name)}-${id.slice(-6).toLowerCase()}`, personal: false,
      createdBy: actor.user.id, createdAt: timestamp, updatedAt: timestamp, deletedAt: null,
    };
    await this.repository.create(org, { orgId: id, userId: actor.user.id, role: "owner", joinedAt: timestamp });
    return { ...org, role: "owner" as const };
  }

  async update(actor: AuthActor, orgId: string, name: string) {
    await this.authorization.requireOrg(actor, orgId, "admin");
    return this.repository.update(orgId, { name, updatedAt: now() });
  }

  async remove(actor: AuthActor, orgId: string): Promise<void> {
    const membership = await this.authorization.requireOrg(actor, orgId, "owner");
    if (membership.role !== "owner") throw forbidden();
    const org = await this.repository.find(orgId);
    if (!org) throw notFound("Organization");
    if (org.personal) throw conflict("A personal organization cannot be deleted");
    await this.repository.update(orgId, { deletedAt: now(), updatedAt: now() });
  }

  async members(actor: AuthActor, orgId: string) {
    await this.authorization.requireOrg(actor, orgId);
    return this.repository.listMembers(orgId);
  }

  async updateMember(actor: AuthActor, orgId: string, userId: string, role: Exclude<Role, "owner">): Promise<void> {
    const actorMembership = await this.authorization.requireOrg(actor, orgId, "admin");
    const target = await this.repository.findMembership(orgId, userId);
    if (!target) throw notFound("Member");
    if (userId === actor.user.id) throw conflict("Use the leave endpoint to change your own membership");
    if (!this.authorization.canManageRole(actorMembership.role, target.role)) throw forbidden();
    if (!this.authorization.canManageRole(actorMembership.role, role)) throw forbidden();
    await this.repository.updateMembership(orgId, userId, role);
  }

  async removeMember(actor: AuthActor, orgId: string, userId: string): Promise<void> {
    const actorMembership = await this.authorization.requireOrg(actor, orgId);
    const target = await this.repository.findMembership(orgId, userId);
    if (!target) throw notFound("Member");
    const org = await this.repository.find(orgId);
    if (org?.personal) throw conflict("A personal organization cannot be left or have members removed");

    if (userId !== actor.user.id) {
      if (actorMembership.role !== "owner" && actorMembership.role !== "admin") throw forbidden();
      if (!this.authorization.canManageRole(actorMembership.role, target.role)) throw forbidden();
    }
    if (target.role === "owner" && (await this.repository.countOwners(orgId)) <= 1) {
      throw conflict("The last owner cannot leave or be removed");
    }
    await this.repository.removeMembership(orgId, userId);
  }

  async transfer(actor: AuthActor, orgId: string, userId: string): Promise<void> {
    const actorMembership = await this.authorization.requireOrg(actor, orgId, "owner");
    if (actorMembership.role !== "owner") throw forbidden();
    const target = await this.repository.findMembership(orgId, userId);
    if (!target) throw notFound("Member");
    if (target.userId === actor.user.id) throw conflict("You already own this organization");
    await this.repository.transferOwnership(orgId, actor.user.id, target.userId);
  }

  async invites(actor: AuthActor, orgId: string) {
    await this.authorization.requireOrg(actor, orgId, "admin");
    const rows = await this.repository.listInvites(orgId);
    return rows.map(({ invite, inviter }) => ({
      invite: {
        id: invite.id,
        orgId: invite.orgId,
        email: invite.email,
        role: invite.role,
        invitedBy: invite.invitedBy,
        expiresAt: invite.expiresAt,
        acceptedAt: invite.acceptedAt,
        revokedAt: invite.revokedAt,
        createdAt: invite.createdAt,
      },
      inviter,
    }));
  }

  async invite(actor: AuthActor, orgId: string, emailInput: string, role: Exclude<Role, "owner">) {
    this.authorization.requireVerified(actor);
    const membership = await this.authorization.requireOrg(actor, orgId, "admin");
    if (!this.authorization.canManageRole(membership.role, role)) throw forbidden();
    await this.rateLimit.check("invite", `org:${orgId}`);
    const org = await this.repository.find(orgId);
    if (!org || org.personal) throw conflict("Personal organizations cannot have members");
    const email = normalizeEmail(emailInput);
    if (await this.repository.hasMemberWithEmail(orgId, email)) throw conflict("This person is already a member", "email");
    if (await this.repository.findPendingInviteForEmail(orgId, email)) throw conflict("A pending invitation already exists", "email");
    if ((await this.repository.countMembers(orgId)) >= 100) throw conflict("This organization has reached its member limit");

    const rawToken = createToken();
    const timestamp = now();
    const invite = {
      id: createId(), orgId, email, role, tokenHash: await sha256(rawToken), invitedBy: actor.user.id,
      expiresAt: timestamp + 7 * DAY, acceptedAt: null, revokedAt: null, createdAt: timestamp,
    };
    await this.repository.createInvite(invite);
    this.mail.sendInvite({ email, inviter: actor.user.name, inviterEmail: actor.user.email, org: org.name, role, token: rawToken });
    return {
      id: invite.id, orgId: invite.orgId, email: invite.email, role: invite.role,
      invitedBy: invite.invitedBy, expiresAt: invite.expiresAt, createdAt: invite.createdAt,
    };
  }

  async resendInvite(actor: AuthActor, orgId: string, inviteId: string): Promise<void> {
    await this.authorization.requireOrg(actor, orgId, "admin");
    const invite = await this.repository.findInvite(orgId, inviteId);
    const org = await this.repository.find(orgId);
    if (!invite || !org) throw notFound("Invitation");
    const token = createToken();
    const timestamp = now();
    await this.repository.replaceInviteToken(invite.id, await sha256(token), timestamp + 7 * DAY, timestamp);
    this.mail.sendInvite({ email: invite.email, inviter: actor.user.name, inviterEmail: actor.user.email, org: org.name, role: invite.role, token });
  }

  async revokeInvite(actor: AuthActor, orgId: string, inviteId: string): Promise<void> {
    await this.authorization.requireOrg(actor, orgId, "admin");
    if (!(await this.repository.findInvite(orgId, inviteId))) throw notFound("Invitation");
    await this.repository.revokeInvite(orgId, inviteId, now());
  }

  async invitePreview(rawToken: string) {
    const found = await this.repository.findInviteByTokenHash(await sha256(rawToken));
    if (!found || found.invite.acceptedAt || found.invite.revokedAt || found.invite.expiresAt <= now()) {
      throw new ApiError(410, "expired", "Invitation is invalid or expired");
    }
    return {
      org: { id: found.org.id, name: found.org.name },
      inviter: { id: found.inviter.id, name: found.inviter.name },
      role: found.invite.role,
      expiresAt: found.invite.expiresAt,
    };
  }

  async acceptInvite(actor: AuthActor, rawToken: string): Promise<void> {
    this.authorization.requireVerified(actor);
    const found = await this.repository.findInviteByTokenHash(await sha256(rawToken));
    if (!found || found.invite.acceptedAt || found.invite.revokedAt || found.invite.expiresAt <= now()) {
      throw new ApiError(410, "expired", "Invitation is invalid or expired");
    }
    if (await this.repository.findMembership(found.org.id, actor.user.id)) throw conflict("You are already a member");
    if ((await this.repository.countMembers(found.org.id)) >= 100) throw conflict("This organization has reached its member limit");
    const acceptedAt = now();
    if (!(await this.repository.acceptInvite(found.invite, actor.user.id, acceptedAt))) {
      throw new ApiError(410, "expired", "Invitation is invalid or expired");
    }
    await this.activity.record({
      orgId: found.org.id,
      actorId: actor.user.id,
      kind: "member.joined",
      payload: { userId: actor.user.id, name: actor.user.name, role: found.invite.role },
    });
    const inviterEmail = await this.repository.getUserEmail(found.invite.invitedBy);
    if (inviterEmail) {
      this.mail.sendMemberJoined({
        to: inviterEmail, name: actor.user.name, email: actor.user.email, org: found.org.name,
        role: found.invite.role, orgId: found.org.id,
      });
    }
  }
}
