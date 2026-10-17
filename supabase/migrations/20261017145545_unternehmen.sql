CREATE TABLE "fach"."unternehmen" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"name_normiert" text NOT NULL,
	"rechtsform" text,
	"domain" text,
	"webseite" text,
	"strasse" text,
	"plz" text,
	"ort" text,
	"tel" text,
	"fax" text,
	"email" text,
	"notizen" text,
	"quelle" text,
	"geprueft_am" timestamp with time zone,
	"reihenfolge" bigint DEFAULT (-(extract(epoch from clock_timestamp()) * 1000000))::bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fach"."unternehmen" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "fach"."makler" ADD COLUMN "unternehmen_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "unternehmen_name_normiert_idx" ON "fach"."unternehmen" USING btree ("name_normiert") WHERE "fach"."unternehmen"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "unternehmen_domain_idx" ON "fach"."unternehmen" USING btree ("domain");--> statement-breakpoint
ALTER TABLE "fach"."makler" ADD CONSTRAINT "makler_unternehmen_id_unternehmen_id_fk" FOREIGN KEY ("unternehmen_id") REFERENCES "fach"."unternehmen"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "makler_unternehmen_idx" ON "fach"."makler" USING btree ("unternehmen_id");