import { expect } from "vitest";
import { VoidQL } from "../../src";

export default async function selectNotExists(
  db,
  structure,
  local_user,
  role
) {
  const request = {
    type: "GET",
    select: "name",
    table: "users",
    where: {
      operator: "NOT EXISTS",
      query: {
        select: "id",
        from: "users",
        where: {
          field: "email",
          op: "=",
          value: "missing@example.com",
        },
      },
    },
  };

  const compiled = await new VoidQL({ db, user: local_user, role, structure }).compile(request);
  const result = await compiled.execute();

  console.log("not exists result:", result);

  expect(result).toBeDefined();
  expect(result.ok).toBe(true);
}
