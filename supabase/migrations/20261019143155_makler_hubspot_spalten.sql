ALTER TABLE "fach"."makler" ADD COLUMN "anrede" text;--> statement-breakpoint
ALTER TABLE "fach"."makler" ADD COLUMN "position" text;--> statement-breakpoint
ALTER TABLE "fach"."makler" ADD COLUMN "stellung" text;--> statement-breakpoint
ALTER TABLE "fach"."makler" ADD COLUMN "zustaendig" text;--> statement-breakpoint
ALTER TABLE "fach"."makler" ADD COLUMN "hinweis" text;--> statement-breakpoint
ALTER TABLE "fach"."makler" ADD COLUMN "mailing_status" text;--> statement-breakpoint
ALTER TABLE "fach"."makler" ADD COLUMN "mails_abgemeldet" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "fach"."makler" ADD COLUMN "rechtsgrundlage" text;--> statement-breakpoint
ALTER TABLE "fach"."makler" ADD COLUMN "quelle" text;--> statement-breakpoint
ALTER TABLE "fach"."unternehmen" ADD COLUMN "fax" text;