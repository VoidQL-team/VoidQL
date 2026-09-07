import { int, mysqlTable, text, tinyint, varchar } from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";

export const users = mysqlTable('users', {
    id: int("id").primaryKey().autoincrement(),
    name: varchar('name', { length: 50 }).notNull(),
    surname: varchar('surname', { length: 50 }).notNull(),
    age: int('age'),
    email: varchar('email', { length: 255 }).default(sql`NULL`),
    have_access: tinyint('have_access').notNull().default(0)
});