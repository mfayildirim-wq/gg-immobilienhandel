ALTER TABLE "fach"."deal_einheiten" ADD COLUMN "flaeche" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "fach"."deal_einheiten" ADD COLUMN "miete_neu" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "fach"."deal_einheiten" ADD COLUMN "miete_neu_manuell" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "fach"."deal_einheiten" ADD COLUMN "verkaufspreis" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "fach"."deal_einheiten" ADD COLUMN "stueck" integer;--> statement-breakpoint
ALTER TABLE "fach"."deal_sanierungen" ADD COLUMN "bereich" text;