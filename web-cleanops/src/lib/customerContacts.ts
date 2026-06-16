import type { Customer, CustomerContact } from "@/types";

/**
 * Customer contact-people rules — a single source of truth for the
 * responsibility model on a customer card.
 *
 * Each {@link CustomerContact} can carry responsibility flags:
 *  - `isContactPerson` — is listed as a contact person (defaults true on legacy
 *    records).
 *  - `isPrimary`       — the single primary contact person (implies contact).
 *  - `isInvoiceResponsible`   — the single invoice-responsible person.
 *  - `isAgreementResponsible` — the single agreement-responsible person.
 *
 * Exclusivity is enforced centrally so no surface can produce two invoice/
 * agreement/primary owners. Everything here is pure and side-effect free.
 */

/** A customer's contact-relevant fields used to seed a default contact person. */
type CustomerContactSeed = Pick<Customer, "name" | "email" | "phone" | "mainContact">;

/**
 * Builds the default "Contact Person 1" from the customer's own information.
 * It is automatically marked primary, contact, invoice- and agreement-
 * responsible — the customer is responsible for itself until split out.
 */
export function buildDefaultContact(customer: CustomerContactSeed, id: string): CustomerContact {
  const name = customer.mainContact?.trim() || customer.name?.trim() || "Primary contact";
  const email = customer.email?.trim();
  const phone = customer.phone?.trim();
  return {
    id,
    name,
    email: email || undefined,
    phone: phone || undefined,
    isPrimary: true,
    isContactPerson: true,
    isInvoiceResponsible: true,
    isAgreementResponsible: true,
  };
}

/**
 * Normalizes a contact list so the exclusivity and primary rules always hold:
 *  - at most one invoice-responsible, one agreement-responsible, one primary,
 *  - the primary is always also a contact person,
 *  - if any contact people exist but none is primary, the first contact person
 *    is promoted to primary.
 *
 * When multiple flags are set (e.g. legacy or hand-edited data), the FIRST
 * occurrence wins and later duplicates are cleared. Pure — returns a new array.
 */
export function normalizeCustomerContacts(contacts: readonly CustomerContact[]): CustomerContact[] {
  if (contacts.length === 0) return [];
  let invoiceSeen = false;
  let agreementSeen = false;
  let primarySeen = false;

  const result = contacts.map((c) => {
    const next: CustomerContact = {
      ...c,
      isContactPerson: c.isContactPerson ?? true,
    };

    if (next.isInvoiceResponsible) {
      if (invoiceSeen) next.isInvoiceResponsible = false;
      else invoiceSeen = true;
    }
    if (next.isAgreementResponsible) {
      if (agreementSeen) next.isAgreementResponsible = false;
      else agreementSeen = true;
    }
    if (next.isPrimary) {
      next.isContactPerson = true;
      if (primarySeen) next.isPrimary = false;
      else primarySeen = true;
    }
    return next;
  });

  if (!primarySeen) {
    const firstContactPerson = result.find((c) => c.isContactPerson);
    if (firstContactPerson) firstContactPerson.isPrimary = true;
  }
  return result;
}

/**
 * Returns the customer's contact list with a guaranteed default primary contact
 * when none exist yet. Idempotent: never duplicates an existing contact. Use
 * this in migrations/seeds; pass a unique id generator for the new contact.
 */
export function ensureCustomerContacts(
  customer: Customer,
  makeId: () => string,
): CustomerContact[] {
  const existing = customer.contacts ?? [];
  if (existing.length > 0) return normalizeCustomerContacts(existing);
  return [buildDefaultContact(customer, makeId())];
}

/** Resolves the primary contact person, with safe fallbacks for legacy data. */
export function resolvePrimaryContact(
  customer: Pick<Customer, "contacts">,
): CustomerContact | undefined {
  const contacts = customer.contacts ?? [];
  return (
    contacts.find((c) => c.isPrimary) ??
    contacts.find((c) => c.isContactPerson ?? true) ??
    contacts[0]
  );
}

/** Makes `id` the sole invoice-responsible contact, clearing it on all others. */
export function setInvoiceResponsible(
  contacts: readonly CustomerContact[],
  id: string,
): CustomerContact[] {
  return contacts.map((c) => ({ ...c, isInvoiceResponsible: c.id === id }));
}

/** Makes `id` the sole agreement-responsible contact, clearing it on all others. */
export function setAgreementResponsible(
  contacts: readonly CustomerContact[],
  id: string,
): CustomerContact[] {
  return contacts.map((c) => ({ ...c, isAgreementResponsible: c.id === id }));
}

/**
 * Makes `id` the sole primary contact. The new primary is forced to be a
 * contact person; all others become secondary contacts (primary cleared).
 */
export function setPrimaryContact(
  contacts: readonly CustomerContact[],
  id: string,
): CustomerContact[] {
  return contacts.map((c) =>
    c.id === id
      ? { ...c, isPrimary: true, isContactPerson: true }
      : { ...c, isPrimary: false },
  );
}
