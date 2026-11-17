CREATE OR REPLACE FUNCTION nova.guard_production() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE doc_id text;
BEGIN
 IF TG_TABLE_NAME IN ('production_runs','production_inputs') THEN
   IF TG_TABLE_NAME='production_runs' THEN doc_id:=CASE WHEN TG_OP='DELETE' THEN OLD.id ELSE NEW.id END;
   ELSE doc_id:=CASE WHEN TG_OP='DELETE' THEN OLD.run_id ELSE NEW.run_id END; END IF;
   PERFORM 1 FROM nova.stock_documents WHERE id=doc_id AND status='draft' AND category='production' FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'Posted production is immutable'; END IF;
   IF TG_OP='UPDATE' AND TG_TABLE_NAME='production_runs' AND (to_jsonb(NEW)->>'id') IS DISTINCT FROM (to_jsonb(OLD)->>'id') THEN RAISE EXCEPTION 'Run identity is immutable'; END IF;
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
