import {
	pgTable,
	uuid,
	serial,
	varchar,
	timestamp,
	boolean,
	pgEnum,
	text,
	jsonb,
} from 'drizzle-orm/pg-core';

export const profiles = pgTable('profiles', {
	userId: uuid('user_id').primaryKey().notNull(),
	email: varchar('email', { length: 255 }).notNull(),
	username: varchar('username', { length: 255 }),
	createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const blockCategory = pgEnum('block_category', ['footer', 'header', 'hero', 'info']);

export const blocks = pgTable('blocks', {
	id: serial('id').primaryKey(),
	name: varchar('name', { length: 255 }).notNull(),
	category: blockCategory('category').notNull(),
	isActive: boolean('is_active').default(true).notNull(),
	archiveUrl: varchar('archive_url', { length: 1024 }).notNull(),
	definition: jsonb('definition').notNull(),
	description: text('description'),
	createdBy: uuid('created_by')
		.notNull()
		.references(() => profiles.userId),
	updatedBy: uuid('updated_by').references(() => profiles.userId, {
		onDelete: 'set null',
	}),
	createdAt: timestamp('created_at').defaultNow().notNull(),
	updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const templates = pgTable('templates', {
	id: serial('id').primaryKey(),
	name: varchar('name', { length: 255 }).notNull(),
	fileName: varchar('file_name', { length: 255 }).notNull(),
	isActive: boolean('is_active').default(true).notNull(),
	// archiveUrl: varchar("archive_url", { length: 1024 }).notNull(),
	definition: jsonb('definition').notNull(),
	createdBy: uuid('created_by')
		.notNull()
		.references(() => profiles.userId),
	updatedBy: uuid('updated_by').references(() => profiles.userId, {
		onDelete: 'set null',
	}),
	createdAt: timestamp('created_at').defaultNow().notNull(),
	updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const sites = pgTable('sites', {
	id: serial('id').primaryKey(),
	name: varchar('name', { length: 255 }).notNull(),
	isActive: boolean('is_active').default(true).notNull(),
	trafficSource: varchar('traffic_source', { length: 255 }).notNull(),
	country: varchar('country', { length: 255 }).notNull(),
	language: varchar('language', { length: 255 }).notNull(),
	archiveUrl: varchar('archive_url', { length: 1024 }).notNull(),
	definition: jsonb('definition').notNull(),
	prompt: varchar('prompt', { length: 255 }).notNull(),
	createdBy: uuid('created_by')
		.notNull()
		.references(() => profiles.userId),
	updatedBy: uuid('updated_by').references(() => profiles.userId, {
		onDelete: 'set null',
	}),
	createdAt: timestamp('created_at').defaultNow().notNull(),
	updatedAt: timestamp('updated_at').defaultNow().notNull(),
});
