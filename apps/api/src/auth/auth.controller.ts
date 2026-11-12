import { Body, Controller, Get, HttpCode, Post, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { routes } from "@fleet/contracts";
import { Inject } from "@nestjs/common";
import { ZodPipe } from "../infra/zod.pipe.js";
import { CONFIG } from "../infra/tokens.js";
import type { AppConfig } from "../config.js";
import { AppError, unauthorized } from "../infra/errors.js";
import { HttpStatus } from "@nestjs/common";
import { AuthService, isChallenge, type IssuedSession, type LoginResult } from "./auth.service.js";
import { Ctx, Public, type RequestContext } from "./context.js";
import type { z } from "zod";

export const REFRESH_COOKIE = "fleet_rt";

@Controller()
export class AuthController {
  constructor(private readonly auth: AuthService, @Inject(CONFIG) private readonly config: AppConfig) {}

  /** Web: refresh token goes into an HttpOnly cookie, never into JS-readable storage. */
  private web(res: Response, s: IssuedSession) {
    res.cookie(REFRESH_COOKIE, s.refreshToken, {
      httpOnly: true,
      secure: this.config.secureCookies,
      sameSite: "strict",
      path: "/",
      expires: s.refreshExpiresAt,
    });
    return { accessToken: s.accessToken, expiresIn: s.expiresIn, user: s.user, ...(s.recoveryCodes ? { recoveryCodes: s.recoveryCodes } : {}) };
  }

  /** NTF-001: an activated driver device registers (or clears) its Expo push token. */
  @Post(routes.registerPushToken.path) @HttpCode(200)
  async pushToken(@Body(new ZodPipe(routes.registerPushToken.body)) b: z.output<typeof routes.registerPushToken.body>, @Ctx() ctx: RequestContext) {
    if (!ctx.deviceId) throw new AppError(HttpStatus.FORBIDDEN, "device_required", "Push is registered from the driver app");
    await this.auth.setPushToken(ctx.identityId, ctx.deviceId, b.token);
    return {};
  }

  /** Lost-phone recovery: new single-use codes (shown once). */
  @Post(routes.regenerateRecoveryCodes.path) @HttpCode(200)
  async recoveryCodes(@Body(new ZodPipe(routes.regenerateRecoveryCodes.body)) b: z.output<typeof routes.regenerateRecoveryCodes.body>, @Ctx() ctx: RequestContext) {
    return { recoveryCodes: await this.auth.regenerateRecoveryCodes(ctx.identityId, b.code) };
  }
  private webOrChallenge(res: Response, r: LoginResult) {
    return isChallenge(r) ? r : this.web(res, r);
  }

  /** Devices store the refresh token in the secure keystore, so it is returned in the body. */
  private device(s: IssuedSession) {
    return { accessToken: s.accessToken, expiresIn: s.expiresIn, refreshToken: s.refreshToken, user: s.user };
  }

  @Public() @Post(routes.login.path) @HttpCode(200)
  async login(@Body(new ZodPipe(routes.login.body)) b: z.output<typeof routes.login.body>, @Res({ passthrough: true }) res: Response) {
    return this.webOrChallenge(res, await this.auth.login(b.email, b.password, b.tenantSlug));
  }

  @Public() @Post(routes.acceptInvite.path) @HttpCode(200)
  async acceptInvite(@Body(new ZodPipe(routes.acceptInvite.body)) b: z.output<typeof routes.acceptInvite.body>, @Res({ passthrough: true }) res: Response) {
    return this.webOrChallenge(res, await this.auth.acceptInvite(b.token, b.password));
  }

  @Public() @Post(routes.mfaVerify.path) @HttpCode(200)
  async mfa(@Body(new ZodPipe(routes.mfaVerify.body)) b: z.output<typeof routes.mfaVerify.body>, @Res({ passthrough: true }) res: Response) {
    return this.web(res, await this.auth.verifyMfa(b.mfaToken, b.code));
  }

  @Post(routes.switchRole.path) @HttpCode(200)
  async switchRole(
    @Body(new ZodPipe(routes.switchRole.body)) b: z.output<typeof routes.switchRole.body>,
    @Ctx() ctx: RequestContext,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (ctx.deviceId) throw unauthorized("Not available on driver devices");
    const next = await this.auth.switchRole(ctx.identityId, b.membershipId, b.code);
    const old = (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE];
    if (old) await this.auth.logout(old);
    return this.web(res, next);
  }

  @Public() @Post(routes.driverActivate.path) @HttpCode(200)
  async activate(@Body(new ZodPipe(routes.driverActivate.body)) b: z.output<typeof routes.driverActivate.body>) {
    return this.device(await this.auth.activateDriver(b.username, b.code, b.deviceName, b.platform, b.devicePublicKey));
  }

  @Public() @Post(routes.refresh.path) @HttpCode(200)
  async refresh(@Body(new ZodPipe(routes.refresh.body)) b: z.output<typeof routes.refresh.body>, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    if (b.refreshToken) return this.device(await this.auth.refresh(b.refreshToken, b.deviceProof));
    const cookie = (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE];
    if (!cookie) throw unauthorized("Session expired");
    return this.web(res, await this.auth.refresh(cookie));
  }

  @Public() @Post(routes.logout.path) @HttpCode(200)
  async logout(@Body(new ZodPipe(routes.logout.body)) b: z.output<typeof routes.logout.body>, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = b.refreshToken ?? (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE];
    if (token) await this.auth.logout(token);
    res.clearCookie(REFRESH_COOKIE, { path: "/" });
    return { ok: true as const };
  }

  @Get(routes.me.path)
  async me(@Ctx() ctx: RequestContext) {
    const me = await this.auth.describe(ctx.identityId, ctx.membershipId);
    if (!ctx.supportGrantId) return me;
    // Break-glass session: describe the read-only view of the tenant.
    return { ...me, role: "viewer" as const, memberships: [], currentMembershipId: null, tenant: await this.auth.tenantInfo(ctx.tenantId!), support: { grantId: ctx.supportGrantId, expiresAt: await this.auth.grantExpiry(ctx.supportGrantId) } };
  }
}
