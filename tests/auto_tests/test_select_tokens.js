import { expect } from "vitest";
import { VoidQL } from "../../src";

export default async function select(
  db,
  structure,
  local_user,
  role
) {
  const query = {
    type: "GET",
    select: [
      "$count.id",
      "$count_distinct.id",
      "$avg.age",
      "$avg_distinct.age",
      "$max.age",
      "$min.age",
      "$sum.age",
      "$sum_distinct.age",
    ],
    table: "users",
  };

  const built_query = await new VoidQL({ db, user: local_user, role, structure }).compile(query);

  const result = await built_query.execute();

  expect(result).toBeDefined();
}