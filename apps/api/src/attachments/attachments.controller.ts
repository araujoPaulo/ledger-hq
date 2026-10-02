import { Controller, Delete, Get, HttpCode, Param, Post, Res, UploadedFile, UseFilters, UseGuards, UseInterceptors } from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { memoryStorage } from 'multer'
import type { Response } from 'express'
import { AppError, MAX_ATTACHMENT_BYTES, attachmentParamsSchema, obligationParamsSchema } from '@ledger-hq/domain'
import type { AttachmentParams, ObligationParams } from '@ledger-hq/domain'
import { ZodValidationPipe } from '../common/zod-validation.pipe.js'
import { SessionGuard } from '../auth/session.guard.js'
import { contentDisposition } from './content-disposition.js'
import { MulterErrorFilter } from './multer-error.filter.js'
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- constructor-injected: `emitDecoratorMetadata` needs the real class reference, not a type-only one.
import { AttachmentsService } from './attachments.service.js'
import type { AttachmentResponse } from './attachments.service.js'

@Controller('obligations/:obligationId/attachments')
@UseGuards(SessionGuard)
@UseFilters(MulterErrorFilter)
export class AttachmentsController {
  constructor(private readonly attachments: AttachmentsService) {}

  @Post()
  @UseInterceptors(
    FileInterceptor('file', {
      // In memory, not on disk: 10 MiB is small, and holding the bytes lets
      // the service sniff and hash them before anything is written.
      storage: memoryStorage(),
      // Busboy's default (latin1) mangles a non-ASCII filename such as
      // "Declaração periódica.pdf" into mojibake before it ever reaches the
      // service; the part header itself carries no charset to detect this
      // from, so it has to be declared here.
      defParamCharset: 'utf8',
      // Multer aborts the stream here; MulterErrorFilter turns that into
      // attachments.too_large rather than a 500.
      limits: { fileSize: MAX_ATTACHMENT_BYTES, files: 1 },
    }),
  )
  async upload(
    @Param(new ZodValidationPipe(obligationParamsSchema)) params: ObligationParams,
    @UploadedFile() file: Express.Multer.File,
  ): Promise<AttachmentResponse> {
    // Multer leaves `file` undefined when the part named "file" is missing,
    // or the body isn't multipart at all — neither of which is a
    // `MulterError`, so `MulterErrorFilter` never sees it. Reject here,
    // first, rather than let `attachments.service`'s `file.mimetype` throw a
    // bare TypeError that the global filter can only render as
    // `common.internal_error` (ADR 0004 wants a code, not a 500).
    if (!file) throw new AppError('common.validation_failed', {}, 422)

    return this.attachments.upload(params.obligationId, file)
  }

  @Get()
  async list(
    @Param(new ZodValidationPipe(obligationParamsSchema)) params: ObligationParams,
  ): Promise<AttachmentResponse[]> {
    return this.attachments.list(params.obligationId)
  }

  @Get(':id')
  async download(
    @Param(new ZodValidationPipe(attachmentParamsSchema)) params: AttachmentParams,
    @Res() response: Response,
  ): Promise<void> {
    const file = await this.attachments.download(params.obligationId, params.id)

    // Always `attachment`, never `inline`: the page never renders the bytes
    // (design §3.8). `X-Content-Type-Options: nosniff` already rides on
    // every response via helmet() in main.ts, and this route depends on it.
    response
      .status(200)
      .setHeader('Content-Type', file.contentType)
      .setHeader('Content-Disposition', contentDisposition(file.filename))
      .setHeader('Content-Length', String(file.bytes.length))
      .end(file.bytes)
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param(new ZodValidationPipe(attachmentParamsSchema)) params: AttachmentParams): Promise<void> {
    await this.attachments.remove(params.obligationId, params.id)
  }
}
