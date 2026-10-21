CREATE TABLE "fach"."makler_recherche" (
	"makler_id" text PRIMARY KEY NOT NULL,
	"webseite" text,
	"webseite_quelle" text,
	"webseite_am" timestamp with time zone,
	"immoscout_url" text,
	"immoscout_quelle" text,
	"immoscout_am" timestamp with time zone,
	"person_url" text,
	"status" text,
	"letzte_recherche_am" timestamp with time zone,
	"kosten_eur" numeric(10, 4) DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fach"."makler_recherche" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "fach"."recherche_ergebnisse" (
	"id" text PRIMARY KEY NOT NULL,
	"lauf_id" text NOT NULL,
	"makler_id" text NOT NULL,
	"status" text DEFAULT 'wartet' NOT NULL,
	"schritte" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"vorschlaege" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"kosten_eur" numeric(10, 4) DEFAULT 0 NOT NULL,
	"fehler" text,
	"begonnen_am" timestamp with time zone,
	"beendet_am" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fach"."recherche_ergebnisse" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "fach"."recherche_laeufe" (
	"id" text PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'laeuft' NOT NULL,
	"mit_ki" boolean DEFAULT false NOT NULL,
	"anzahl" integer NOT NULL,
	"kosten_eur" numeric(10, 4) DEFAULT 0 NOT NULL,
	"gestartet_von" text,
	"beendet_am" timestamp with time zone,
	"gesehen_am" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fach"."recherche_laeufe" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "fach"."makler_recherche" ADD CONSTRAINT "makler_recherche_makler_id_makler_id_fk" FOREIGN KEY ("makler_id") REFERENCES "fach"."makler"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fach"."recherche_ergebnisse" ADD CONSTRAINT "recherche_ergebnisse_lauf_id_recherche_laeufe_id_fk" FOREIGN KEY ("lauf_id") REFERENCES "fach"."recherche_laeufe"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fach"."recherche_ergebnisse" ADD CONSTRAINT "recherche_ergebnisse_makler_id_makler_id_fk" FOREIGN KEY ("makler_id") REFERENCES "fach"."makler"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "recherche_ergebnisse_lauf_idx" ON "fach"."recherche_ergebnisse" USING btree ("lauf_id","status");--> statement-breakpoint
CREATE INDEX "recherche_ergebnisse_makler_idx" ON "fach"."recherche_ergebnisse" USING btree ("makler_id");