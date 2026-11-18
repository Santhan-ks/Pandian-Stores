CREATE TABLE nova.deleted_records (
 resource text NOT NULL CHECK(resource IN ('users','customers','territories','suppliers','materials','products','prices','stock','production','orders')),
 record_id text NOT NULL,
 request_scope text CHECK(request_scope IN ('stock','orders')),
 request_key text,
 deleted_by text NOT NULL REFERENCES nova.users(id),
 deleted_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(resource,record_id),
 UNIQUE(request_scope,request_key),
 CHECK((request_scope IS NULL)=(request_key IS NULL))
);
CREATE FUNCTION nova.protect_deleted_records() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Deletion tombstones are immutable'; END IF;
 IF NOT EXISTS(SELECT 1 FROM nova.user_roles WHERE user_id=NEW.deleted_by AND role IN ('admin','owner')) THEN RAISE EXCEPTION 'Unauthorized deletion'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER deleted_record_guard BEFORE INSERT OR UPDATE OR DELETE ON nova.deleted_records FOR EACH ROW EXECUTE FUNCTION nova.protect_deleted_records();
CREATE OR REPLACE FUNCTION nova.protect_stock_records() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target text;
BEGIN
 IF TG_TABLE_NAME='inventory_movements' THEN
   IF TG_OP <> 'INSERT' OR pg_trigger_depth()<2 THEN RAISE EXCEPTION 'Ledger writes require document posting; posted movements are immutable'; END IF;
 ELSIF TG_TABLE_NAME='stock_document_lines' THEN
   IF TG_OP <> 'INSERT' THEN
     PERFORM 1 FROM nova.stock_documents WHERE id=OLD.document_id AND status='draft' FOR UPDATE;
     IF NOT FOUND THEN RAISE EXCEPTION 'Posted lines are immutable'; END IF;
   END IF;
   IF TG_OP='DELETE' THEN RETURN OLD; END IF;
   PERFORM 1 FROM nova.stock_documents WHERE id=NEW.document_id AND status='draft' FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'Lines require a draft document'; END IF;
 ELSE
   IF TG_OP='INSERT' THEN
     IF NEW.status<>'draft' THEN RAISE EXCEPTION 'Documents must start as drafts'; END IF;
     RETURN NEW;
   END IF;
   IF TG_OP='DELETE' THEN
     IF OLD.status<>'draft' OR EXISTS(SELECT 1 FROM nova.inventory_movements WHERE document_id=OLD.id) THEN RAISE EXCEPTION 'Posted documents are immutable'; END IF;
     RETURN OLD;
   END IF;
   IF OLD.status='posted' THEN RAISE EXCEPTION 'Documents cannot be edited after posting'; END IF;
   IF NEW.id<>OLD.id OR NEW.request_key<>OLD.request_key OR NEW.created_by<>OLD.created_by OR NEW.created_at<>OLD.created_at THEN RAISE EXCEPTION 'Document identity is immutable'; END IF;
 END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION nova.guard_order() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='sales_order_lines' THEN
  IF TG_OP='UPDATE' AND NEW.order_id IS DISTINCT FROM OLD.order_id THEN RAISE EXCEPTION 'Order line ownership is immutable'; END IF;
  PERFORM 1 FROM nova.sales_orders WHERE id=CASE WHEN TG_OP='DELETE' THEN OLD.order_id ELSE NEW.order_id END AND status='submitted' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order lines are frozen after approval'; END IF;
 ELSE
  IF TG_OP='DELETE' THEN
   IF OLD.status<>'submitted' THEN RAISE EXCEPTION 'Reviewed orders are immutable history'; END IF;
   RETURN OLD;
  END IF;
  IF (to_jsonb(NEW)-'status'-'reason') IS DISTINCT FROM (to_jsonb(OLD)-'status'-'reason') THEN RAISE EXCEPTION 'Order identity and submitted details are immutable'; END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
   (OLD.status='submitted' AND NEW.status IN ('approved','rejected')) OR
   (OLD.status='approved' AND NEW.status='invoiced') OR
   (OLD.status='invoiced' AND NEW.status IN ('dispatched','cancelled')) OR
   (OLD.status='dispatched' AND NEW.status='cancelled')
  ) THEN RAISE EXCEPTION 'Invalid order lifecycle transition'; END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
