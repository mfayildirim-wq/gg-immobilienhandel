CREATE TABLE "fach"."firmen_auskuenfte" (
	"domain" text PRIMARY KEY NOT NULL,
	"url" text,
	"felder" jsonb,
	"abgerufen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fach"."firmen_auskuenfte" ENABLE ROW LEVEL SECURITY;