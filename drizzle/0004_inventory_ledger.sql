CREATE TABLE nova.stock_documents (
 id text PRIMARY KEY, category text NOT NULL CHECK(category IN ('opening','purchase','adjustment')),
 supplier_id text REFERENCES nova.suppliers(id), reason text NOT NULL CHECK(length(trim(reason))>0),
 request_key text NOT NULL UNIQUE, payload jsonb NOT NULL, status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','posted')),
 created_by text NOT NULL REFERENCES nova.users(id), created_at timestamptz NOT NULL DEFAULT now(),
 posted_by text REFERENCES nova.users(id), posted_at timestamptz,
 CHECK(category <> 'purchase' OR supplier_id IS NOT NULL),
 CHECK((status='draft' AND posted_at IS NULL AND posted_by IS NULL) OR (status='posted' AND posted_at IS NOT NULL AND posted_by IS NOT NULL))
);
CREATE TABLE nova.stock_document_lines (
 id text PRIMARY KEY, document_id text NOT NULL REFERENCES nova.stock_documents(id),
 item_id text NOT NULL REFERENCES nova.inventory_items(id), quantity numeric NOT NULL CHECK(quantity <> 0),
 unit text NOT NULL REFERENCES nova.units(code), unit_rate numeric CHECK(unit_rate >= 0),
 UNIQUE(document_id,item_id), UNIQUE(id,document_id,item_id)
);
CREATE TABLE nova.inventory_movements (
 id text PRIMARY KEY, document_id text NOT NULL REFERENCES nova.stock_documents(id),
 line_id text NOT NULL UNIQUE, item_id text NOT NULL REFERENCES nova.inventory_items(id),
 quantity numeric NOT NULL CHECK(quantity<>0), base_unit text NOT NULL REFERENCES nova.units(code),
 value numeric, quantity_before numeric NOT NULL CHECK(quantity_before>=0), quantity_after numeric NOT NULL CHECK(quantity_after>=0),
 actor_id text NOT NULL REFERENCES nova.users(id), posted_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(line_id,document_id,item_id) REFERENCES nova.stock_document_lines(id,document_id,item_id),
 CHECK(quantity_after=quantity_before+quantity)
);
CREATE INDEX movement_item_time ON nova.inventory_movements(item_id,posted_at);
CREATE INDEX stock_document_category_time ON nova.stock_documents(category,created_at);
CREATE VIEW nova.stock_summary AS
 SELECT i.id, i.name, i.kind, i.base_unit, coalesce(sum(m.quantity),0) AS quantity,
 CASE WHEN coalesce(sum(m.quantity),0)=0 THEN 0 WHEN count(*) FILTER(WHERE m.id IS NOT NULL AND m.value IS NULL)>0 THEN NULL ELSE coalesce(sum(m.value),0) END AS value
 FROM nova.inventory_items i LEFT JOIN nova.inventory_movements m ON m.item_id=i.id GROUP BY i.id;
CREATE FUNCTION nova.protect_stock_records() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='inventory_movements' THEN
   IF TG_OP <> 'INSERT' OR pg_trigger_depth()<2 THEN RAISE EXCEPTION 'Ledger writes require document posting; posted movements are immutable'; END IF;
 ELSIF TG_TABLE_NAME='stock_document_lines' THEN
   IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'Create a replacement draft instead of editing document lines'; END IF;
   PERFORM 1 FROM nova.stock_documents WHERE id=NEW.document_id AND status='draft' FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'Lines require a draft document'; END IF;
 ELSE
   IF TG_OP='INSERT' THEN
     IF NEW.status<>'draft' THEN RAISE EXCEPTION 'Documents must start as drafts'; END IF;
     RETURN NEW;
   END IF;
   IF TG_OP='DELETE' OR OLD.status='posted' THEN RAISE EXCEPTION 'Documents cannot be deleted or edited after posting'; END IF;
   IF (to_jsonb(NEW)-'status'-'posted_at'-'posted_by') IS DISTINCT FROM (to_jsonb(OLD)-'status'-'posted_at'-'posted_by') THEN RAISE EXCEPTION 'Create a replacement draft'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER stock_document_guard BEFORE INSERT OR UPDATE OR DELETE ON nova.stock_documents FOR EACH ROW EXECUTE FUNCTION nova.protect_stock_records();
