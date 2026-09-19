ALTER TABLE "fach"."projekt_einheiten" ADD COLUMN "te_nr" text;--> statement-breakpoint
ALTER TABLE "fach"."projekt_einheiten" ADD COLUMN "stueck" integer;--> statement-breakpoint
ALTER TABLE "fach"."projekt_einheiten" ADD COLUMN "vermietet" text;--> statement-breakpoint
ALTER TABLE "fach"."projekt_einheiten" ADD COLUMN "mieter_name" text;--> statement-breakpoint
ALTER TABLE "fach"."projekt_einheiten" ADD COLUMN "grundpreis" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "fach"."projekt_einheiten" ADD COLUMN "provision" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "fach"."projekt_einheiten" ADD COLUMN "sanierung_ivt" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "fach"."projekt_einheiten" ADD COLUMN "ergebnis_ivt" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "fach"."projekt_einheiten" ADD COLUMN "vertriebsstand" text;--> statement-breakpoint
ALTER TABLE "fach"."projekt_einheiten" ADD COLUMN "mieter_todos" text;--> statement-breakpoint
ALTER TABLE "fach"."projekt_mieterhistorie" ADD COLUMN "sort" integer;--> statement-breakpoint
ALTER TABLE "fach"."projekte" ADD COLUMN "global_vstatus" text;--> statement-breakpoint
ALTER TABLE "fach"."projekte" ADD COLUMN "global_ist_kp" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "fach"."projekte" ADD COLUMN "global_kommentar" text;--> statement-breakpoint
ALTER TABLE "fach"."projekte" ADD COLUMN "global_kaeufer" text;--> statement-breakpoint
ALTER TABLE "fach"."projekte" ADD COLUMN "global_notar_datum" date;--> statement-breakpoint
ALTER TABLE "fach"."projekte" ADD COLUMN "global_reserv_datum" date;--> statement-breakpoint
ALTER TABLE "fach"."projekte" ADD COLUMN "sort" integer;