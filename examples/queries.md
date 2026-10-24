# Queries

## Contents

- [Runtime Tokens](#runtime-tokens)
- [Basic Queries](#basic-queries)
- [Subqueries](#subqueries)
- [Joins](#joins)
- [Aggregation](#aggregation)
- [Pagination](#pagination)
- [Inserts](#inserts)
- [Updates](#updates)
- [Deletes](#deletes)
- [Runtime Variables](#runtime-variables)
- [Workflows](#workflows)
- [Enterprise Examples](#enterprise-examples)

## Runtime Tokens

The query engine supports special runtime tokens.

Token names are case-insensitive. Aggregate tokens support snake_case and legacy camelCase forms, such as `$count_distinct` and `$countDistinct`.

| Token                  | Description                      |
| ---------------------- | -------------------------------- |
| `$user.field`          | Access authenticated user fields |
| `$data.field`          | Access incoming mutation data    |
| `$col.field`           | Reference another column         |
| `$count.field`         | Aggregate count                  |
| `$countDistinct.field` | Aggregate distinct count         |
| `$sum.field`           | Aggregate sum                    |
| `$sumDistinct.field`   | Aggregate distinct sum           |
| `$avg.field`           | Aggregate average                |
| `$avgDistinct.field`   | Aggregate distinct average       |
| `$min.field`           | Aggregate minimum                |
| `$max.field`           | Aggregate maximum                |
| `$asc.field`           | Ascending ordering               |
| `$desc.field`          | Descending ordering              |

---

## Basic Queries

### 1. Basic GET

```ts
const query: StructuredQuery = {
  table: "users",
  select: "*",
  type: "GET",
};
```

---

### 2. GET With Field Selection

```ts
const query: StructuredQuery = {
  table: "users",
  type: "GET",
  select: ["id", "email", "created_at"],
};
```

---

### 3. Simple WHERE

```ts
const query: StructuredQuery = {
  table: "users",
  type: "GET",
  select: "*",

  where: {
    field: "email",
    operator: "=",
    value: "john@example.com",
  },
};
```

---

### 4. Multiple AND Conditions

```ts
const query: StructuredQuery = {
  table: "users",
  type: "GET",
  select: "*",

  where: {
    and: [
      {
        field: "verified",
        operator: "=",
        value: true,
      },
      {
        field: "age",
        operator: ">=",
        value: 18,
      },
    ],
  },
};
```

---

### 5. Nested AND / OR

```ts
const query: StructuredQuery = {
  table: "users",
  type: "GET",
  select: "*",

  where: {
    and: [
      {
        field: "active",
        operator: "=",
        value: true,
      },

      {
        or: [
          {
            field: "role",
            operator: "=",
            value: "admin",
          },

          {
            field: "role",
            operator: "=",
            value: "moderator",
          },
        ],
      },
    ],
  },
};
```

---

### 6. NOT Condition

```ts
const query: StructuredQuery = {
  table: "users",
  type: "GET",
  select: "*",

  where: {
    not: {
      field: "banned",
      operator: "=",
      value: true,
    },
  },
};
```

---

### 7. BETWEEN

```ts
const query: StructuredQuery = {
  table: "orders",
  type: "GET",
  select: "*",

  where: {
    field: "total",
    operator: "BETWEEN",
    start: 100,
    end: 500,
  },
};
```

---

### 8. IN Operator

```ts
const query: StructuredQuery = {
  table: "users",
  type: "GET",
  select: "*",

  where: {
    field: "role",
    operator: "IN",
    value: ["admin", "editor", "staff"],
  },
};
```

---

### 9. NOT IN Operator

```ts
const query: StructuredQuery = {
  table: "users",
  type: "GET",
  select: "*",

  where: {
    field: "role",
    operator: "NOT IN",
    value: ["banned", "suspended"],
  },
};
```

---

### 10. LIKE

```ts
const query: StructuredQuery = {
  table: "users",
  type: "GET",
  select: "*",

  where: {
    field: "email",
    operator: "LIKE",
    value: "%gmail.com",
  },
};
```

---

### 11. NULL Checks

```ts
const query: StructuredQuery = {
  table: "users",
  type: "GET",
  select: "*",

  where: {
    field: "deleted_at",
    operator: "IS NULL",
  },
};
```

---

## Subqueries

### 12. Subquery IN

```ts
const query: StructuredQuery = {
  table: "users",
  type: "GET",
  select: "*",

  where: {
    field: "id",
    operator: "IN",

    value: {
      select: "user_id",
      from: "orders",

      where: {
        field: "status",
        operator: "=",
        value: "completed",
      },
    },
  },
};
```

---

### 13. EXISTS Query

```ts
const query: StructuredQuery = {
  table: "users",
  type: "GET",
  select: "*",

  where: {
    operator: "EXISTS",

    query: {
      select: "id",
      from: "orders",

      where: {
        field: "orders.user_id",
        operator: "=",
        value: "$col.id",
      },
    },
  },
};
```

---

### 14. NOT EXISTS

```ts
const query: StructuredQuery = {
  table: "users",
  type: "GET",
  select: "*",

  where: {
    operator: "NOT EXISTS",

    query: {
      select: "id",
      from: "sessions",

      where: {
        field: "sessions.user_id",
        operator: "=",
        value: "$col.id",
      },
    },
  },
};
```

---

## Joins

### 15. LEFT JOIN

```ts
const query: StructuredQuery = {
  table: "orders",
  type: "GET",
  select: "*",

  join: [
    {
      table: "users",
      type: "LEFT",

      on: {
        "orders.user_id": "users.id",
      },
    },
  ],
};
```

---

### 16. Complex JOIN Condition

```ts
const query: StructuredQuery = {
  table: "orders",
  type: "GET",
  select: "*",

  join: [
    {
      table: "payments",
      type: "INNER",

      on: {
        and: [
          {
            field: "orders.id",
            operator: "=",
            value: "$col.payments.order_id",
          },

          {
            field: "payments.status",
            operator: "=",
            value: "paid",
          },
        ],
      },
    },
  ],
};
```

---

### 17. Conditional JOIN

```ts
const query: StructuredQuery = {
  table: "users",
  type: "GET",
  select: "*",

  join: [
    {
      table: "subscriptions",
      type: "LEFT",

      on: {
        and: [
          {
            field: "subscriptions.user_id",
            operator: "=",
            value: "$col.users.id",
          },

          {
            field: "subscriptions.active",
            operator: "=",
            value: true,
          },
        ],
      },
    },
  ],
};
```

---

## Aggregation

### 18. GROUP BY + ORDER BY

```ts
const query: StructuredQuery = {
  table: "orders",
  type: "GET",

  select: [
    "user_id",
    "$count.total_orders",
  ],

  group_by: ["user_id"],

  order_by: ["$desc.revenue"],
};
```

---

### 19. Aggregate Functions

```ts
const query: StructuredQuery = {
  table: "orders",
  type: "GET",

  select: [
    "$count.id",
    "$sum.total",
    "$avg.total",
    "$min.total",
    "$max.total",
  ],
};
```

---

### 20. HAVING

```ts
const query: StructuredQuery = {
  table: "orders",
  type: "GET",

  select: [
    "user_id",
    "$count.id",
  ],

  group_by: ["user_id"],

  having: {
    field: "$count.id",
    operator: ">",
    value: 5,
  },
};
```

---

## Pagination

### 21. Pagination Style Query

```ts
const query: StructuredQuery = {
  table: "posts",
  type: "GET",
  select: "*",

  where: {
    field: "id",
    operator: ">",
    value: 100,
  },

  order_by: ["$asc.id"],

  limit: 25,
  offset: 0,
};
```

---

## Inserts

### 22. INSERT Single Row

```ts
const query: StructuredQuery = {
  table: "users",
  type: "POST",

  data: {
    email: "alice@example.com",
    name: "Alice",
    role: "user",
  },
};
```

---

### 23. INSERT Multiple Rows

```ts
const query: StructuredQuery = {
  table: "tags",
  type: "POST",

  data: [
    { name: "typescript" },
    { name: "drizzle" },
    { name: "backend" },
  ],
};
```

---

### 24. INSERT With returning

```ts
const query: StructuredQuery = {
  table: "users",
  type: "POST",

  data: {
    email: "john@example.com",
    name: "John",
  },

  returning: ["id", "email"],
};
```

---

## Updates

### 25. UPDATE

```ts
const query: StructuredQuery = {
  table: "users",
  type: "PUT",

  data: {
    verified: true,
  },

  where: {
    field: "id",
    operator: "=",
    value: 15,
  },
};
```

---

### 26. Conditional UPDATE Logic

```ts
const query: StructuredQuery = {
  table: "users",
  type: "PUT",

  data: {
    role: "premium",
  },

  where: {
    if: {
      when: {
        field: "purchases",
        operator: ">=",
        value: 10,
      },

      do: true,
      else: false,
    },
  },
};
```

---

### 27. Soft Delete Pattern

```ts
const query: StructuredQuery = {
  table: "users",
  type: "PUT",

  data: {
    deleted_at: new Date(),
    active: false,
  },

  where: {
    field: "id",
    operator: "=",
    value: 44,
  },
};
```

---

## Deletes

### 28. DELETE

```ts
const query: StructuredQuery = {
  table: "sessions",
  type: "DELETE",

  where: {
    field: "expires_at",
    operator: "<",
    value: new Date(),
  },
};
```

---

## Runtime Variables

### 29. User Runtime Variables

```ts
const query: StructuredQuery = {
  table: "posts",
  type: "GET",
  select: "*",

  where: {
    field: "author_id",
    operator: "=",
    value: "$user.id",
  },
};
```

---

### 30. Data Runtime Variables

```ts
const query: StructuredQuery = {
  table: "users",
  type: "PUT",

  data: {
    email: "john@example.com",
  },

  where: {
    field: "email",
    operator: "!=",
    value: "$data.email",
  },
};
```

---

### 31. Column-to-Column Comparison

```ts
const query: StructuredQuery = {
  table: "products",
  type: "GET",
  select: "*",

  where: {
    field: "stock",
    operator: "<=",
    value: "$col.min_stock",
  },
};
```

---

## Workflows

### 32. Chained AFTER Queries

```ts
const query: StructuredQuery = {
  table: "orders",
  type: "POST",
  select: "*",

  data: {
    user_id: 1,
    total: 250,
  },

  after: [
    {
      table: "notifications",
      type: "POST",

      data: {
        user_id: 1,
        message: "Your order was created",
      },
    },

    {
      table: "analytics",
      type: "POST",

      data: {
        event: "order_created",
      },
    },
  ],
};
```

---

### 33. Recursive Conditional Workflow

```ts
const query: StructuredQuery = {
  table: "tickets",
  type: "PUT",

  data: {
    status: "resolved",
  },

  where: {
    field: "id",
    operator: "=",
    value: 55,
  },

  after: [
    {
      table: "notifications",
      type: "POST",

      data: {
        user_id: "$data.user_id",
        message: "Ticket resolved",
      },
    },

    {
      table: "audit_logs",
      type: "POST",

      data: {
        action: "ticket_resolved",
        performed_by: "$user.id",
      },
    },
  ],
};
```

---

## Enterprise Examples

### 34. Full Enterprise Query

```ts
const query: StructuredQuery = {
  table: "orders",
  type: "GET",

  select: [
    "orders.id",
    "orders.total",
    "users.email",
    "$count.items.id",
  ],

  join: [
    {
      table: "users",
      type: "INNER",

      on: {
        "orders.user_id": "users.id",
      },
    },

    {
      table: "items",
      type: "LEFT",

      on: {
        "orders.id": "items.order_id",
      },
    },
  ],

  where: {
    and: [
      {
        field: "orders.status",
        operator: "=",
        value: "completed",
      },

      {
        field: "orders.user_id",
        operator: "=",
        value: "$user.id",
      },

      {
        or: [
          {
            field: "orders.total",
            operator: ">",
            value: 1000,
          },

          {
            field: "orders.priority",
            operator: "=",
            value: "high",
          },
        ],
      },

      {
        field: "orders.id",
        operator: "IN",

        value: {
          select: "order_id",
          from: "payments",

          where: {
            field: "status",
            operator: "=",
            value: "paid",
          },
        },
      },
    ],
  },

  group_by: [
    "orders.id",
    "users.email",
  ],

  order_by: [
    "$desc.orders.created_at",
    "$desc.orders.total",
  ],

  returning: [
    "orders.id",
    "users.email",
  ],
};
```

---

### 35. Row-Level Security Pattern

```ts
const query: StructuredQuery = {
  table: "documents",
  type: "GET",
  select: "*",

  where: {
    or: [
      {
        field: "owner_id",
        operator: "=",
        value: "$user.id",
      },

      {
        field: "visibility",
        operator: "=",
        value: "public",
      },

      {
        field: "team_id",
        operator: "IN",

        value: {
          select: "team_id",
          from: "team_members",

          where: {
            field: "user_id",
            operator: "=",
            value: "$user.id",
          },
        },
      },
    ],
  },
};
```