CREATE TRIGGER stock_line_guard BEFORE INSERT OR UPDATE OR DELETE ON nova.stock_document_lines FOR EACH ROW EXECUTE FUNCTION nova.protect_stock_records();
CREATE TRIGGER stock_movement_guard BEFORE INSERT OR UPDATE OR DELETE ON nova.inventory_movements FOR EACH ROW EXECUTE FUNCTION nova.protect_stock_records();
CREATE FUNCTION nova.post_stock_document() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE line record; balance record; delta numeric; movement_value numeric; factor numeric; base_factor numeric; dimension text; base_dimension text; item_unit text; item_kind text;
BEGIN
 IF NEW.status <> 'posted' THEN RETURN NEW; END IF;
 IF NOT EXISTS(SELECT 1 FROM nova.user_roles WHERE user_id=NEW.posted_by AND (role='admin' OR (role='production' AND NEW.category='purchase'))) THEN RAISE EXCEPTION 'Unauthorized posting'; END IF;
 IF NOT EXISTS(SELECT 1 FROM nova.stock_document_lines WHERE document_id=NEW.id) THEN RAISE EXCEPTION 'Document requires lines'; END IF;
 PERFORM i.id FROM nova.inventory_items i JOIN nova.stock_document_lines l ON l.item_id=i.id WHERE l.document_id=NEW.id ORDER BY i.id FOR UPDATE OF i;
 FOR line IN SELECT * FROM nova.stock_document_lines WHERE document_id=NEW.id ORDER BY item_id LOOP
   SELECT base_unit,kind INTO item_unit,item_kind FROM nova.inventory_items WHERE id=line.item_id;
   SELECT u.dimension,u.base_factor INTO dimension,factor FROM nova.units u WHERE code=line.unit;
   SELECT u.dimension,u.base_factor INTO base_dimension,base_factor FROM nova.units u WHERE code=item_unit;
   IF dimension<>base_dimension THEN RAISE EXCEPTION 'Incompatible units'; END IF;
   IF NEW.category<>'adjustment' AND line.quantity<=0 THEN RAISE EXCEPTION 'Receipt must be positive'; END IF;
   IF NEW.category='purchase' AND (line.unit_rate IS NULL OR item_kind='finished') THEN RAISE EXCEPTION 'Purchases require a material and rate'; END IF;
   IF NEW.category='opening' AND EXISTS(SELECT 1 FROM nova.inventory_movements WHERE item_id=line.item_id) THEN RAISE EXCEPTION 'Opening requires an item with no movement history'; END IF;
   SELECT quantity,value INTO balance FROM nova.stock_summary WHERE id=line.item_id;
   delta := line.quantity*factor/base_factor;
   IF item_unit IN ('piece','packet') AND delta<>trunc(delta) THEN RAISE EXCEPTION 'Count units must be whole'; END IF;
   IF balance.quantity+delta<0 THEN RAISE EXCEPTION 'Insufficient stock'; END IF;
   IF NEW.category='adjustment' THEN
     IF line.unit_rate IS NOT NULL THEN RAISE EXCEPTION 'Adjustments use existing average valuation'; END IF;
     movement_value := CASE WHEN balance.quantity=0 THEN NULL ELSE delta*balance.value/balance.quantity END;
   ELSE movement_value := line.quantity*line.unit_rate;
   END IF;
   INSERT INTO nova.inventory_movements(id,document_id,line_id,item_id,quantity,base_unit,value,quantity_before,quantity_after,actor_id)
     VALUES(line.id,NEW.id,line.id,line.item_id,delta,item_unit,movement_value,balance.quantity,balance.quantity+delta,NEW.posted_by);
 END LOOP;
 INSERT INTO nova.audit_events(id,actor_id,action,document_id,before,after) VALUES(NEW.id||'-post',NEW.posted_by,'stock.post',NEW.id,to_jsonb(OLD),to_jsonb(NEW));
 RETURN NEW;
END $$;
CREATE TRIGGER stock_post AFTER UPDATE OF status ON nova.stock_documents FOR EACH ROW WHEN (OLD.status='draft' AND NEW.status='posted') EXECUTE FUNCTION nova.post_stock_document();
