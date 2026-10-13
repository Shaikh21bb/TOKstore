CREATE TABLE IF NOT EXISTS `clients` (
  `id` text PRIMARY KEY NOT NULL,
  `phone` text NOT NULL UNIQUE,
  `full_name` text NOT NULL,
  `pin_salt` text NOT NULL,
  `pin_hash` text NOT NULL,
  `bonus_balance` integer DEFAULT 0 NOT NULL,
  `registration_date` text NOT NULL,
  `qr_token` text NOT NULL UNIQUE
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `staff` (
  `id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `role` text NOT NULL,
  `pin_salt` text NOT NULL,
  `pin_hash` text NOT NULL,
  `active` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `client_sessions` (
  `token_hash` text PRIMARY KEY NOT NULL,
  `client_id` text NOT NULL,
  `expires_at` text NOT NULL,
  FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `staff_sessions` (
  `token_hash` text PRIMARY KEY NOT NULL,
  `staff_id` text NOT NULL,
  `expires_at` text NOT NULL,
  FOREIGN KEY (`staff_id`) REFERENCES `staff`(`id`) ON UPDATE no action ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `orders` (
  `id` text PRIMARY KEY NOT NULL,
  `date_time` text NOT NULL,
  `client_id` text,
  `total_amount` integer NOT NULL,
  `bonuses_spent` integer DEFAULT 0 NOT NULL,
  `bonuses_earned` integer DEFAULT 0 NOT NULL,
  `payment_method` text NOT NULL,
  `seller_id` text NOT NULL,
  `status` text DEFAULT 'completed' NOT NULL,
  FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE set null,
  FOREIGN KEY (`seller_id`) REFERENCES `staff`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `order_items` (
  `id` text PRIMARY KEY NOT NULL,
  `order_id` text NOT NULL,
  `product_id` text NOT NULL,
  `product_name` text NOT NULL,
  `quantity` integer NOT NULL,
  `price_at_sale` integer NOT NULL,
  `cost_at_sale` integer DEFAULT 0 NOT NULL,
  `subtotal` integer NOT NULL,
  FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `orders_date_idx` ON `orders` (`date_time`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `orders_client_idx` ON `orders` (`client_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `order_items_order_idx` ON `order_items` (`order_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `order_items_product_idx` ON `order_items` (`product_id`);
