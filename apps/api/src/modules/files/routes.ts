import { Readable } from 'node:stream';
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { errors, newId } from '@universal-booking/core';
import { fileAttachments } from '@universal-booking/database';
import type { RouteBuilder } from '../../http/route';
import { Reply } from '../../http/envelope';
import { readLocalFile, storeLocalFile } from '../../storage/local';
import { idParam } from '@universal-booking/contracts';

export function registerFileRoutes(route: RouteBuilder) {
  route({
    method: 'get',
    path: '/files/:id',
    summary: 'Download a file attachment',
    tags: ['Files'],
    auth: 'user',
    permission: 'bookings.read',
    params: idParam,
    async handler({ app, tx, params }) {
      const [row] = await tx((t) =>
        t
          .select()
          .from(fileAttachments)
          .where(and(eq(fileAttachments.id, params.id), isNull(fileAttachments.deletedAt))),
      );
      if (!row) throw errors.notFound('File');
      if (row.driver !== 'local') throw errors.unavailable('Download is only supported for local storage.');
      const body = await readLocalFile(row.storageKey, app.env.STORAGE_LOCAL_DIR);
      return new Reply(200, null, {
        raw: { contentType: row.mimeType, body },
        headers: { 'content-disposition': `attachment; filename="${row.fileName.replace(/"/g, '')}"` },
      });
    },
  });

  route({
    method: 'post',
    path: '/files',
    summary: 'Upload a file attachment',
    tags: ['Files'],
    auth: 'user',
    permission: 'bookings.update',
    body: z.object({
      filename: z.string().min(1).max(200),
      mime: z.string().min(3).max(120),
      encoding: z.enum(['base64']).default('base64'),
      data: z.string().min(1).max(12_000_000),
      entityType: z.string().max(40).optional(),
      entityId: z.uuid().optional(),
    }),
    async handler({ app, tx, tenant, body, audit }) {
      const buf = Buffer.from(body.data, 'base64');
      const stream = Readable.from(buf);
      const stored = await storeLocalFile(app.env.STORAGE_LOCAL_DIR, {
        tenantId: tenant.id,
        filename: body.filename,
        mime: body.mime,
        size: buf.length,
        stream,
        maxBytes: app.env.MAX_UPLOAD_BYTES,
      });
      const id = newId();
      return tx(async (t) => {
        await t.insert(fileAttachments).values({
          id,
          tenantId: tenant.id,
          entityType: body.entityType ?? 'booking',
          entityId: body.entityId ?? null,
          fileName: body.filename,
          mimeType: body.mime,
          sizeBytes: buf.length,
          driver: app.env.STORAGE_DRIVER,
          storageKey: stored.path,
        });
        await audit({ action: 'file.uploaded', entityType: 'File', entityId: id }, t);
        const [row] = await t.select().from(fileAttachments).where(eq(fileAttachments.id, id));
        return Reply.created(row!);
      });
    },
  });
}
