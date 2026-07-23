import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { CurrentUser } from './current-user.decorator';
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import type { AuthUser } from './auth-user.type';

const REFRESH_COOKIE = 'srms_refresh_token';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService,
  ) {}

  @Post('login')
  @HttpCode(200)
  async login(
    @Body() dto: LoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const session = await this.auth.login(dto, request);
    this.setRefreshCookie(response, session.refreshToken);
    return {
      code: 200,
      message: 'success',
      data: { accessToken: session.accessToken, user: session.user },
    };
  }

  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const session = await this.auth.refresh(
      request.cookies?.[REFRESH_COOKIE] as string | undefined,
      request,
    );
    this.setRefreshCookie(response, session.refreshToken);
    return {
      code: 200,
      message: 'success',
      data: { accessToken: session.accessToken, user: session.user },
    };
  }

  @Post('logout')
  @HttpCode(200)
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.auth.logout(
      request.cookies?.[REFRESH_COOKIE] as string | undefined,
    );
    this.clearRefreshCookie(response);
    return { code: 200, message: 'success', data: null };
  }

  @Post('logout-all')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  async logoutAll(
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.auth.logoutAll(user.id);
    this.clearRefreshCookie(response);
    return { code: 200, message: 'success', data: null };
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: AuthUser) {
    return { code: 200, message: 'success', data: user };
  }

  private setRefreshCookie(response: Response, token: string) {
    response.cookie(REFRESH_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.config.get<string>('NODE_ENV') === 'production',
      path: '/api/auth',
      maxAge: this.refreshCookieMaxAge(),
    });
  }

  private clearRefreshCookie(response: Response) {
    response.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
  }

  private refreshCookieMaxAge() {
    const value = this.config.get<string>('JWT_REFRESH_EXPIRES_IN', '7d');
    const match = /^(\d+)([dhm])$/.exec(value);
    const multiplier =
      match?.[2] === 'd' ? 86_400_000 : match?.[2] === 'h' ? 3_600_000 : 60_000;
    return Number(match?.[1] ?? 7) * multiplier;
  }
}
