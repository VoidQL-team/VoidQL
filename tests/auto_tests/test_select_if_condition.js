import { expect } from "vitest";
import { VoidQL } from "../../src";

export default async function selectIfCondition(
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
      if: {
        when: {
          field: "have_access",
          op: "=",
          value: 1,
        },
        do: {
          field: "id",
          op: "=",
          value: 1,
        },
        else: {
          field: "id",
          op: "=",
          value: 2,
        },
      },
    },
  };

  const compiled = await new VoidQL({ db, user: local_user, role, structure }).compile(request);
  const result = await compiled.execute();

  console.log("if condition result:", result);

  expect(result).toBeDefined();
  expect(result.ok).toBe(true);
}
