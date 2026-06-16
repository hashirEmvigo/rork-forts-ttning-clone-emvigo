import { describe, expect, it } from "vitest";

import type { Customer, CustomerContact } from "@/types";
import {
  buildDefaultContact,
  ensureCustomerContacts,
  normalizeCustomerContacts,
  resolvePrimaryContact,
  setAgreementResponsible,
  setInvoiceResponsible,
  setPrimaryContact,
} from "./customerContacts";

function contact(id: string, patch: Partial<CustomerContact> = {}): CustomerContact {
  return { id, name: `Contact ${id}`, isPrimary: false, ...patch };
}

function customer(patch: Partial<Customer> = {}): Customer {
  return {
    id: "cust_1",
    companyId: "cmp_1",
    name: "Acme AB",
    customerNumber: "C-1001",
    email: "billing@acme.test",
    status: "active",
    userIds: [],
    createdAt: new Date().toISOString(),
    ...patch,
  };
}

describe("buildDefaultContact", () => {
  it("seeds Contact Person 1 from customer info, flagged primary/invoice/agreement", () => {
    const c = buildDefaultContact(
      { name: "Acme AB", email: "billing@acme.test", phone: "+46 1", mainContact: "Anna" },
      "con_new",
    );
    expect(c).toMatchObject({
      id: "con_new",
      name: "Anna",
      email: "billing@acme.test",
      phone: "+46 1",
      isPrimary: true,
      isContactPerson: true,
      isInvoiceResponsible: true,
      isAgreementResponsible: true,
    });
  });

  it("falls back to the customer name when no main contact is set", () => {
    const c = buildDefaultContact({ name: "Acme AB", email: "", phone: "", mainContact: "" }, "x");
    expect(c.name).toBe("Acme AB");
    expect(c.email).toBeUndefined();
  });
});

describe("normalizeCustomerContacts", () => {
  it("keeps only the first invoice/agreement/primary when duplicates exist", () => {
    const result = normalizeCustomerContacts([
      contact("a", { isPrimary: true, isInvoiceResponsible: true, isAgreementResponsible: true }),
      contact("b", { isPrimary: true, isInvoiceResponsible: true, isAgreementResponsible: true }),
    ]);
    expect(result.filter((c) => c.isPrimary)).toHaveLength(1);
    expect(result.filter((c) => c.isInvoiceResponsible)).toHaveLength(1);
    expect(result.filter((c) => c.isAgreementResponsible)).toHaveLength(1);
    expect(result[0].id).toBe("a");
  });

  it("promotes the first contact person to primary when none is set", () => {
    const result = normalizeCustomerContacts([contact("a"), contact("b")]);
    expect(result[0].isPrimary).toBe(true);
    expect(result[1].isPrimary).toBe(false);
  });

  it("defaults legacy contacts to contact persons", () => {
    const result = normalizeCustomerContacts([contact("a")]);
    expect(result[0].isContactPerson).toBe(true);
  });

  it("forces the primary to also be a contact person", () => {
    const result = normalizeCustomerContacts([
      contact("a", { isPrimary: true, isContactPerson: false }),
    ]);
    expect(result[0].isContactPerson).toBe(true);
  });

  it("returns an empty list unchanged", () => {
    expect(normalizeCustomerContacts([])).toEqual([]);
  });
});

describe("ensureCustomerContacts", () => {
  it("creates a default primary contact when none exist", () => {
    let n = 0;
    const result = ensureCustomerContacts(customer(), () => `con_${++n}`);
    expect(result).toHaveLength(1);
    expect(result[0].isPrimary).toBe(true);
    expect(result[0].name).toBe("Acme AB");
  });

  it("is idempotent — never duplicates an existing contact", () => {
    const result = ensureCustomerContacts(
      customer({ contacts: [contact("a", { isPrimary: true })] }),
      () => "should_not_be_used",
    );
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("a");
  });
});

describe("exclusive setters", () => {
  const base = [contact("a", { isPrimary: true }), contact("b"), contact("c")];

  it("setInvoiceResponsible makes one the sole invoice owner", () => {
    const r = setInvoiceResponsible(base, "b");
    expect(r.filter((c) => c.isInvoiceResponsible).map((c) => c.id)).toEqual(["b"]);
  });

  it("setAgreementResponsible makes one the sole agreement owner", () => {
    const r = setAgreementResponsible(base, "c");
    expect(r.filter((c) => c.isAgreementResponsible).map((c) => c.id)).toEqual(["c"]);
  });

  it("setPrimaryContact moves primary and keeps others secondary", () => {
    const r = setPrimaryContact(base, "b");
    expect(r.find((c) => c.id === "b")?.isPrimary).toBe(true);
    expect(r.find((c) => c.id === "b")?.isContactPerson).toBe(true);
    expect(r.filter((c) => c.isPrimary)).toHaveLength(1);
  });
});

describe("resolvePrimaryContact", () => {
  it("returns the explicit primary", () => {
    const c = customer({ contacts: [contact("a"), contact("b", { isPrimary: true })] });
    expect(resolvePrimaryContact(c)?.id).toBe("b");
  });

  it("falls back to the first contact person, then the first contact", () => {
    expect(resolvePrimaryContact(customer({ contacts: [contact("a")] }))?.id).toBe("a");
    expect(resolvePrimaryContact(customer({ contacts: [] }))).toBeUndefined();
  });
});
