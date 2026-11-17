CREATE TABLE "nova"."accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"password" text,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"scope" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "nova"."audit_events" (
	"id" text PRIMARY KEY NOT NULL,
	"actor_id" text NOT NULL,
	"action" text NOT NULL,
	"document_id" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "nova"."bom_lines" (
	"id" text PRIMARY KEY NOT NULL,
	"bom_id" text NOT NULL,
	"item_id" text NOT NULL,
	"quantity" numeric(20, 6) NOT NULL,
	"unit" text NOT NULL,
	CONSTRAINT "bom_quantity_positive" CHECK ("nova"."bom_lines"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "nova"."bom_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"product_id" text NOT NULL,
	"revision" integer NOT NULL,
	"batch_size" numeric(20, 6) NOT NULL,
	"expected_output" numeric(20, 6) NOT NULL,
	"output_unit" text NOT NULL,
	"active" boolean DEFAULT false NOT NULL,
	"published_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bom_positive" CHECK ("nova"."bom_versions"."revision" > 0 and "nova"."bom_versions"."batch_size" > 0 and "nova"."bom_versions"."expected_output" > 0),
	CONSTRAINT "bom_output_packet" CHECK ("nova"."bom_versions"."output_unit" = 'packet')
);
--> statement-breakpoint
CREATE TABLE "nova"."customers" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"state" text NOT NULL,
	"address" text NOT NULL,
	"territory_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customers_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "nova"."inventory_items" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"base_unit" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_items_name_unique" UNIQUE("name"),
	CONSTRAINT "item_kind" CHECK ("nova"."inventory_items"."kind" in ('raw','packaging','finished')),
	CONSTRAINT "item_base_unit" CHECK ("nova"."inventory_items"."base_unit" in ('g','ml','piece','packet'))
);
--> statement-breakpoint
CREATE TABLE "nova"."product_prices" (
	"id" text PRIMARY KEY NOT NULL,
	"product_id" text NOT NULL,
	"amount" numeric(20, 2) NOT NULL,
	"gst_percent" numeric(5, 2) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_prices_product_id_unique" UNIQUE("product_id"),
	CONSTRAINT "price_valid" CHECK ("nova"."product_prices"."amount" > 0 and "nova"."product_prices"."gst_percent" >= 0 and "nova"."product_prices"."gst_percent" <= 100)
);
--> statement-breakpoint
CREATE TABLE "nova"."products" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"item_id" text NOT NULL,
	"pack_grams" numeric(20, 6) NOT NULL,
	"carton_capacity" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_name_unique" UNIQUE("name"),
	CONSTRAINT "products_item_id_unique" UNIQUE("item_id"),
	CONSTRAINT "product_pack_positive" CHECK ("nova"."products"."pack_grams" > 0 and "nova"."products"."carton_capacity" > 0)
);
--> statement-breakpoint
CREATE TABLE "nova"."roles" (
	"code" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "role_code" CHECK ("nova"."roles"."code" in ('salesman','admin','production','auditor','owner'))
);
--> statement-breakpoint
CREATE TABLE "nova"."sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "nova"."suppliers" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"state" text NOT NULL,
	"address" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "suppliers_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "nova"."territories" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"salesman_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "territories_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "nova"."units" (
	"code" text PRIMARY KEY NOT NULL,
	"dimension" text NOT NULL,
	"base_factor" numeric(20, 6) NOT NULL,
	CONSTRAINT "unit_positive" CHECK ("nova"."units"."base_factor" > 0),
	CONSTRAINT "unit_dimension" CHECK ("nova"."units"."dimension" in ('mass','volume','piece','packet','carton'))
);
--> statement-breakpoint
CREATE TABLE "nova"."users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "nova"."user_roles" (
	"user_id" text PRIMARY KEY NOT NULL,
	"role" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "nova"."verifications" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "nova"."accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "nova"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nova"."audit_events" ADD CONSTRAINT "audit_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "nova"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nova"."bom_lines" ADD CONSTRAINT "bom_lines_bom_id_bom_versions_id_fk" FOREIGN KEY ("bom_id") REFERENCES "nova"."bom_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nova"."bom_lines" ADD CONSTRAINT "bom_lines_item_id_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "nova"."inventory_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nova"."bom_lines" ADD CONSTRAINT "bom_lines_unit_units_code_fk" FOREIGN KEY ("unit") REFERENCES "nova"."units"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nova"."bom_versions" ADD CONSTRAINT "bom_versions_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "nova"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nova"."bom_versions" ADD CONSTRAINT "bom_versions_output_unit_units_code_fk" FOREIGN KEY ("output_unit") REFERENCES "nova"."units"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nova"."bom_versions" ADD CONSTRAINT "bom_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "nova"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nova"."customers" ADD CONSTRAINT "customers_territory_id_territories_id_fk" FOREIGN KEY ("territory_id") REFERENCES "nova"."territories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nova"."inventory_items" ADD CONSTRAINT "inventory_items_base_unit_units_code_fk" FOREIGN KEY ("base_unit") REFERENCES "nova"."units"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nova"."product_prices" ADD CONSTRAINT "product_prices_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "nova"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nova"."products" ADD CONSTRAINT "products_item_id_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "nova"."inventory_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nova"."sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "nova"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nova"."territories" ADD CONSTRAINT "territories_salesman_id_users_id_fk" FOREIGN KEY ("salesman_id") REFERENCES "nova"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nova"."user_roles" ADD CONSTRAINT "user_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "nova"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nova"."user_roles" ADD CONSTRAINT "user_roles_role_roles_code_fk" FOREIGN KEY ("role") REFERENCES "nova"."roles"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "account_provider_unique" ON "nova"."accounts" USING btree ("provider_id","account_id");--> statement-breakpoint
CREATE INDEX "accounts_user_idx" ON "nova"."accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "audit_document_idx" ON "nova"."audit_events" USING btree ("document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bom_component_unique" ON "nova"."bom_lines" USING btree ("bom_id","item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bom_revision_unique" ON "nova"."bom_versions" USING btree ("product_id","revision");--> statement-breakpoint
CREATE UNIQUE INDEX "bom_active_unique" ON "nova"."bom_versions" USING btree ("product_id") WHERE "nova"."bom_versions"."active" = true;--> statement-breakpoint
CREATE INDEX "customer_territory_idx" ON "nova"."customers" USING btree ("territory_id");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "nova"."sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "territory_salesman_idx" ON "nova"."territories" USING btree ("salesman_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "nova"."verifications" USING btree ("identifier");