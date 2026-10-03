import { expect } from "vitest";
import { VoidQL } from "../../src";

export default async function selectGroupOrder(
  db,
  structure,
  local_user,
  role
) {
  const request = {
    type: "GET",
    select: ["have_access", "$count.id"],
    table: "users",
    group_by: "have_access",
    order_by: "have_access",
  };

  const compiled = await new VoidQL({ db, user: local_user, role, structure }).compile(request);
  const result = await compiled.execute();

  console.log("group/order result:", result);

  expect(result).toBeDefined();
  expect(result.ok).toBe(true);
}
