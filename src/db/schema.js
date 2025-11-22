import {
  pgTable,
  serial,
  varchar,
  timestamp,
  boolean,
  pgEnum,
  jsonb,
} from "drizzle-orm/pg-core";

export const blockCategory = pgEnum("block_category", [
  "footer",
  "header",
  "hero",
]);

export const blocks = pgTable("blocks", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  archiveUrl: varchar("archive_url", { length: 1024 }).notNull(),
  definition: jsonb("definition").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
