DROP TRIGGER protect_bom ON nova.bom_versions;
--> statement-breakpoint
CREATE TRIGGER protect_bom BEFORE INSERT OR UPDATE OR DELETE ON nova.bom_versions FOR EACH ROW EXECUTE FUNCTION nova.guard_published_bom();
--> statement-breakpoint
ALTER TABLE nova.bom_versions ADD CONSTRAINT active_requires_publication CHECK (NOT active OR published_at IS NOT NULL);
