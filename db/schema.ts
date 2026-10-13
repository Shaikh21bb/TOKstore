import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
export const catalogItems=sqliteTable('catalog_items',{id:text('id').primaryKey(),data:text('data').notNull(),published:integer('published').notNull().default(1),version:integer('version').notNull().default(1),updatedAt:text('updated_at').notNull()});
export const catalogSettings=sqliteTable('catalog_settings',{key:text('key').primaryKey(),value:text('value').notNull()});
