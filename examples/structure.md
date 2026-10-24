# Complete Structure Examples

This document demonstrates the full capability of the structure system:

- endpoints
- roles
- allow/disallow semantics
- conditional field access
- triggers
- runtime variables
- limits
- returning
- row-level constraints

## Contents

- [Minimal Structure](#1-minimal-structure)
- [Wildcard Access](#2-wildcard-access)
- [Simple Role Split](#3-simple-role-split-user-vs-admin)
- [Field-Level Deny Override](#4-field-level-deny-override)
- [Conditional Allowed Fields](#5-conditional-allowed-fields)
- [Conditional Wildcard Allow](#6-conditional-wildcard-allow)
- [Complex Where Conditions](#7-complex-where-conditions-multi-condition-field-gating)
- [Role-Based Limits and Ordering](#8-role-based-limits-and-ordering)
- [Returning Control](#9-returning-control)
- [Endpoint Get Example](#10-endpoint-get-full-example)
- [Update Field Validation](#11-update-with-strict-field-validation)
- [Insert Role Control](#12-insert-with-role-control)
- [Restricted Delete](#13-delete-restricted)
- [Before Triggers](#14-before-triggers-row-mutation)
- [After Triggers](#15-after-triggers-audit-side-effects)
- [Full Structure Example](#16-full-enterprise-structure)
- [Summary](#summary)

## 1. Minimal Structure

```ts
export default {
  users: {
    table: "users",

    endpoints: [
      {
        type: "GET",

        user: {
          allow: ["id", "name", "email"],
          disallowed: [],
        },
      },
    ],
  },
};
```

---

## 2. Wildcard Access

```ts
{
  user: {
    allow: "*",
    disallowed: [],
  },
}
```

---

## 3. Simple Role Split (User vs Admin)

```ts
{
  user: {
    allow: ["id", "name", "email"],
    disallowed: ["role"],
  },

  admin: {
    allow: "*",
    disallowed: [],
  },
}
```

---

## 4. Field-Level Deny Override

```ts
{
  user: {
    allow: "*",
    disallowed: ["password", "secret_key"],
  },
}
```

---

## 5. Conditional Allowed Fields

```ts
{
  user: {
    allow: {
      field: ["salary"],

      where: {
        field: "department",
        op: "=",
        value: "finance",
      },
    },

    disallowed: [],
  },
}
```

---

## 6. Conditional Wildcard Allow

```ts
{
  admin: {
    allow: {
      field: "*",

      where: {
        left_value: "$user.have_access",
        op: "=",
        value: 1,
      },
    },

    disallowed: [],
  },
}
```

---

## 7. Complex WHERE Conditions (Multi-condition Field Gating)

```ts
{
  user: {
    allow: {
      field: ["name", "surname"],

      where: {
        and: [
          {
            field: "id",
            op: "=",
            value: "$user.id",
          },

          {
            left_value: "$user.have_access",
            op: "=",
            value: 1,
          },

          {
            if: {
              when: {
                value: "$data.name",
                op: "IS NOT NULL",
              },
              do: true,
              else: false,
            },
          },
        ],
      },
    },

    disallowed: ["*"],
  },
}
```

---

## 8. Role-Based Limits and Ordering

```ts
{
  public: {
    allow: ["id", "name"],

    limit: 10,

    order_by: ["$desc.created_at"],
  },

  premium: {
    allow: "*",
    limit: 100,
    order_by: ["$desc.created_at"],
  },
}
```

---

## 9. Returning Control

```ts
{
  user: {
    allow: ["id", "email"],

    returning: true,
  },

  admin: {
    allow: "*",
    returning: true,
  },
}
```

---

## 10. Endpoint GET Full Example

```ts
{
  type: "GET",

  user: {
    allow: ["id", "name", "email", "surname"],
    disallowed: ["role"],
  },

  admin: {
    allow: {
      field: "*",
      where: {
        left_value: "$user.have_access",
        op: "=",
        value: 1,
      },
    },

    disallowed: "name",
    limit: 10,
  },
}
```

---

## 11. Update with Strict Field Validation

```ts
{
  type: "PUT",

  user: {
    allow: {
      field: ["name", "surname"],

      where: {
        and: [
          {
            field: "id",
            op: "=",
            value: "$user.id",
          },

          {
            left_value: "$user.have_access",
            op: "=",
            value: 1,
          },
        ],
      },
    },

    disallowed: "*",
  },

  admin: {
    allow: "*",
    disallowed: [],
    returning: true,
  },
}
```

---

## 12. Insert with Role Control

```ts
{
  type: "POST",

  user: {
    allow: [],
    disallowed: [],
  },

  admin: {
    allow: "*",
    returning: true,
  },
}
```

---

## 13. Delete (Restricted)

```ts
{
  type: "DELETE",

  user: {
    allow: [],
    disallowed: [],
  },

  admin: {
    allow: "*",
    disallowed: "",
  },
}
```

---

## 14. Before Triggers (Row Mutation)

```ts
{
  type: "POST",

  admin: {
    allow: "*",
  },

  triggers: [
    {
      type: "BEFORE",
      level: "ROW",

      query: {
        set: {
          field: "name",

          when: {
            field: "name",
            op: "IS NULL",
          },

          value: "default_name",
        },
      },
    },

    {
      type: "BEFORE",
      level: "ROW",

      query: {
        set: {
          field: "surname",

          when: {
            field: "surname",
            op: "IS NULL",
          },

          value: "default_surname",
        },
      },
    },
  ],
}
```

---

## 15. After Triggers (Audit / Side Effects)

```ts
{
  type: "POST",

  admin: {
    allow: "*",
  },

  triggers: [
    {
      type: "AFTER",
      level: "ROW",

      query: {
        set: {
          field: "event",

          when: {
            field: "event",
            op: "IS NULL",
          },

          value: "created",
        },
      },
    },
  ],
}
```

---

## 16. Full Enterprise Structure

```ts
export default {
  users: {
    table: "users",

    endpoints: [
      {
        type: "GET",

        user: {
          allow: ["id", "name", "email", "surname"],
          disallowed: ["password"],
        },

        admin: {
          allow: {
            field: "*",
            where: {
              left_value: "$user.have_access",
              op: "=",
              value: 1,
            },
          },

          disallowed: [],
          limit: 10,
          order_by: ["$desc.created_at"],
        },
      },

      {
        type: "PUT",

        user: {
          allow: {
            field: ["name", "surname"],

            where: {
              and: [
                {
                  field: "id",
                  op: "=",
                  value: "$user.id",
                },
                {
                  left_value: "$user.have_access",
                  op: "=",
                  value: 1,
                },
              ],
            },
          },

          disallowed: "*",
        },

        admin: {
          allow: "*",
          disallowed: [],
          returning: true,
        },
      },

      {
        type: "POST",

        user: {
          allow: [],
          disallowed: [],
        },

        admin: {
          allow: "*",
          returning: true,
        },

        triggers: [
          {
            type: "BEFORE",
            level: "ROW",
            query: {
              set: {
                field: "name",
                when: {
                  field: "name",
                  op: "IS NULL",
                },
                value: "default",
              },
            },
          },
        ],
      },

      {
        type: "DELETE",

        user: {
          allow: [],
          disallowed: "",
        },

        admin: {
          allow: "*",
        },
      },
    ],
  },
};
```

---

## Summary

This DSL supports:

- RBAC (roles)
- ABAC (conditional rules)
- field-level security
- deny overrides
- runtime interpolation (`$user`, `$data`, `$col`)
- query-side constraints (`limit`, `order_by`)
- mutation hooks (`BEFORE / AFTER`)
- row-level triggers
- full endpoint modeling
