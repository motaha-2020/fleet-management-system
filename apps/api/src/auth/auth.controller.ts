import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Post, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { routes } from "@fleet/contracts";
import type { z } from "zod";
import { ZodPipe } from "../infra/zod.pipe.js";
import { CONFIG } from "../infra/tokens.js";
import type { AppConfig } from "../config.js";
import { AppError, unauthorized } from "../infra/errors.js";
import { AuthService, isChallenge, type IssuedSession, type LoginResult, type WebSignIn } from "./auth.service.js";
import { Ctx, Public, type RequestContext } from "./context.js";

export const REFRESH_COOKIE = "fleet_rt";
/** A browser that passed the email code (no code again on it for 30 days). */
export const TRUSTED_COOKIE = "fleet_td";

const cookie = (req: Request, name: string) => (req.cookies as Record<string, string> | undefined)?.[name];

@Controller()
export class AuthController {
  constructor(private readonly auth: AuthService, @Inject(CONFIG) private readonly config: AppConfig) {}

  private signIn(req: Request, remember?: boolean): WebSignIn {
    return { remember, trustedToken: cookie(req, TRUSTED_COOKIE) ?? null, userAgent: req.get("user-agent") ?? null };
  }

  /**
   * Web: the refresh token goes into an HttpOnly cookie, never into JS-readable storage. A 24-hour session is a
   * cookie that also ends with the browser; "keep me signed in" keeps it until the session itself expires.
   */
  private web(res: Response, s: IssuedSession) {
    const persistent = s.refreshExpiresAt.getTime() - Date.now() > 25 * 3_600_000;
    res.cookie(REFRESH_COOKIE, s.refreshToken, {
      httpOnly: true, secure: this.config.secureCookies, sameSite: "strict", path: "/",
      ...(persistent ? { expires: s.refreshExpiresAt } : {}),
    });
    if (s.trusted) {
      res.cookie(TRUSTED_COOKIE, s.trusted.token, { httpOnly: true, secure: this.config.secureCookies, sameSite: "strict", path: "/", expires: s.trusted.expiresAt });
    }
    return { accessToken: s.accessToken, expiresIn: s.expiresIn, user: s.user };
  }

  private webOrChallenge(res: Response, r: LoginResult) {
    return isChallenge(r) ? r : this.web(res, r);
  }

  /** Devices store the refresh token in the secure keystore, so it is returned in the body. */
  private device(s: IssuedSession) {
    return { accessToken: s.accessToken, expiresIn: s.expiresIn, refreshToken: s.refreshToken, user: s.user };
  }

  /** NTF-001: an activated driver device registers (or clears) its Expo push token. */
  @Post(routes.registerPushToken.path) @HttpCode(200)
  async pushToken(@Body(new ZodPipe(routes.registerPushToken.body)) b: z.output<typeof routes.registerPushToken.body>, @Ctx() ctx: RequestContext) {
    if (!ctx.deviceId) throw new AppError(HttpStatus.FORBIDDEN, "device_required", "Push is registered from the driver app");
    await this.auth.setPushToken(ctx.identityId, ctx.deviceId, b.token);
    return {};
  }

  @Public() @Post(routes.login.path) @HttpCode(200)
  async login(@Body(new ZodPipe(routes.login.body)) b: z.output<typeof routes.login.body>, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.webOrChallenge(res, await this.auth.login(b.email, b.password, b.tenantSlug, this.signIn(req, b.remember)));
  }

  @Public() @Post(routes.acceptInvite.path) @HttpCode(200)
  async acceptInvite(@Body(new ZodPipe(routes.acceptInvite.body)) b: z.output<typeof routes.acceptInvite.body>, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.web(res, await this.auth.acceptInvite(b.token, b.password, this.signIn(req)));
  }

  @Public() @Post(routes.mfaVerify.path) @HttpCode(200)
  async mfa(@Body(new ZodPipe(routes.mfaVerify.body)) b: z.output<typeof routes.mfaVerify.body>, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.web(res, await this.auth.verifyMfa(b.mfaToken, b.code, this.signIn(req)));
  }

  @Public() @Post(routes.mfaResend.path) @HttpCode(200)
  async resend(@Body(new ZodPipe(routes.mfaResend.body)) b: z.output<typeof routes.mfaResend.body>) {
    await this.auth.resendCode(b.mfaToken);
    return { ok: true as const };
  }

  @Public() @Post(routes.forgotPassword.path) @HttpCode(200)
  async forgot(@Body(new ZodPipe(routes.forgotPassword.body)) b: z.output<typeof routes.forgotPassword.body>) {
    await this.auth.forgotPassword(b.email);
    return { ok: true as const };
  }

  @Public() @Post(routes.resetPassword.path) @HttpCode(200)
  async reset(@Body(new ZodPipe(routes.resetPassword.body)) b: z.output<typeof routes.resetPassword.body>, @Res({ passthrough: true }) res: Response) {
    await this.auth.resetPassword(b.token, b.password);
    res.clearCookie(REFRESH_COOKIE, { path: "/" });
    res.clearCookie(TRUSTED_COOKIE, { path: "/" });
    return { ok: true as const };
  }

  @Post(routes.switchRole.path) @HttpCode(200)
  async switchRole(
    @Body(new ZodPipe(routes.switchRole.body)) b: z.output<typeof routes.switchRole.body>,
    @Ctx() ctx: RequestContext,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (ctx.deviceId) throw unauthorized("Not available on driver devices");
    const old = cookie(req, REFRESH_COOKIE);
    const next = await this.auth.switchRole(ctx.identityId, b.membershipId, old);
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
    const token = cookie(req, REFRESH_COOKIE);
    if (!token) throw new AppError(HttpStatus.UNAUTHORIZED, "session_expired", "Session expired");
    return this.web(res, await this.auth.refresh(token));
  }

  @Public() @Post(routes.logout.path) @HttpCode(200)
  async logout(@Body(new ZodPipe(routes.logout.body)) b: z.output<typeof routes.logout.body>, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = b.refreshToken ?? cookie(req, REFRESH_COOKIE);
    if (token) await this.auth.logout(token);
    // Signing out keeps the browser trusted: signing in again needs the password, not another email code.
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
