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
    select: "name",
    table: "users",
    where: {
      and: [
        {
          field: 'have_access',
          op: '!=',
          value: 1
        },
        {
          field: 'email',
          op: 'ILIKE',
          value: '%example.com%'
        },
        {
          field: 'email',
          op: 'NOT ILIKE',
          value: '%@TEST.TEST%'
        },
      ]
    }
  };

  const built_query = await new VoidQL({ db, user: local_user, role, structure }).compile(query);

  const result = await built_query.execute();

  expect(result).toBeDefined();
}