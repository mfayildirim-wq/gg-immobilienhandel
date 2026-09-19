CREATE SCHEMA "fach";
--> statement-breakpoint
CREATE TABLE "fach"."archive_ledger" (
	"bucket" text NOT NULL,
	"key" text NOT NULL,
	"archive_key" text,
	"size_bytes" bigint,
	"source_updated_at" text,
	"mirrored_at" bigint,
	"missing_since" bigint,
	CONSTRAINT "archive_ledger_bucket_key_pk" PRIMARY KEY("bucket","key")
);
--> statement-breakpoint
ALTER TABLE "fach"."archive_ledger" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "fach"."audit_log" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "fach"."audit_log_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"ts" bigint,
	"hash_chain" text,
	"type" text,
	"entity" text,
	"entity_id" text,
	"action" text,
	"collection" text,
	"field_name" text,
	"old_value" text,
	"new_value" text,
	"ai_model" text,
	"ai_function" text,
	"input_tokens" bigint,
	"output_tokens" bigint,
	"cost_eur" double precision,
	"source" text,
	"metadata" text,
	CONSTRAINT "audit_log_hash_chain_unique" UNIQUE("hash_chain")
);
--> statement-breakpoint
ALTER TABLE "fach"."audit_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "fach"."auto_import_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"deal_id" text,
	"started_at" bigint,
	"finished_at" bigint,
	"mail_uid" text,
	"mail_from" text,
	"mail_subject" text,
	"status" text,
	"outcome" text,
	"classification" text,
	"steps_json" text,
	"structured_json" text,
	"pdf_key" text,
	"pdf_filename" text,
	"error_message" text,
	"duration_ms" bigint
);
--> statement-breakpoint
ALTER TABLE "fach"."auto_import_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "fach"."begleitschein_aktionen" (
	"id" text PRIMARY KEY NOT NULL,
	"vorlage_typ" text NOT NULL,
	"row_id" text,
	"sub_id" text,
	"typ" text,
	"label" text,
	"aktiv" boolean,
	"vordruck_id" text,
	"url" text,
	"modul" text,
	"empfaenger" text,
	"betreff" text,
	"analyse_typ" text,
	"daten_quelle" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fach"."begleitschein_aktionen" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "fach"."begleitschein_vorlagen" (
	"typ" text PRIMARY KEY NOT NULL,
	"kopf" text,
	"zeilen" jsonb,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "fach"."begleitschein_vorlagen" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "fach"."begleitscheine" (
	"id" text PRIMARY KEY NOT NULL,
	"vorlage_typ" text NOT NULL,
	"objekt_id" text NOT NULL,
	"deal_id" text,
	"adresse" text,
	"whg_nr" text,
	"name" text,
	"kopf" text,
	"zeilen" jsonb,
	"archiviert_am" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fach"."begleitscheine" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "fach"."dd_checkliste_vorlage" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "fach"."dd_checkliste_vorlage_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"dokument" text,
	"quelle" text,
	"sort" integer
);
--> statement-breakpoint
ALTER TABLE "fach"."dd_checkliste_vorlage" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "fach"."deal_dokumente" (
	"id" text PRIMARY KEY NOT NULL,
	"deal_id" text NOT NULL,
	"dateiname" text,
	"mime_type" text,
	"groesse_bytes" bigint,
	"label" text,
	"ist_expose" boolean,
	"storage_key" text,
	"hochgeladen_am" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fach"."deal_dokumente" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "fach"."deal_einheiten" (
	"id" text PRIMARY KEY NOT NULL,
	"deal_id" text NOT NULL,
	"objekt_einheit_id" text,
	"typ" text,
	"lage" text,
	"zimmer" numeric(4, 1),
	"flaeche_ist" numeric(10, 2),
	"miete_ist" numeric(14, 2),
	"flaeche_soll" numeric(10, 2),
	"miete_soll" numeric(14, 2),
	"rendite_k" numeric(7, 4),
	"bewertung" jsonb,
	"sort" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fach"."deal_einheiten" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "fach"."deal_kalk_varianten" (
	"id" text PRIMARY KEY NOT NULL,
	"deal_id" text NOT NULL,
	"name" text,
	"kalkulation" jsonb,
	"einheiten" jsonb,
	"sanierungen" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fach"."deal_kalk_varianten" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "fach"."deal_kommentare" (
	"id" text PRIMARY KEY NOT NULL,
	"deal_id" text NOT NULL,
	"zeitpunkt" timestamp with time zone DEFAULT now(),
	"text" text,
	"autor" text
);
--> statement-breakpoint
ALTER TABLE "fach"."deal_kommentare" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "fach"."deal_sanierungen" (
	"id" text PRIMARY KEY NOT NULL,
	"deal_id" text NOT NULL,
	"beschreibung" text,
	"betrag" numeric(14, 2),
	"sort" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fach"."deal_sanierungen" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "fach"."deal_status_historie" (
	"id" text PRIMARY KEY NOT NULL,
	"deal_id" text NOT NULL,
	"von_status" text,
	"nach_status" text,
	"am" timestamp with time zone DEFAULT now() NOT NULL,
	"quelle" text,
	"grund" text,
	CONSTRAINT "deal_status_historie_nach_check" CHECK ("fach"."deal_status_historie"."nach_status" in ('In Prüfung', 'Angebot abgegeben', 'Über Zeit nachfassen', 'Closing Path', 'Angekauft', 'Archiv'))
);
--> statement-breakpoint
ALTER TABLE "fach"."deal_status_historie" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "fach"."deals" (
	"id" text PRIMARY KEY NOT NULL,
	"objekt_id" text NOT NULL,
	"makler_id" text,
	"status" text DEFAULT 'In Prüfung' NOT NULL,
	"prio" text,
	"angebots_datum" date,
	"nachfass_frequenz" text,
	"last_contact" date,
	"next_contact" date,
	"kalkulation" jsonb,
	"propstack_unit_id" text,
	"expose_rohdaten" jsonb,
	"notizen" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "deals_status_check" CHECK ("fach"."deals"."status" in ('In Prüfung', 'Angebot abgegeben', 'Über Zeit nachfassen', 'Closing Path', 'Angekauft', 'Archiv'))
);
--> statement-breakpoint
ALTER TABLE "fach"."deals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "fach"."einstellungen" (
	"schluessel" text PRIMARY KEY NOT NULL,
	"wert" jsonb,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "fach"."einstellungen" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "fach"."finanzpraesentationen" (
	"id" text PRIMARY KEY NOT NULL,
	"deal_id" text NOT NULL,
	"bank_name" text,
	"intern_notiz" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fach"."finanzpraesentationen" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "fach"."geheimnisse" (
	"schluessel" text PRIMARY KEY NOT NULL,
	"wert_verschluesselt" text,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "fach"."geheimnisse" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "fach"."gespeicherte_filter" (
	"id" text PRIMARY KEY NOT NULL,
	"modul" text,
	"name" text,
	"kriterien" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fach"."gespeicherte_filter" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "fach"."kundenkalkulationen" (
	"id" text PRIMARY KEY NOT NULL,
	"deal_id" text NOT NULL,
	"deal_einheit_id" text,
	"name" text,
	"scope" text,
	"inputs" jsonb,
	"obj_snapshot" jsonb,
	"projekt_titel" text,
	"wertsteig_bullets" text[],
	"wertsteig_sichtbar" boolean,
	"kaufpreis_wohnung" numeric(14, 2),
	"kaufpreis_stellplatz" numeric(14, 2),
	"stellplaetze_anzahl" integer,
	"stellplatz_einh_ids" text[],
	"bild_refs" text[],
	"intern_notiz" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fach"."kundenkalkulationen" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "fach"."mail_import_gesehen" (
	"uid" text PRIMARY KEY NOT NULL,
	"gesehen_am" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fach"."mail_import_gesehen" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "fach"."makler" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"firma" text,
	"tel" text,
	"email" text,
	"webseite" text,
	"prio" text,
	"kontakt_frequenz" text,
	"last_contact" date,
	"next_contact" date,
	"beziehungs_notiz" text,
	"tags" text[],
	"persoenlich" jsonb,
	"ki_summary" text,
	"ki_summary_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fach"."makler" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "fach"."makler_kommunikation" (
	"id" text PRIMARY KEY NOT NULL,
	"makler_id" text NOT NULL,
	"zeitpunkt" timestamp with time zone DEFAULT now(),
	"kanal" text,
	"richtung" text,
	"betreff" text,
	"text" text,
	"mail_uid" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fach"."makler_kommunikation" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "fach"."merge_protokoll" (
	"id" text PRIMARY KEY NOT NULL,
	"entitaet" text,
	"aktion" text,
	"primaer_id" text,
	"sekundaer_id" text,
	"primaer_snapshot" jsonb,
	"sekundaer_snapshot" jsonb,
	"betroffene_deal_ids" text[],
	"am" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fach"."merge_protokoll" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "fach"."oauth_tokens" (
	"account" text PRIMARY KEY NOT NULL,
	"provider" text,
	"user_email" text,
	"home_account_id" text,
	"refresh_token_enc" text,
	"access_token_enc" text,
	"access_token_exp" bigint,
	"scopes" text,
	"connected_at" bigint,
	"last_refreshed_at" bigint,
	"last_used_at" bigint
);
--> statement-breakpoint
ALTER TABLE "fach"."oauth_tokens" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "fach"."objekt_einheiten" (
	"id" text PRIMARY KEY NOT NULL,
	"objekt_id" text NOT NULL,
	"typ" text,
	"lage" text,
	"zimmer" numeric(4, 1),
	"stueck" integer,
	"flaeche" numeric(10, 2),
	"kaltmiete" numeric(14, 2),
	"vermietung" text,
	"sort" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fach"."objekt_einheiten" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "fach"."objekt_fotos" (
	"id" text PRIMARY KEY NOT NULL,
	"objekt_id" text NOT NULL,
	"storage_key" text,
	"dateiname" text,
	"mime_type" text,
	"groesse_bytes" bigint,
	"sort" integer,
	"hochgeladen_am" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fach"."objekt_fotos" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "fach"."objekte" (
	"id" text PRIMARY KEY NOT NULL,
	"strasse" text,
	"hausnr" text,
	"plz" text,
	"stadt" text,
	"bundesland" text,
	"baujahr" integer,
	"einheiten_anzahl" integer,
	"wohnflaeche" numeric(10, 2),
	"grundstueck" numeric(10, 2),
	"energieklasse" text,
	"heizung" text,
	"angebotspreis" numeric(14, 2),
	"zielpreis" numeric(14, 2),
	"ist_miete" numeric(14, 2),
	"soll_miete" numeric(14, 2),
	"status" text,
	"notizen" text,
	"erfasst_am" date,
	"details" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fach"."objekte" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "fach"."praesentation_folien" (
	"id" text PRIMARY KEY NOT NULL,
	"praesentation_id" text NOT NULL,
	"typ" text,
	"sichtbar" boolean,
	"sort" integer,
	"daten" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fach"."praesentation_folien" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "fach"."projekt_aufgaben" (
	"id" text PRIMARY KEY NOT NULL,
	"projekt_id" text NOT NULL,
	"kategorie" text,
	"text" text,
	"status" text,
	"kommentar" text,
	"verantwortlich" text,
	"faellig" date,
	"sort" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fach"."projekt_aufgaben" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "fach"."projekt_einheiten" (
	"id" text PRIMARY KEY NOT NULL,
	"projekt_id" text NOT NULL,
	"deal_einheit_id" text,
	"typ" text,
	"lage" text,
	"zimmer" numeric(4, 1),
	"flaeche" numeric(10, 2),
	"kaltmiete" numeric(14, 2),
	"km_moeglich" numeric(14, 2),
	"ziel_kp" numeric(14, 2),
	"ist_kp" numeric(14, 2),
	"vstatus" text,
	"reserv_datum" date,
	"notar_datum" date,
	"kaeufer" text,
	"pip" text,
	"pip_strategie" text,
	"pip_todos" text,
	"vt_kommentar" text,
	"sort" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fach"."projekt_einheiten" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "fach"."projekt_gebaeude_massnahmen" (
	"id" text PRIMARY KEY NOT NULL,
	"projekt_id" text NOT NULL,
	"text" text,
	"status" text,
	"verantwortlich" text,
	"sort" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fach"."projekt_gebaeude_massnahmen" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "fach"."projekt_mieterhistorie" (
	"id" text PRIMARY KEY NOT NULL,
	"projekt_einheit_id" text NOT NULL,
	"datum" date,
	"inhalt" text,
	"ergebnis" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fach"."projekt_mieterhistorie" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "fach"."projekte" (
	"id" text PRIMARY KEY NOT NULL,
	"deal_id" text,
	"adresse" text,
	"stadt" text,
	"datum" date,
	"ziel_vkp" numeric(14, 2),
	"finanz_parameter" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fach"."projekte" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "fach"."textvorlagen" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"kanal" text,
	"betreff" text,
	"text" text,
	"sort" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fach"."textvorlagen" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "fach"."vertriebsliste_zeilen" (
	"id" text PRIMARY KEY NOT NULL,
	"liste_id" text NOT NULL,
	"deal_einheit_id" text,
	"ist_stellplatz" boolean,
	"sort" integer,
	"daten" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fach"."vertriebsliste_zeilen" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "fach"."vertriebslisten" (
	"id" text PRIMARY KEY NOT NULL,
	"deal_id" text NOT NULL,
	"spalten" jsonb,
	"versteckte_spalten" text[],
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fach"."vertriebslisten" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "fach"."vordrucke" (
	"id" text PRIMARY KEY NOT NULL,
	"nummer" text,
	"titel" text,
	"art" text,
	"inhalt" text,
	"betreff" text,
	"datei_name" text,
	"aktiv" boolean,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fach"."vordrucke" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "fach"."auto_import_runs" ADD CONSTRAINT "auto_import_runs_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "fach"."deals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fach"."begleitschein_aktionen" ADD CONSTRAINT "begleitschein_aktionen_vorlage_typ_begleitschein_vorlagen_typ_fk" FOREIGN KEY ("vorlage_typ") REFERENCES "fach"."begleitschein_vorlagen"("typ") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fach"."begleitschein_aktionen" ADD CONSTRAINT "begleitschein_aktionen_vordruck_id_vordrucke_id_fk" FOREIGN KEY ("vordruck_id") REFERENCES "fach"."vordrucke"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fach"."begleitscheine" ADD CONSTRAINT "begleitscheine_vorlage_typ_begleitschein_vorlagen_typ_fk" FOREIGN KEY ("vorlage_typ") REFERENCES "fach"."begleitschein_vorlagen"("typ") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fach"."begleitscheine" ADD CONSTRAINT "begleitscheine_objekt_id_objekte_id_fk" FOREIGN KEY ("objekt_id") REFERENCES "fach"."objekte"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fach"."begleitscheine" ADD CONSTRAINT "begleitscheine_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "fach"."deals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fach"."deal_dokumente" ADD CONSTRAINT "deal_dokumente_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "fach"."deals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fach"."deal_einheiten" ADD CONSTRAINT "deal_einheiten_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "fach"."deals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fach"."deal_einheiten" ADD CONSTRAINT "deal_einheiten_objekt_einheit_id_objekt_einheiten_id_fk" FOREIGN KEY ("objekt_einheit_id") REFERENCES "fach"."objekt_einheiten"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fach"."deal_kalk_varianten" ADD CONSTRAINT "deal_kalk_varianten_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "fach"."deals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fach"."deal_kommentare" ADD CONSTRAINT "deal_kommentare_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "fach"."deals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fach"."deal_sanierungen" ADD CONSTRAINT "deal_sanierungen_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "fach"."deals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fach"."deal_status_historie" ADD CONSTRAINT "deal_status_historie_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "fach"."deals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fach"."deals" ADD CONSTRAINT "deals_objekt_id_objekte_id_fk" FOREIGN KEY ("objekt_id") REFERENCES "fach"."objekte"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fach"."deals" ADD CONSTRAINT "deals_makler_id_makler_id_fk" FOREIGN KEY ("makler_id") REFERENCES "fach"."makler"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fach"."finanzpraesentationen" ADD CONSTRAINT "finanzpraesentationen_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "fach"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fach"."kundenkalkulationen" ADD CONSTRAINT "kundenkalkulationen_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "fach"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fach"."kundenkalkulationen" ADD CONSTRAINT "kundenkalkulationen_deal_einheit_id_deal_einheiten_id_fk" FOREIGN KEY ("deal_einheit_id") REFERENCES "fach"."deal_einheiten"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fach"."makler_kommunikation" ADD CONSTRAINT "makler_kommunikation_makler_id_makler_id_fk" FOREIGN KEY ("makler_id") REFERENCES "fach"."makler"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fach"."objekt_einheiten" ADD CONSTRAINT "objekt_einheiten_objekt_id_objekte_id_fk" FOREIGN KEY ("objekt_id") REFERENCES "fach"."objekte"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fach"."objekt_fotos" ADD CONSTRAINT "objekt_fotos_objekt_id_objekte_id_fk" FOREIGN KEY ("objekt_id") REFERENCES "fach"."objekte"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fach"."praesentation_folien" ADD CONSTRAINT "praesentation_folien_praesentation_id_finanzpraesentationen_id_fk" FOREIGN KEY ("praesentation_id") REFERENCES "fach"."finanzpraesentationen"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fach"."projekt_aufgaben" ADD CONSTRAINT "projekt_aufgaben_projekt_id_projekte_id_fk" FOREIGN KEY ("projekt_id") REFERENCES "fach"."projekte"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fach"."projekt_einheiten" ADD CONSTRAINT "projekt_einheiten_projekt_id_projekte_id_fk" FOREIGN KEY ("projekt_id") REFERENCES "fach"."projekte"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fach"."projekt_einheiten" ADD CONSTRAINT "projekt_einheiten_deal_einheit_id_deal_einheiten_id_fk" FOREIGN KEY ("deal_einheit_id") REFERENCES "fach"."deal_einheiten"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fach"."projekt_gebaeude_massnahmen" ADD CONSTRAINT "projekt_gebaeude_massnahmen_projekt_id_projekte_id_fk" FOREIGN KEY ("projekt_id") REFERENCES "fach"."projekte"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fach"."projekt_mieterhistorie" ADD CONSTRAINT "projekt_mieterhistorie_projekt_einheit_id_projekt_einheiten_id_fk" FOREIGN KEY ("projekt_einheit_id") REFERENCES "fach"."projekt_einheiten"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fach"."projekte" ADD CONSTRAINT "projekte_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "fach"."deals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fach"."vertriebsliste_zeilen" ADD CONSTRAINT "vertriebsliste_zeilen_liste_id_vertriebslisten_id_fk" FOREIGN KEY ("liste_id") REFERENCES "fach"."vertriebslisten"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fach"."vertriebsliste_zeilen" ADD CONSTRAINT "vertriebsliste_zeilen_deal_einheit_id_deal_einheiten_id_fk" FOREIGN KEY ("deal_einheit_id") REFERENCES "fach"."deal_einheiten"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fach"."vertriebslisten" ADD CONSTRAINT "vertriebslisten_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "fach"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "deal_status_historie_deal_idx" ON "fach"."deal_status_historie" USING btree ("deal_id","am");--> statement-breakpoint
CREATE INDEX "deals_status_idx" ON "fach"."deals" USING btree ("status") WHERE "fach"."deals"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "deals_next_contact_idx" ON "fach"."deals" USING btree ("next_contact") WHERE "fach"."deals"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "deals_objekt_idx" ON "fach"."deals" USING btree ("objekt_id");--> statement-breakpoint
CREATE INDEX "deals_makler_idx" ON "fach"."deals" USING btree ("makler_id");--> statement-breakpoint
CREATE INDEX "makler_next_contact_idx" ON "fach"."makler" USING btree ("next_contact") WHERE "fach"."makler"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "objekte_stadt_idx" ON "fach"."objekte" USING btree ("stadt") WHERE "fach"."objekte"."deleted_at" is null;