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
   IF TG_OP='DELETE' OR OLD.status='posted' THEN RAISE EXCEPTION 'Documents cannot be deleted or edited after posting'; END IF;
   IF NEW.id<>OLD.id OR NEW.request_key<>OLD.request_key OR NEW.created_by<>OLD.created_by OR NEW.created_at<>OLD.created_at THEN RAISE EXCEPTION 'Document identity is immutable'; END IF;
 END IF;
 RETURN NEW;
END $$;
