import type { Client } from '../generated/prisma/client.js'

export type ClientResponse = {
  id: string
  kind: Client['kind']
  name: string
  taxId: string
  accounting: Client['accounting']
  email: string | null
  phone: string | null
  notes: string | null
  legalForm: Client['legalForm']
  socialSecurityNo: string | null
  dateOfBirth: string | null
  archivedAt: string | null
}

/** `date` columns become plain YYYY-MM-DD strings; instants become ISO 8601. */
export function toClientResponse(client: Client): ClientResponse {
  return {
    id: client.id,
    kind: client.kind,
    name: client.name,
    taxId: client.taxId,
    accounting: client.accounting,
    email: client.email,
    phone: client.phone,
    notes: client.notes,
    legalForm: client.legalForm,
    socialSecurityNo: client.socialSecurityNo,
    dateOfBirth: client.dateOfBirth ? client.dateOfBirth.toISOString().slice(0, 10) : null,
    archivedAt: client.archivedAt ? client.archivedAt.toISOString() : null,
  }
}
