CREATE TABLE "cosai"."ergebnis_bezuege" (
	"ergebnis_id" text NOT NULL,
	"typ" text NOT NULL,
	"ref_id" text NOT NULL,
	"bezeichnung" text DEFAULT '' NOT NULL,
	CONSTRAINT "ergebnis_bezuege_ergebnis_id_typ_ref_id_pk" PRIMARY KEY("ergebnis_id","typ","ref_id")
);
--> statement-breakpoint
ALTER TABLE "cosai"."ergebnis_bezuege" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cosai"."ergebnisse" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"nutzer" text NOT NULL,
	"titel" text NOT NULL,
	"art" text DEFAULT 'sonstiges' NOT NULL,
	"inhalt" text NOT NULL,
	"quellen" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"frage" text,
	"werkzeuge" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"modell" text,
	"sitzung_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cosai"."ergebnisse" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cosai"."ergebnis_bezuege" ADD CONSTRAINT "ergebnis_bezuege_ergebnis_id_ergebnisse_id_fk" FOREIGN KEY ("ergebnis_id") REFERENCES "cosai"."ergebnisse"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cosai_ergebnis_bezuege_ref" ON "cosai"."ergebnis_bezuege" USING btree ("typ","ref_id");--> statement-breakpoint
CREATE INDEX "cosai_ergebnisse_zeit" ON "cosai"."ergebnisse" USING btree ("created_at");