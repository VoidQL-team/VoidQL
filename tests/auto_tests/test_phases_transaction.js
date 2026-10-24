import { expect } from "vitest";
import { VoidQL } from "../../src";

export default async function phased_transaction(
  db,
  structure,
  local_user,
  role
) {
  const email = `phase-tx-${Date.now()}@example.com`;

  const request = {
    phases: [
      {
        mode: "TRANSACTION",
        queries: [
          {
            type: "POST",
            table: "users",
            data: {
              name: "Phase Tx",
              surname: "Test",
              email,
              age: 33,
              have_access: 1,
            },
            returning: ["id", "email"],
          },
          {
            type: "GET",
            table: "users",
            select: "email",
            where: {
              field: "email",
              op: "=",
              value: email,
            },
          },
        ],
      },
    ],
  };

  const compiled = await new VoidQL({ db, user: local_user, role, structure }).compile(request);

  const result = await compiled.execute();

  console.log("phased transaction result:", result);

  expect(result).toBeDefined();
  expect(result.ok).toBe(true);
  expect(Array.isArray(result.data)).toBe(true);
  expect(result.data).toHaveLength(1);
  expect(result.data[0].data).toHaveLength(2);
  expect(result.data[0].data[0][0].email).toBe(email);
  expect(result.data[0].data[0][0]).toHaveProperty("id");
  expect(result.data[0].data[1][0].email).toBe(email);
  expect(result.data[0].data[1][0]).not.toHaveProperty("id");
}
