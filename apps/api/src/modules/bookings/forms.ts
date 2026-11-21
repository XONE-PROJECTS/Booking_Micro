import { eq } from 'drizzle-orm';
import type { FormSchema } from '@universal-booking/core';
import { newId } from '@universal-booking/core';
import { bookingAnswers, formSubmissions, type Tx } from '@universal-booking/database';

export async function persistFormAnswers(
  tx: Tx,
  input: {
    tenantId: string;
    bookingId: string;
    customerId: string | null;
    formId: string;
    schema: FormSchema;
    answers: Record<string, unknown>;
  },
) {
  const submissionId = newId();
  await tx.insert(formSubmissions).values({
    id: submissionId,
    tenantId: input.tenantId,
    formId: input.formId,
    bookingId: input.bookingId,
    customerId: input.customerId,
    answers: input.answers,
  });
  const fields = input.schema.fields ?? [];
  for (const field of fields) {
    if (field.key in input.answers) {
      await tx.insert(bookingAnswers).values({
        id: newId(),
        tenantId: input.tenantId,
        bookingId: input.bookingId,
        submissionId,
        fieldKey: field.key,
        label: field.label ?? field.key,
        value: input.answers[field.key],
      });
    }
  }
  return submissionId;
}