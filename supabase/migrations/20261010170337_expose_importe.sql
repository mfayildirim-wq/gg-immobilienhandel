CREATE TABLE "fach"."expose_importe" (
	"id" text PRIMARY KEY NOT NULL,
	"eingang_key" text,
	"dateiname" text,
	"deal_id" text,
	"objekt_id" text,
	"makler_id" text,
	"schema_version" text NOT NULL,
	"prompt_version" text,
	"modell" text,
	"weg" text,
	"seiten_gelesen" integer,
	"seiten_gesamt" integer,
	"stop_reason" text,
	"input_tokens" integer,
	"output_tokens" integer,
	"dauer_ms" integer,
	"kosten_eur" numeric(10, 4),
	"status" text DEFAULT 'analysiert' NOT NULL,
	"rohdaten" jsonb NOT NULL,
	"analyse" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fach"."expose_importe" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "fach"."import_korrekturen" (
	"id" text PRIMARY KEY NOT NULL,
	"import_id" text NOT NULL,
	"art" text NOT NULL,
	"bezug_id" text NOT NULL,
	"feld" text NOT NULL,
	"ziel" text,
	"ki_wert" jsonb,
	"hand_wert" jsonb,
	"aktion" text NOT NULL,
	"konfidenz" text,
	"prompt_version" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fach"."import_korrekturen" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "fach"."objekt_einheiten" ADD COLUMN "details" jsonb;--> statement-breakpoint
ALTER TABLE "fach"."expose_importe" ADD CONSTRAINT "expose_importe_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "fach"."deals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fach"."expose_importe" ADD CONSTRAINT "expose_importe_objekt_id_objekte_id_fk" FOREIGN KEY ("objekt_id") REFERENCES "fach"."objekte"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fach"."expose_importe" ADD CONSTRAINT "expose_importe_makler_id_makler_id_fk" FOREIGN KEY ("makler_id") REFERENCES "fach"."makler"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fach"."import_korrekturen" ADD CONSTRAINT "import_korrekturen_import_id_expose_importe_id_fk" FOREIGN KEY ("import_id") REFERENCES "fach"."expose_importe"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "expose_importe_objekt_idx" ON "fach"."expose_importe" USING btree ("objekt_id");--> statement-breakpoint
CREATE INDEX "expose_importe_makler_idx" ON "fach"."expose_importe" USING btree ("makler_id");--> statement-breakpoint
CREATE INDEX "expose_importe_deal_idx" ON "fach"."expose_importe" USING btree ("deal_id");