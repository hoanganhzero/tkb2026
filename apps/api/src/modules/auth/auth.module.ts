import { Body, Controller, Get, Inject, Module, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from './auth.service.js';
import { DbModule } from '../../db/db.service.js';
import { requestContext } from '../../common/request-context.js';

@Controller('auth')
export class AuthController {
  constructor(@Inject(AuthService) private auth: AuthService) {}

  @Post('register')
  register(@Body() body: {
    fullName: string; email: string; phone?: string;
    password: string; schoolName: string; level?: string;
  }) {
    return this.auth.register(body);
  }

  @Post('login')
  login(@Body() body: { identifier: string; password: string }) {
    return this.auth.login(body.identifier, body.password);
  }

  @Get('me')
  me(@Req() req: Request) {
    const ctx = requestContext.getStore();
    return this.auth.me(ctx!.userId!);
  }
}

@Module({
  imports: [DbModule],
  controllers: [AuthController],
  providers: [AuthService]
})
export class AuthModule {}
