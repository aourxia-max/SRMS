import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../authorization/roles.decorator';
import { RolesGuard } from '../authorization/roles.guard';
import { FinanceService } from './finance.service';
import { FinanceExportService } from './finance-export.service';
import { ExportTasksService } from './export-tasks.service';
import { CreateExportTaskDto } from './dto/create-export-task.dto';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth-user.type';
@Controller('finance')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN)
export class FinanceController {
  constructor(
    private readonly finance: FinanceService,
    private readonly exports: FinanceExportService,
    private readonly exportTasks: ExportTasksService,
  ) {}
  @Post('export-tasks')
  async createExportTask(
    @Body() dto: CreateExportTaskDto,
    @CurrentUser() user: AuthUser,
  ) {
    const task = await this.exportTasks.create(
      dto.reportType,
      dto.format,
      { from: dto.from, to: dto.to },
      user,
    );
    return { code: 200, message: 'Export task created', data: task };
  }
  @Get('export-tasks')
  async listExportTasks(@CurrentUser() user: AuthUser) {
    return {
      code: 200,
      message: 'success',
      data: await this.exportTasks.list(user),
    };
  }
  @Get('export-tasks/:id/download')
  async downloadExportTask(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthUser,
    @Res() response: Response,
  ) {
    const { task, content } = await this.exportTasks.content(id, user);
    response.setHeader('Content-Type', task.fileAsset!.mimeType);
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${task.fileAsset!.originalName}"`,
    );
    response.send(content);
  }
  @Get('rent-collection') async rentCollection(
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return {
      code: 200,
      message: 'success',
      data: await this.finance.rentCollection(from, to),
    };
  }
  @Get('cash-flows') async cashFlows(
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return {
      code: 200,
      message: 'success',
      data: await this.finance.cashFlows(from, to),
    };
  }
  @Get('exports/rent-collection.xlsx')
  async exportRentCollection(
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @CurrentUser() user: AuthUser,
    @Res() response: Response,
  ) {
    const file = await this.exports.rentCollectionWorkbook(from, to, user);
    response.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    response.setHeader(
      'Content-Disposition',
      'attachment; filename="rent-collection.xlsx"',
    );
    response.send(Buffer.from(file));
  }
  @Get('exports/cash-flows.xlsx')
  async exportCashFlows(
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @CurrentUser() user: AuthUser,
    @Res() response: Response,
  ) {
    const file = await this.exports.cashFlowWorkbook(from, to, user);
    response.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    response.setHeader(
      'Content-Disposition',
      'attachment; filename="cash-flows.xlsx"',
    );
    response.send(Buffer.from(file));
  }
  @Get('exports/overview.pdf')
  async exportOverviewPdf(
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @CurrentUser() user: AuthUser,
    @Res() response: Response,
  ) {
    const file = await this.exports.overviewPdf(from, to, user);
    response.setHeader('Content-Type', 'application/pdf');
    response.setHeader(
      'Content-Disposition',
      'attachment; filename="finance-overview.pdf"',
    );
    response.send(Buffer.from(file));
  }
  @Get('exports/rent-collection.pdf')
  async exportRentCollectionPdf(
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @CurrentUser() user: AuthUser,
    @Res() response: Response,
  ) {
    const file = await this.exports.rentCollectionPdf(from, to, user);
    response.setHeader('Content-Type', 'application/pdf');
    response.setHeader(
      'Content-Disposition',
      'attachment; filename="rent-collection.pdf"',
    );
    response.send(Buffer.from(file));
  }
  @Get('exports/cash-flows.pdf')
  async exportCashFlowsPdf(
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @CurrentUser() user: AuthUser,
    @Res() response: Response,
  ) {
    const file = await this.exports.cashFlowPdf(from, to, user);
    response.setHeader('Content-Type', 'application/pdf');
    response.setHeader(
      'Content-Disposition',
      'attachment; filename="cash-flows.pdf"',
    );
    response.send(Buffer.from(file));
  }
  @Get('exports/commissions.xlsx')
  async exportCommissions(
    @CurrentUser() user: AuthUser,
    @Res() response: Response,
  ) {
    const file = await this.exports.commissionsWorkbook(user);
    response.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    response.setHeader(
      'Content-Disposition',
      'attachment; filename="commissions.xlsx"',
    );
    response.send(Buffer.from(file));
  }
}
