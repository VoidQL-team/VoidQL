import { expect } from "vitest";
import { VoidQL } from "../../src";

export default async function select_in_subquery(
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
      field: "id",
      operator: "IN",
      value: {
        select: "id",
        from: "users",
        where: {
          field: "have_access",
          op: "=",
          value: 1,
        },
      },
    },
  };

  const compiled = await new VoidQL({ db, user: local_user, role, structure }).compile(request);
  const result = await compiled.execute();

  console.log("in subquery result:", result);

  expect(result).toBeDefined();
  expect(result.ok).toBe(true);
}
