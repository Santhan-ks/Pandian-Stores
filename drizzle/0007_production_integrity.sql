CREATE OR REPLACE FUNCTION nova.guard_production() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE doc_id text;
BEGIN
 IF TG_TABLE_NAME IN ('production_runs','production_inputs') THEN
   IF TG_TABLE_NAME='production_runs' THEN doc_id:=CASE WHEN TG_OP='DELETE' THEN OLD.id ELSE NEW.id END;
   ELSE doc_id:=CASE WHEN TG_OP='DELETE' THEN OLD.run_id ELSE NEW.run_id END; END IF;
   PERFORM 1 FROM nova.stock_documents WHERE id=doc_id AND status='draft' AND category='production' FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'Posted production is immutable'; END IF;
   IF TG_OP='UPDATE' AND TG_TABLE_NAME='production_runs' AND NEW.id<>OLD.id THEN RAISE EXCEPTION 'Run identity is immutable'; END IF;
 ELSE
   IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Cost snapshots and overhead events are append-only'; END IF;
   IF TG_TABLE_NAME='production_cost_snapshots' AND pg_trigger_depth()<2 THEN RAISE EXCEPTION 'Cost snapshots require stock posting'; END IF;
   IF TG_TABLE_NAME='production_overheads' THEN
     PERFORM 1 FROM nova.stock_documents WHERE id=NEW.run_id FOR UPDATE;
     IF NOT EXISTS(SELECT 1 FROM nova.user_roles WHERE user_id=NEW.actor_id AND role IN ('admin','production')) THEN RAISE EXCEPTION 'Unauthorized overhead'; END IF;
   END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER production_input_guard ON nova.production_inputs;
CREATE TRIGGER production_input_guard BEFORE INSERT OR UPDATE OR DELETE ON nova.production_inputs FOR EACH ROW EXECUTE FUNCTION nova.guard_production();
DROP TRIGGER production_cost_guard ON nova.production_cost_snapshots;
CREATE TRIGGER production_cost_guard BEFORE INSERT OR UPDATE OR DELETE ON nova.production_cost_snapshots FOR EACH ROW EXECUTE FUNCTION nova.guard_production();
CREATE FUNCTION nova.validate_production_post() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE run nova.production_runs;
BEGIN
 IF NEW.category<>'production' OR NEW.status<>'posted' THEN RETURN NEW; END IF;
 SELECT * INTO run FROM nova.production_runs WHERE id=NEW.id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Missing production run'; END IF;
 IF (SELECT count(*) FROM nova.stock_document_lines WHERE document_id=NEW.id) <> (SELECT count(*)+1 FROM nova.production_inputs WHERE run_id=NEW.id) THEN RAISE EXCEPTION 'Production lines do not match run'; END IF;
 IF EXISTS(SELECT 1 FROM nova.production_inputs i LEFT JOIN nova.stock_document_lines l ON l.id=i.line_id WHERE i.run_id=NEW.id AND (l.document_id IS DISTINCT FROM NEW.id OR l.item_id IS DISTINCT FROM i.item_id OR l.quantity IS DISTINCT FROM -i.actual_quantity OR l.unit IS DISTINCT FROM i.unit)) THEN RAISE EXCEPTION 'Production input mismatch'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER validate_production BEFORE UPDATE OF status ON nova.stock_documents FOR EACH ROW EXECUTE FUNCTION nova.validate_production_post();
