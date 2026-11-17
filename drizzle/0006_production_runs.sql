ALTER TABLE nova.stock_documents DROP CONSTRAINT stock_documents_category_check;
ALTER TABLE nova.stock_documents ADD CONSTRAINT stock_documents_category_check CHECK(category IN ('opening','purchase','adjustment','production'));
CREATE TABLE nova.production_runs (
 id text PRIMARY KEY REFERENCES nova.stock_documents(id), bom_id text NOT NULL REFERENCES nova.bom_versions(id),
 product_id text NOT NULL REFERENCES nova.products(id), batches numeric NOT NULL CHECK(batches>0),
 expected_output numeric NOT NULL CHECK(expected_output>0), good_output numeric NOT NULL CHECK(good_output>0 AND good_output=trunc(good_output)),
 tolerance numeric NOT NULL DEFAULT 3 CHECK(tolerance>=0 AND tolerance<=100),
 snapshot jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE nova.production_inputs (
 line_id text PRIMARY KEY REFERENCES nova.stock_document_lines(id), run_id text NOT NULL REFERENCES nova.production_runs(id),
 planned_quantity numeric NOT NULL CHECK(planned_quantity>0), actual_quantity numeric NOT NULL CHECK(actual_quantity>=0),
 damaged_quantity numeric NOT NULL CHECK(damaged_quantity>=0 AND damaged_quantity<=actual_quantity),
 item_id text NOT NULL REFERENCES nova.inventory_items(id), unit text NOT NULL REFERENCES nova.units(code),
 UNIQUE(run_id,item_id)
);
CREATE TABLE nova.production_cost_snapshots (
 run_id text PRIMARY KEY REFERENCES nova.production_runs(id), material_cost numeric, inputs jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE nova.production_overheads (
 id text PRIMARY KEY, run_id text NOT NULL REFERENCES nova.production_runs(id), category text NOT NULL CHECK(category IN ('labour','gas_power','other')),
 amount numeric NOT NULL CHECK(amount>0), reason text NOT NULL CHECK(length(trim(reason))>0),
 request_key text NOT NULL UNIQUE, actor_id text NOT NULL REFERENCES nova.users(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX production_input_run ON nova.production_inputs(run_id);
CREATE INDEX production_overhead_run ON nova.production_overheads(run_id);
CREATE VIEW nova.production_costs AS
 SELECT r.id,r.good_output,c.material_cost,coalesce(o.overheads,0) AS overheads,
 c.material_cost+coalesce(o.overheads,0) AS total_cost,
 (c.material_cost+coalesce(o.overheads,0))/r.good_output AS cost_per_packet
 FROM nova.production_runs r LEFT JOIN nova.production_cost_snapshots c ON c.run_id=r.id
 LEFT JOIN (SELECT run_id,sum(amount) AS overheads FROM nova.production_overheads GROUP BY run_id) o ON o.run_id=r.id;
CREATE FUNCTION nova.guard_production() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Production snapshots and overhead events are immutable'; END IF;
 IF TG_TABLE_NAME='production_runs' AND NOT EXISTS(SELECT 1 FROM nova.stock_documents WHERE id=NEW.id AND status='draft' AND category='production') THEN RAISE EXCEPTION 'Production requires a draft stock document'; END IF;
 IF TG_TABLE_NAME='production_overheads' THEN
   PERFORM 1 FROM nova.stock_documents WHERE id=NEW.run_id FOR UPDATE;
   IF NOT EXISTS(SELECT 1 FROM nova.user_roles WHERE user_id=NEW.actor_id AND role IN ('admin','production')) THEN RAISE EXCEPTION 'Unauthorized overhead'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER production_run_guard BEFORE INSERT OR UPDATE OR DELETE ON nova.production_runs FOR EACH ROW EXECUTE FUNCTION nova.guard_production();
CREATE TRIGGER production_input_guard BEFORE UPDATE OR DELETE ON nova.production_inputs FOR EACH ROW EXECUTE FUNCTION nova.guard_production();
CREATE TRIGGER production_cost_guard BEFORE UPDATE OR DELETE ON nova.production_cost_snapshots FOR EACH ROW EXECUTE FUNCTION nova.guard_production();
CREATE TRIGGER production_overhead_guard BEFORE INSERT OR UPDATE OR DELETE ON nova.production_overheads FOR EACH ROW EXECUTE FUNCTION nova.guard_production();
CREATE OR REPLACE FUNCTION nova.post_stock_document() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE line record; balance record; delta numeric; movement_value numeric; factor numeric; base_factor numeric; dimension text; base_dimension text; item_unit text; item_kind text;
BEGIN
 IF NEW.status <> 'posted' THEN RETURN NEW; END IF;
 IF NOT EXISTS(SELECT 1 FROM nova.user_roles WHERE user_id=NEW.posted_by AND (role='admin' OR (role='production' AND NEW.category IN ('purchase','production')))) THEN RAISE EXCEPTION 'Unauthorized posting'; END IF;
 IF NOT EXISTS(SELECT 1 FROM nova.stock_document_lines WHERE document_id=NEW.id) THEN RAISE EXCEPTION 'Document requires lines'; END IF;
 PERFORM i.id FROM nova.inventory_items i JOIN nova.stock_document_lines l ON l.item_id=i.id WHERE l.document_id=NEW.id ORDER BY i.id FOR UPDATE OF i;
 FOR line IN SELECT * FROM nova.stock_document_lines WHERE document_id=NEW.id ORDER BY CASE WHEN NEW.category='production' AND quantity>0 THEN 1 ELSE 0 END,item_id LOOP
   SELECT base_unit,kind INTO item_unit,item_kind FROM nova.inventory_items WHERE id=line.item_id;
   SELECT u.dimension,u.base_factor INTO dimension,factor FROM nova.units u WHERE code=line.unit;
   SELECT u.dimension,u.base_factor INTO base_dimension,base_factor FROM nova.units u WHERE code=item_unit;
   IF dimension<>base_dimension THEN RAISE EXCEPTION 'Incompatible units'; END IF;
   IF NEW.category NOT IN ('adjustment','production') AND line.quantity<=0 THEN RAISE EXCEPTION 'Receipt must be positive'; END IF;
   IF NEW.category='purchase' AND (line.unit_rate IS NULL OR item_kind='finished') THEN RAISE EXCEPTION 'Purchases require a material and rate'; END IF;
   IF NEW.category='opening' AND EXISTS(SELECT 1 FROM nova.inventory_movements WHERE item_id=line.item_id) THEN RAISE EXCEPTION 'Opening requires an item with no movement history'; END IF;
   SELECT quantity,value INTO balance FROM nova.stock_summary WHERE id=line.item_id;
   delta := line.quantity*factor/base_factor;
   IF item_unit IN ('piece','packet') AND delta<>trunc(delta) THEN RAISE EXCEPTION 'Count units must be whole'; END IF;
   IF balance.quantity+delta<0 THEN RAISE EXCEPTION 'Insufficient stock'; END IF;
   IF NEW.category='production' THEN
     IF NOT EXISTS(SELECT 1 FROM nova.production_runs WHERE id=NEW.id) THEN RAISE EXCEPTION 'Missing production run'; END IF;
     IF delta<0 THEN
       IF item_kind='finished' THEN RAISE EXCEPTION 'Invalid production input'; END IF;
       movement_value := delta*balance.value/nullif(balance.quantity,0);
     ELSE
       IF NOT EXISTS(SELECT 1 FROM nova.production_runs r JOIN nova.products p ON p.id=r.product_id WHERE r.id=NEW.id AND p.item_id=line.item_id AND r.good_output=delta) THEN RAISE EXCEPTION 'Invalid production output'; END IF;
       SELECT CASE WHEN count(*) FILTER(WHERE value IS NULL)>0 THEN NULL ELSE -sum(value) END INTO movement_value FROM nova.inventory_movements WHERE document_id=NEW.id AND quantity<0;
     END IF;
   ELSIF NEW.category='adjustment' THEN
     IF line.unit_rate IS NOT NULL THEN RAISE EXCEPTION 'Adjustments use existing average valuation'; END IF;
     movement_value := CASE WHEN balance.quantity=0 THEN NULL ELSE delta*balance.value/balance.quantity END;
   ELSE movement_value := line.quantity*line.unit_rate;
   END IF;
   INSERT INTO nova.inventory_movements(id,document_id,line_id,item_id,quantity,base_unit,value,quantity_before,quantity_after,actor_id)
     VALUES(line.id,NEW.id,line.id,line.item_id,delta,item_unit,movement_value,balance.quantity,balance.quantity+delta,NEW.posted_by);
 END LOOP;
 IF NEW.category='production' THEN
   INSERT INTO nova.production_cost_snapshots(run_id,material_cost,inputs) SELECT NEW.id,CASE WHEN count(*) FILTER(WHERE m.value IS NULL)>0 THEN NULL ELSE -sum(m.value) END,jsonb_agg(jsonb_build_object('itemId',m.item_id,'quantity',-m.quantity,'baseUnit',m.base_unit,'cost',-m.value)) FROM nova.inventory_movements m WHERE m.document_id=NEW.id AND m.quantity<0;
 END IF;
 INSERT INTO nova.audit_events(id,actor_id,action,document_id,before,after) VALUES(NEW.id||'-post',NEW.posted_by,'stock.post',NEW.id,to_jsonb(OLD),to_jsonb(NEW));
 RETURN NEW;
END $$;
