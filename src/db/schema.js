import {
  pgTable,
  uuid,
  serial,
  varchar,
  timestamp,
  boolean,
  pgEnum,
  jsonb,
} from "drizzle-orm/pg-core";

export const profiles = pgTable("profiles", {
  userId: uuid("user_id").primaryKey().notNull(),
  email: varchar("email", { length: 255 }).notNull(),
  username: varchar("username", { length: 255 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const blockCategory = pgEnum("block_category", [
  "footer",
  "header",
  "hero",
  "info",
]);

export const blocks = pgTable("blocks", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  category: blockCategory("category").notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  archiveUrl: varchar("archive_url", { length: 1024 }).notNull(),
  definition: jsonb("definition").notNull(),
  description: varchar("description"),
  createdBy: uuid("created_by")
      .notNull()
      .references(() => profiles.userId),
  updatedBy: uuid("updated_by")
      .references(() => profiles.userId, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
