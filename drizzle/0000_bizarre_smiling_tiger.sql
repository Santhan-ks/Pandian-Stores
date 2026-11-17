CREATE SCHEMA "nova";
--> statement-breakpoint
CREATE TABLE "nova"."system_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
