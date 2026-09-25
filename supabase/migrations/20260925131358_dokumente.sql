CREATE TABLE "fach"."dokumente" (
	"id" text PRIMARY KEY NOT NULL,
	"deal_id" text,
	"objekt_id" text,
	"dateiname" text,
	"mime_type" text,
	"groesse_bytes" bigint,
	"label" text,
	"ist_expose" boolean,
	"ablage" text DEFAULT 'supabase' NOT NULL,
	"bucket" text DEFAULT 'deal-docs' NOT NULL,
	"storage_key" text,
	"sp_item_id" text,
	"sp_pfad" text,
	"sp_web_url" text,
	"sp_etag" text,
	"hochgeladen_am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dokumente_bezug_check" CHECK ("fach"."dokumente"."deal_id" is not null or "fach"."dokumente"."objekt_id" is not null),
	CONSTRAINT "dokumente_ablage_check" CHECK ("fach"."dokumente"."ablage" in ('supabase', 'sharepoint'))
);
--> statement-breakpoint
ALTER TABLE "fach"."dokumente" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
-- Bestand übernehmen: jedes Deal-Dokument wird ein Dokument mit Bezug Deal, Ablage Supabase, Bucket deal-docs
INSERT INTO "fach"."dokumente" ("id", "deal_id", "objekt_id", "dateiname", "mime_type", "groesse_bytes", "label", "ist_expose", "ablage", "bucket", "storage_key", "hochgeladen_am")
SELECT d."id", d."deal_id", x."objekt_id", d."dateiname", d."mime_type", d."groesse_bytes", d."label", d."ist_expose", 'supabase', 'deal-docs', d."storage_key", d."hochgeladen_am"
FROM "fach"."deal_dokumente" d LEFT JOIN "fach"."deals" x ON x."id" = d."deal_id";--> statement-breakpoint
DROP TABLE "fach"."deal_dokumente" CASCADE;--> statement-breakpoint
ALTER TABLE "fach"."dokumente" ADD CONSTRAINT "dokumente_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "fach"."deals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fach"."dokumente" ADD CONSTRAINT "dokumente_objekt_id_objekte_id_fk" FOREIGN KEY ("objekt_id") REFERENCES "fach"."objekte"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dokumente_objekt_idx" ON "fach"."dokumente" USING btree ("objekt_id");--> statement-breakpoint
CREATE INDEX "dokumente_deal_idx" ON "fach"."dokumente" USING btree ("deal_id");