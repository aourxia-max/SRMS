import {
  BadRequestException,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { AuthUser } from '../auth/auth-user.type';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../authorization/roles.guard';
import { PaymentReviewQueryDto } from './dto/payment-review-query.dto';
import { PaymentReviewsService } from './payment-reviews.service';

@Controller('payment-reviews')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PaymentReviewsController {
  constructor(private readonly reviews: PaymentReviewsService) {}

  @Get()
  async list(
    @Query() query: PaymentReviewQueryDto,
    @CurrentUser() user: AuthUser,
  ) {
    return {
      code: 200,
      message: 'success',
      data: await this.reviews.list(query, user),
    };
  }

  @Get(':type/:id')
  async detail(
    @Param('type') type: string,
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthUser,
  ) {
    if (!['REFUND', 'VOID'].includes(type))
      throw new BadRequestException('审核类型无效');
    return {
      code: 200,
      message: 'success',
      data: await this.reviews.detail(type as 'REFUND' | 'VOID', id, user),
    };
  }
}
